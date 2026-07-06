import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const APP_URL = process.env.FLUID_TEST_URL ?? 'http://127.0.0.1:3000/?fluidTest=1';
const DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT ?? 9223);
const PROFILE_DIR = path.join(os.tmpdir(), `brushes-fluid-smoke-${Date.now()}`);

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
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
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
    cdp.on('Page.javascriptDialogOpening', () => {
      cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch((err) => warnings.push(err.message));
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.navigate', { url: APP_URL });

    async function evalPage(expression) {
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

    async function canvasRect(selector) {
      return evalPage(script((sel) => {
        const canvas = document.querySelector(sel);
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
        };
      }, selector));
    }

    async function mouseStroke(selector, points) {
      const rect = await canvasRect(selector);
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
        force: 0.65,
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
          force: 0.65,
        });
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

    await waitFor('document.readyState === "complete"');
    await evalPage('localStorage.clear(); location.reload(); true');
    await waitFor('document.readyState === "complete" && document.body.textContent.includes("Natural Media Art Studio")');

    const opened = await evalPage(script(() => {
      const heading = [...document.querySelectorAll('h3')].find((el) => el.textContent?.includes('Watercolor Fluid Blend'));
      const card = heading?.closest('.group');
      const target = card?.querySelector('.aspect-square');
      target?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return Boolean(target);
    }));
    check('Opened watercolor canvas', opened);
    check('Fluid test bridge available', await waitFor('Boolean(window.__fluidTest && document.querySelector("canvas.cursor-crosshair"))', 10000));

    const strokeBase = await evalPage(script(() => {
      const canvas = document.querySelector('canvas.cursor-crosshair');
      const ctx = canvas.getContext('2d', { willReadFrequently: true }) ?? canvas.getContext('2d');
      function avg(points, radius = 3) {
        let r = 0, g = 0, b = 0, count = 0;
        for (const [x, y] of points) {
          const x0 = Math.max(0, Math.round(x - radius));
          const y0 = Math.max(0, Math.round(y - radius));
          const w = Math.min(canvas.width - x0, radius * 2 + 1);
          const h = Math.min(canvas.height - y0, radius * 2 + 1);
          const data = ctx.getImageData(x0, y0, w, h).data;
          for (let i = 0; i < data.length; i += 4) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
          }
        }
        return { r: r / count, g: g / count, b: b / count };
      }

      const pathPoints = [];
      for (let x = 300; x <= 500; x += 25) pathPoints.push([x, 400]);
      const bleedPoints = [];
      for (let x = 320; x <= 480; x += 40) bleedPoints.push([x, 420], [x, 380]);
      const basePath = avg(pathPoints);
      const baseBleed = avg(bleedPoints);
      return { basePath, baseBleed };
    }));

    const strokePoints = [];
    for (let i = 0; i <= 24; i++) strokePoints.push([280 + i * 10, 400 + Math.sin(i / 4) * 4]);
    await mouseStroke('canvas.cursor-crosshair', strokePoints);

    const stroke = await evalPage(script(async (base) => {
      const canvas = document.querySelector('canvas.cursor-crosshair');
      const ctx = canvas.getContext('2d', { willReadFrequently: true }) ?? canvas.getContext('2d');
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const frames = async (count) => { for (let i = 0; i < count; i++) await frame(); };
      await frames(60);

      function avg(points, radius = 3) {
        let r = 0, g = 0, b = 0, count = 0;
        for (const [x, y] of points) {
          const x0 = Math.max(0, Math.round(x - radius));
          const y0 = Math.max(0, Math.round(y - radius));
          const w = Math.min(canvas.width - x0, radius * 2 + 1);
          const h = Math.min(canvas.height - y0, radius * 2 + 1);
          const data = ctx.getImageData(x0, y0, w, h).data;
          for (let i = 0; i < data.length; i += 4) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
          }
        }
        return { r: r / count, g: g / count, b: b / count };
      }

      const pathPoints = [];
      for (let x = 300; x <= 500; x += 25) pathPoints.push([x, 400]);
      const bleedPoints = [];
      for (let x = 320; x <= 480; x += 40) bleedPoints.push([x, 420], [x, 380]);
      const afterPath = avg(pathPoints);
      const afterBleed = avg(bleedPoints);
      const { basePath, baseBleed } = base;

      return {
        pathRednessGain: afterPath.r - (afterPath.g + afterPath.b) / 2 - (basePath.r - (basePath.g + basePath.b) / 2),
        bleedRednessGain: afterBleed.r - (afterBleed.g + afterBleed.b) / 2 - (baseBleed.r - (baseBleed.g + baseBleed.b) / 2),
        pathDelta: Math.hypot(afterPath.r - basePath.r, afterPath.g - basePath.g, afterPath.b - basePath.b),
        bleedDelta: Math.hypot(afterBleed.r - baseBleed.r, afterBleed.g - baseBleed.g, afterBleed.b - baseBleed.b),
        afterPath,
        basePath,
      };
    }, strokeBase));

    check('Stroke leaves reddish paint on path', stroke.pathRednessGain > 18 && stroke.pathDelta > 15, JSON.stringify(stroke));
    check('Stroke creates nearby bleed tint', stroke.bleedRednessGain > 3 || stroke.bleedDelta > 5, JSON.stringify(stroke));

    check('Fluid dries inactive', await waitFor('!window.__fluidTest.isActive()', 12000));

    const dried = await evalPage(script(() => {
      const canvas = document.querySelector('canvas.cursor-crosshair');
      const ctx = canvas.getContext('2d', { willReadFrequently: true }) ?? canvas.getContext('2d');
      const data = ctx.getImageData(390, 395, 20, 10).data;
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count++;
      }
      const color = { r: r / count, g: g / count, b: b / count };
      return {
        color,
        redness: color.r - (color.g + color.b) / 2,
        luminance: color.r * 0.299 + color.g * 0.587 + color.b * 0.114,
      };
    }));
    check('Dried stain persists', dried.luminance < 248.0, JSON.stringify(dried));

    const clearResult = await evalPage(script(async () => {
      const before = (() => {
        const canvas = document.querySelector('canvas.cursor-crosshair');
        const ctx = canvas.getContext('2d', { willReadFrequently: true }) ?? canvas.getContext('2d');
        return [...ctx.getImageData(390, 395, 20, 10).data];
      })();
      const button = [...document.querySelectorAll('button')].find((el) => el.textContent?.includes('Clear Layer'));
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      const canvas = document.querySelector('canvas.cursor-crosshair');
      const ctx = canvas.getContext('2d', { willReadFrequently: true }) ?? canvas.getContext('2d');
      const after = [...ctx.getImageData(390, 395, 20, 10).data];
      function avgColor(data) {
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
        }
        return { r: r / count, g: g / count, b: b / count };
      }
      function luminance(color) {
        return color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
      }
      const beforeColor = avgColor(before);
      const afterColor = avgColor(after);
      return { before: luminance(beforeColor), after: luminance(afterColor), beforeColor, afterColor, clicked: Boolean(button) };
    }));
    check('Clear Layer removes watercolor stain', clearResult.clicked && clearResult.after > clearResult.before + 10.0 && clearResult.after > 250.0, JSON.stringify(clearResult));

    const bloomBase = await evalPage(script(() => {
      const canvas = document.querySelector('canvas.cursor-crosshair');
      const ctx = canvas.getContext('2d', { willReadFrequently: true }) ?? canvas.getContext('2d');
      function sample(x, y) {
        const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        return { r: d[0], g: d[1], b: d[2] };
      }
      const cx = 400, cy = 540;
      const radii = [8, 12, 16, 20, 24, 28];
      const base = radii.map((radius) => {
        const ring = [];
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4;
          ring.push(sample(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius));
        }
        return ring;
      });
      return { base, cx, cy, radii };
    }));

    await mouseStroke('canvas.cursor-crosshair', [[400, 540], [400, 540]]);

    const bloom = await evalPage(script(async ({ base, cx, cy, radii }) => {
      const canvas = document.querySelector('canvas.cursor-crosshair');
      const ctx = canvas.getContext('2d', { willReadFrequently: true }) ?? canvas.getContext('2d');
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const frames = async (count) => { for (let i = 0; i < count; i++) await frame(); };
      function sample(x, y) {
        const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        return { r: d[0], g: d[1], b: d[2] };
      }
      await frames(60);
      const rings = radii.map((radius, radiusIndex) => {
        const deltas = [];
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4;
          const after = sample(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
          const before = base[radiusIndex][i];
          deltas.push(Math.hypot(after.r - before.r, after.g - before.g, after.b - before.b));
        }
        const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        const variance = deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / deltas.length;
        return { radius, mean, stddev: Math.sqrt(variance), coefficient: mean ? Math.sqrt(variance) / mean : 99, deltas };
      });
      return rings.reduce((best, ring) => (ring.mean > best.mean ? ring : best), rings[0]);
    }, bloomBase));
    check('Single dab bloom is broadly round', bloom.mean > 2 && bloom.coefficient < 0.9, JSON.stringify(bloom));

    const grain = await evalPage(script(async () => {
      const before = window.__fluidTest.paperSignature();
      const select = [...document.querySelectorAll('select')].find((el) => [...el.options].some((option) => option.value === 'smooth_hotpress'));
      select.value = 'smooth_hotpress';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const after = window.__fluidTest.paperSignature();
      const rms = Math.sqrt(before.reduce((sum, value, i) => sum + (value - after[i]) ** 2, 0) / before.length);
      return { rms, before: before.slice(0, 4), after: after.slice(0, 4) };
    }));
    check('Paper-type switch regenerates grain', grain.rms > 0.02, JSON.stringify(grain));

    const perfMs = await evalPage('window.__fluidTest.measureStepDraw(1200)');
    check('1200x1200 step + drawToContext near 4ms', perfMs < 5, `${perfMs.toFixed(2)}ms`);

    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor('document.readyState === "complete" && document.body.textContent.includes("Studio Craft Labs")');
    const studioOpened = await evalPage(script(() => {
      const button = [...document.querySelectorAll('button')].find((el) => el.textContent?.includes('Studio Craft Labs'));
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return Boolean(button);
    }));
    check('Opened StudioPage', studioOpened);
    check('Studio scratchpad visible', await waitFor('[...document.querySelectorAll("canvas")].some((canvas) => canvas.width === 320 && canvas.height === 320)', 10000));

    const scratchBase = await evalPage(script(() => {
      const canvas = [...document.querySelectorAll('canvas')].find((el) => el.width === 320 && el.height === 320);
      const ctx = canvas.getContext('2d', { willReadFrequently: true }) ?? canvas.getContext('2d');
      const base = ctx.getImageData(155, 155, 10, 10).data;
      function avg(data) {
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
        }
        return { r: r / count, g: g / count, b: b / count };
      }
      return avg(base);
    }));

    const scratchPoints = [];
    for (let i = 0; i < 12; i++) scratchPoints.push([120 + i * 8, 160]);
    await mouseStroke('canvas[width="320"][height="320"]', scratchPoints);

    const scratch = await evalPage(script(async (baseAvg) => {
      const canvas = [...document.querySelectorAll('canvas')].find((el) => el.width === 320 && el.height === 320);
      const ctx = canvas.getContext('2d', { willReadFrequently: true }) ?? canvas.getContext('2d');
      await new Promise((resolve) => setTimeout(resolve, 500));
      const after = ctx.getImageData(155, 155, 10, 10).data;
      function avg(data) {
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
        }
        return { r: r / count, g: g / count, b: b / count };
      }
      const afterAvg = avg(after);
      return {
        delta: Math.hypot(afterAvg.r - baseAvg.r, afterAvg.g - baseAvg.g, afterAvg.b - baseAvg.b),
        base: baseAvg,
        after: afterAvg,
      };
    }, scratchBase));
    check('StudioPage scratchpad paints', scratch.delta > 8, JSON.stringify(scratch));

    const materialErrors = browserErrors.filter((message) => !message.includes('favicon') && !message.includes('404 (Not Found)'));
    check('No browser console/runtime errors', materialErrors.length === 0, materialErrors.slice(0, 5).join(' | '));

    const passed = checks.filter((item) => item.pass).length;
    const failed = checks.length - passed;
    console.log(`Fluid Phase 1 smoke: ${passed}/${checks.length} passed`);
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
