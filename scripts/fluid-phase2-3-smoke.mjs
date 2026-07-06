import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const APP_URL = process.env.FLUID_TEST_URL ?? 'http://127.0.0.1:3000/?fluidTest=1';
const DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT ?? 9224);
const PROFILE_DIR = path.join(os.tmpdir(), `brushes-fluid-smoke23-${Date.now()}`);

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function findChrome() {
  for (const candidate of chromeCandidates) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error('Chrome or Edge was not found. Set CHROME_PATH to a Chromium-family browser.');
}

async function waitForJson(url, timeoutMs = 10000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function waitForHttp(url, timeoutMs = 10000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      if (msg.method && this.handlers.has(msg.method)) {
        for (const handler of this.handlers.get(msg.method)) handler(msg.params);
      }
    });
  }

  on(method, handler) {
    const list = this.handlers.get(method) ?? [];
    list.push(handler);
    this.handlers.set(method, list);
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    console.log(`[CDP SEND] ${id} - ${method}`);
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          console.log(`[CDP TIMEOUT] ${id} - ${method}`);
          this.pending.delete(id);
          reject(new Error(`CDP command timed out: ${method}`));
        }
      }, 15000);
    });
  }

  close() {
    this.ws.close();
  }
}

function script(fn, ...args) {
  return `(${fn.toString()})(...${JSON.stringify(args)})`;
}

async function stopProcess(proc) {
  if (proc.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    proc.kill();
  });
}

async function main() {
  await waitForHttp(APP_URL.replace('/?fluidTest=1', ''), 5000);

  const chromePath = await findChrome();
  const chrome = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--disable-background-networking',
    '--disable-features=Translate',
    '--window-size=1440,1200',
    APP_URL,
  ], { stdio: 'ignore' });

  const failures = [];
  const warnings = [];
  const checks = [];
  const browserErrors = [];
  let cdp;

  function check(name, pass, detail = '') {
    checks.push({ name, pass, detail });
    if (!pass) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  }

  try {
    const pages = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json`, 10000);
    const page = pages.find((p) => p.type === 'page') ?? pages[0];
    cdp = new CdpClient(page.webSocketDebuggerUrl);

    cdp.on('Runtime.exceptionThrown', (params) => {
      browserErrors.push(params.exceptionDetails?.text ?? 'Runtime exception');
    });
    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') {
        browserErrors.push(params.args?.map((arg) => arg.value ?? arg.description).join(' ') ?? 'console.error');
      }
    });
    cdp.on('Log.entryAdded', (params) => {
      if (params.entry?.level === 'error') {
        browserErrors.push(`${params.entry.text}${params.entry.url ? ` ${params.entry.url}` : ''}`);
      }
    });
    cdp.on('Page.javascriptDialogOpening', async (params) => {
      await cdp.send('Page.handleJavaScriptDialog', { accept: true });
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.navigate', { url: APP_URL });

    async function evalPage(expression) {
      console.log(`[EVAL] ${expression.slice(0, 100).replace(/\n/g, ' ')}`);
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text ?? result.exceptionDetails.exception?.description ?? 'Page evaluation failed');
      }
      return result.result?.value;
    }

    async function waitFor(expression, timeoutMs = 10000) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (await evalPage(expression)) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return false;
    }

    async function mouseStroke(selector, points, options = {}) {
      const rect = await evalPage(script((sel) => {
        const canvas = document.querySelector(sel);
        if (!canvas) return null;
        const r = canvas.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height, canvasWidth: canvas.width, canvasHeight: canvas.height };
      }, selector));

      if (!rect || rect.width <= 0 || rect.height <= 0) {
        throw new Error(`Canvas is not visible for selector ${selector}`);
      }
      const toViewport = ([x, y]) => ({
        x: rect.left + (x / rect.canvasWidth) * rect.width,
        y: rect.top + (y / rect.canvasHeight) * rect.height,
      });

      const first = toViewport(points[0]);
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: first.x,
        y: first.y,
        button: 'left',
        buttons: 1,
        clickCount: 1,
        pointerType: 'pen',
        force: options.pressure ?? 0.65,
      });

      for (const point of points.slice(1)) {
        const next = toViewport(point);
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: next.x,
          y: next.y,
          button: 'left',
          buttons: 1,
          pointerType: 'pen',
          force: options.pressure ?? 0.65,
        });
        if (options.delay) {
          await new Promise(r => setTimeout(r, options.delay));
        }
      }

      const last = toViewport(points[points.length - 1]);
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: last.x,
        y: last.y,
        button: 'left',
        buttons: 0,
        clickCount: 1,
        pointerType: 'pen',
      });
    }

    console.log('Waiting for initial page load...');
    await waitFor('document.readyState === "complete"');
    console.log('Clearing localStorage and reloading...');
    await evalPage('localStorage.clear(); location.reload(); true');
    console.log('Waiting for page reload...');
    await waitFor('document.readyState === "complete" && document.body.textContent.includes("Natural Media Art Studio")');

    // Open Watercolor Canvas
    console.log('Opening watercolor canvas...');
    const opened = await evalPage(script(() => {
      const heading = [...document.querySelectorAll('h3')].find((el) => el.textContent?.includes('Watercolor Fluid Blend'));
      const card = heading?.closest('.group');
      const target = card?.querySelector('.aspect-square');
      target?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return Boolean(target);
    }));
    check('Opened watercolor canvas', opened);
    console.log('Waiting for fluid test bridge...');
    check('Fluid test bridge available', await waitFor('Boolean(window.__fluidTest && document.querySelector("canvas.cursor-crosshair"))', 10000));

    // Clear initial page state
    console.log('Clearing initial page state...');
    await evalPage(script(() => {
      const button = [...document.querySelectorAll('button')].find((el) => el.textContent?.includes('Clear Layer'));
      button?.click();
    }));
    await new Promise(r => setTimeout(r, 200));

    // --- PHASE 2 TESTS ---

    // 1. Divergence Collapse after Jacobi
    console.log('Running test: Divergence Collapse after Jacobi...');
    // Paint a dab and immediately measure the divergence field on GPU.
    await mouseStroke('canvas.cursor-crosshair', [[400, 400], [402, 402]]);
    
    const divCheck = await evalPage(script(() => {
      const sim = window.__fluidTest.getActiveSim();
      if (!sim) return null;
      const divData = sim.getDivergenceField();
      let absSum = 0;
      let maxVal = 0;
      for (let i = 0; i < divData.length; i++) {
        const val = Math.abs(divData[i]);
        absSum += val;
        if (val > maxVal) maxVal = val;
      }
      return {
        avgAbsDiv: absSum / divData.length,
        maxDiv: maxVal,
        width: sim.width,
        height: sim.height
      };
    }));

    check('Divergence collapsed after Jacobi', divCheck && divCheck.avgAbsDiv < 0.005, JSON.stringify(divCheck));

    // 2. 10s Heavy Painting → No NaN Blowout
    console.log('Running test: 10s Heavy Painting (NaN blowout check)...');
    const heavyStrokePoints = [];
    for (let i = 0; i < 100; i++) {
      const angle = (i * Math.PI) / 10;
      heavyStrokePoints.push([400 + Math.cos(angle) * 15, 400 + Math.sin(angle) * 15]);
    }
    await mouseStroke('canvas.cursor-crosshair', heavyStrokePoints, { pressure: 1.0 });

    const nanCheck = await evalPage(script(() => {
      const sim = window.__fluidTest.getActiveSim();
      if (!sim) return { hasNaN: true };
      const pressure = sim.getPressureField();
      let hasNaN = false;
      let maxPressure = 0;
      for (let i = 0; i < pressure.length; i++) {
        const val = pressure[i];
        if (isNaN(val) || !isFinite(val)) {
          hasNaN = true;
        } else {
          const absVal = Math.abs(val);
          if (absVal > maxPressure) maxPressure = absVal;
        }
      }
      return { hasNaN, maxPressure };
    }));
    check('No NaN blowout in solver under heavy painting', !nanCheck.hasNaN, JSON.stringify(nanCheck));

    // Clear for drying tests
    await evalPage(script(() => {
      const button = [...document.querySelectorAll('button')].find((el) => el.textContent?.includes('Clear Layer'));
      button?.click();
    }));
    await new Promise(r => setTimeout(r, 200));

    // --- PHASE 3 TESTS ---

    // 1. Dried Wash Boundary Ring Darker than Interior (Coffee Ring Effect)
    console.log('Running test: Dried Wash Boundary Ring (Coffee Ring)...');
    await evalPage(script(() => {
      const sim = window.__fluidTest.getActiveSim();
      if (sim) sim.injectPaint(400, 400, 14, 227, 38, 54, 1.4, 1.2);
    }));
    await new Promise(r => setTimeout(r, 100));
    await evalPage(script(() => {
      const sim = window.__fluidTest.getActiveSim();
      if (sim) sim.injectPaint(400, 400, 11, 0, 0, 0, 1.4, 0.0);
    }));
    check('Fluid simulation runs', await evalPage('window.__fluidTest.isActive()'));
    check('Fluid dries completely', await waitFor('!window.__fluidTest.isActive()', 15000));

    const edgeDarkeningCheck = await evalPage(script(() => {
      const canvas = document.querySelector('canvas.cursor-crosshair');
      const ctx = canvas.getContext('2d');
      
      function getLuminance(x, y) {
        const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        return d[0] * 0.299 + d[1] * 0.587 + d[2] * 0.114;
      }
      
      const centerL = getLuminance(400, 400);
      
      // Find the darkest edge ring between radius 12 and 28
      let minEdgeL = 255;
      let minEdgeR = 0;
      for (let r = 12; r <= 28; r++) {
        const edgeSamples = [];
        for (let i = 0; i < 16; i++) {
          const a = (i * Math.PI) / 8;
          edgeSamples.push(getLuminance(400 + Math.cos(a) * r, 400 + Math.sin(a) * r));
        }
        const avgEdgeL = edgeSamples.reduce((sum, v) => sum + v, 0) / edgeSamples.length;
        if (avgEdgeL < minEdgeL) {
          minEdgeL = avgEdgeL;
          minEdgeR = r;
        }
      }
      
      return { centerL, avgEdgeL: minEdgeL, difference: centerL - minEdgeL, radius: minEdgeR };
    }));

    check('Boundary ring is darker than interior', edgeDarkeningCheck && edgeDarkeningCheck.difference > 2.0, JSON.stringify(edgeDarkeningCheck));

    // 2. Rough vs Hotpress Paper Variance
    console.log('Running test: Rough vs Hotpress Paper Variance...');
    await evalPage(script(() => {
      const button = [...document.querySelectorAll('button')].find((el) => el.textContent?.includes('Clear Layer'));
      button?.click();
    }));
    await new Promise(r => setTimeout(r, 200));

    await evalPage(script(() => {
      const sim = window.__fluidTest.getActiveSim();
      if (sim) sim.injectPaint(400, 400, 14, 227, 38, 54, 1.4, 1.2);
    }));
    check('Rough wash dries', await waitFor('!window.__fluidTest.isActive()', 15000));

    const roughVariance = await evalPage(script(() => {
      const canvas = document.querySelector('canvas.cursor-crosshair');
      const ctx = canvas.getContext('2d');
      const w = 10;
      const data = ctx.getImageData(395, 395, w, w).data;
      const lums = [];
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 10) {
          lums.push(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
        }
      }
      const mean = lums.reduce((a, b) => a + b, 0) / lums.length;
      const stddev = Math.sqrt(lums.reduce((a, b) => a + (b - mean) ** 2, 0) / lums.length);
      return { mean, stddev, count: lums.length };
    }));

    // Switch to smooth hotpress
    await evalPage(script(() => {
      const select = [...document.querySelectorAll('select')].find((el) => [...el.options].some((option) => option.value === 'smooth_hotpress'));
      if (select) {
        select.value = 'smooth_hotpress';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      
      // Clear layer
      const button = [...document.querySelectorAll('button')].find((el) => el.textContent?.includes('Clear Layer'));
      button?.click();
    }));
    await new Promise(r => setTimeout(r, 400));

    // Paint on smooth hotpress
    await evalPage(script(() => {
      const sim = window.__fluidTest.getActiveSim();
      if (sim) sim.injectPaint(400, 400, 14, 227, 38, 54, 1.4, 1.2);
    }));
    check('Hotpress wash dries', await waitFor('!window.__fluidTest.isActive()', 15000));

    const hotpressVariance = await evalPage(script(() => {
      const canvas = document.querySelector('canvas.cursor-crosshair');
      const ctx = canvas.getContext('2d');
      const w = 10;
      const data = ctx.getImageData(395, 395, w, w).data;
      const lums = [];
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 10) {
          lums.push(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
        }
      }
      const mean = lums.reduce((a, b) => a + b, 0) / lums.length;
      const stddev = Math.sqrt(lums.reduce((a, b) => a + (b - mean) ** 2, 0) / lums.length);
      return { mean, stddev, count: lums.length };
    }));

    check('Rough paper variance is higher than hotpress paper', roughVariance.stddev > hotpressVariance.stddev + 1.0, `Rough stddev: ${roughVariance.stddev.toFixed(2)}, Hotpress stddev: ${hotpressVariance.stddev.toFixed(2)}`);

    // 3. Clean Water Dab Backrun Rim
    console.log('Running test: Clean Water Dab Backrun Rim...');
    // Clear and change paper back to rough
    await evalPage(script(() => {
      const select = [...document.querySelectorAll('select')].find((el) => [...el.options].some((option) => option.value === 'rough_watercolor'));
      if (select) {
        select.value = 'rough_watercolor';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      
      const button = [...document.querySelectorAll('button')].find((el) => el.textContent?.includes('Clear Layer'));
      button?.click();
    }));
    await new Promise(r => setTimeout(r, 300));

    // Paint a color wash
    await evalPage(script(() => {
      const sim = window.__fluidTest.getActiveSim();
      if (sim) sim.injectPaint(400, 400, 14, 227, 38, 54, 1.4, 1.2);
    }));
    await new Promise(r => setTimeout(r, 350)); // wait a bit so it starts drying

    // Inject clean water directly into the simulator
    await evalPage(script(() => {
      const sim = window.__fluidTest.getActiveSim();
      if (!sim) return;
      sim.injectPaint(400, 400, 10, 0, 0, 0, 1.4, 0.0);
    }));

    check('Backrun dries completely', await waitFor('!window.__fluidTest.isActive()', 15000));

    const backrunCheck = await evalPage(script(() => {
      const canvas = document.querySelector('canvas.cursor-crosshair');
      const ctx = canvas.getContext('2d');
      
      function getLuminance(x, y) {
        const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        return d[0] * 0.299 + d[1] * 0.587 + d[2] * 0.114;
      }
      
      const centerL = getLuminance(400, 400); // should be lighter (diluted)
      
      // Find the darkest rim between radius 8 and 18
      let minRimL = 255;
      let minRimR = 0;
      for (let r = 8; r <= 18; r++) {
        const rimSamples = [];
        for (let i = 0; i < 16; i++) {
          const a = (i * Math.PI) / 8;
          rimSamples.push(getLuminance(400 + Math.cos(a) * r, 400 + Math.sin(a) * r));
        }
        const avgRimL = rimSamples.reduce((sum, v) => sum + v, 0) / rimSamples.length;
        if (avgRimL < minRimL) {
          minRimL = avgRimL;
          minRimR = r;
        }
      }
      
      return { centerL, avgRimL: minRimL, difference: centerL - minRimL, radius: minRimR };
    }));

    check('Clean water dab creates dark backrun rim', backrunCheck && backrunCheck.difference > 3.0, JSON.stringify(backrunCheck));

    // 4. Subtractive Overlap Darkening (Glazing)
    console.log('Running test: Subtractive Overlap Darkening (Glazing)...');
    await evalPage(script(() => {
      const button = [...document.querySelectorAll('button')].find((el) => el.textContent?.includes('Clear Layer'));
      button?.click();
    }));
    await new Promise(r => setTimeout(r, 200));

    // Paint Blue Stroke
    await evalPage(script(() => {
      const sim = window.__fluidTest.getActiveSim();
      if (!sim) return;
      sim.injectPaint(375, 400, 30, 30, 144, 255, 0.8, 0.8);
    }));
    check('Blue stroke dries', await waitFor('!window.__fluidTest.isActive()', 15000));

    // Paint Red Stroke overlapping
    await evalPage(script(() => {
      const sim = window.__fluidTest.getActiveSim();
      if (!sim) return;
      sim.injectPaint(425, 400, 30, 227, 38, 54, 0.8, 0.8);
    }));
    check('Red stroke dries', await waitFor('!window.__fluidTest.isActive()', 15000));

    // Measure overlap (x=400, y=400) vs blue-only (x=360, y=400) vs red-only (x=440, y=400)
    const glazingCheck = await evalPage(script(() => {
      const canvas = document.querySelector('canvas.cursor-crosshair');
      const ctx = canvas.getContext('2d');
      
      function getLuminance(x, y) {
        const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        return d[0] * 0.299 + d[1] * 0.587 + d[2] * 0.114;
      }
      
      const blueL = getLuminance(355, 400);
      const redL = getLuminance(445, 400);
      const overlapL = getLuminance(400, 400);
      
      return { blueL, redL, overlapL };
    }));

    check('Glazing: overlap is darker than individual strokes', glazingCheck && glazingCheck.overlapL < glazingCheck.blueL && glazingCheck.overlapL < glazingCheck.redL, JSON.stringify(glazingCheck));

    // --- FINAL REPORT ---
    const materialErrors = browserErrors.filter((message) => !message.includes('favicon') && !message.includes('404 (Not Found)'));
    check('No browser console/runtime errors', materialErrors.length === 0, materialErrors.slice(0, 5).join(' | '));

    const passed = checks.filter((item) => item.pass).length;
    const failed = checks.length - passed;
    console.log(`Fluid Phase 2 & 3 smoke: ${passed}/${checks.length} passed`);
    for (const item of checks) {
      console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`);
    }
    if (warnings.length) console.log(`Warnings: ${warnings.join(' | ')}`);
    if (failed) process.exitCode = 1;
  } finally {
    cdp?.close();
    await stopProcess(chrome);
    await fs.rm(PROFILE_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exitCode = 1;
});
