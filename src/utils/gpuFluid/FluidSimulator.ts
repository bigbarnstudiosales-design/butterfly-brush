import { PaperSettings } from '../../types';
import { PaperGrainField } from '../paperGrain';
import { acquireGL, releaseGL, SharedGL } from './glContext';
import { Field, SingleField } from './pingPong';
import { Program, bindPass, drawFullscreen } from './programs';
import {
  FRAG_SPLAT_VEL,
  FRAG_SPLAT_PIGMENT,
  FRAG_ADVECT_VEL,
  FRAG_ADVECT_PIGMENT,
  FRAG_DEPOSIT,
  FRAG_RENDER,
  FRAG_DIVERGENCE,
  FRAG_JACOBI,
  FRAG_PROJECTION,
  FRAG_RENDER_DIV,
} from './shaders';

interface ProgramSet {
  splatVel: Program;
  splatPigment: Program;
  advectVel: Program;
  advectPigment: Program;
  deposit: Program;
  render: Program;
  divergence: Program;
  jacobi: Program;
  projection: Program;
  renderDiv: Program;
}

// One compiled program set per GL context, shared by all simulators.
const programCache = new WeakMap<WebGL2RenderingContext, ProgramSet>();

function getPrograms(gl: WebGL2RenderingContext): ProgramSet {
  let set = programCache.get(gl);
  if (!set) {
    set = {
      splatVel: new Program(gl, FRAG_SPLAT_VEL),
      splatPigment: new Program(gl, FRAG_SPLAT_PIGMENT),
      advectVel: new Program(gl, FRAG_ADVECT_VEL),
      advectPigment: new Program(gl, FRAG_ADVECT_PIGMENT),
      deposit: new Program(gl, FRAG_DEPOSIT),
      render: new Program(gl, FRAG_RENDER),
      divergence: new Program(gl, FRAG_DIVERGENCE),
      jacobi: new Program(gl, FRAG_JACOBI),
      projection: new Program(gl, FRAG_PROJECTION),
      renderDiv: new Program(gl, FRAG_RENDER_DIV),
    };
    programCache.set(gl, set);
  }
  return set;
}

// Water is stored 0..1 (CPU engine used 0..5); see shaders.ts header.
const WATER_CAP_CPU = 5.0;
const ACTIVE_EPS = 0.01 / WATER_CAP_CPU; // CPU dry threshold, normalized
const K_DIFF = 0.03;

export class FluidSimulator {
  // Sim grid dims (canvas / scale), kept public like the CPU class.
  public width: number;
  public height: number;
  public scale: number;

  private canvasWidth: number;
  private canvasHeight: number;

  private shared: SharedGL;
  private gl: WebGL2RenderingContext;
  private programs: ProgramSet;

  private velWater!: Field; // (u, v, water/5, fiberSat)
  private pigment!: Field;  // (r, g, b, unused) in 0..255
  private deposit!: Field;  // (dryR, dryG, dryB, dryAlpha) in 0..255
  private grain!: SingleField; // R16F height
  private pressure!: Field;   // Pressure field for Jacobi
  private divergence!: SingleField; // Velocity divergence field
  private mrtFbo!: WebGLFramebuffer;
  private highPrecision: boolean;

  // Last uploaded grain samples, kept for context-restore re-upload.
  private grainData: Float32Array;

  // CPU-side activity upper bound (no GPU readbacks): injections raise it
  // to the cap, each step subtracts the guaranteed minimum evaporation.
  private wetness = 0;
  private finalFramePending = false;

  // Staining of the pigment currently on this layer (0 = granulating, 1 =
  // staining). Set per injection; the deposit pass reads it while drying.
  private currentStaining = 0.7;

  // Last 2D canvas we blitted into; used to approximately reseed the dry
  // deposit layer if the GL context is lost and restored.
  private lastBlitCanvas: HTMLCanvasElement | null = null;
  private unsubscribeRestore: () => void;
  private disposed = false;

  constructor(canvasWidth: number, canvasHeight: number, scale: number = 2, highPrecision: boolean = false) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.scale = scale;
    this.width = Math.ceil(canvasWidth / scale);
    this.height = Math.ceil(canvasHeight / scale);
    this.highPrecision = highPrecision;

    this.shared = acquireGL();
    this.gl = this.shared.gl;
    this.programs = getPrograms(this.gl);
    this.grainData = new Float32Array(this.width * this.height);

    this.createResources();

    this.unsubscribeRestore = this.shared.onContextRestored(() => this.handleContextRestored());
  }

  private createResources(): void {
    const gl = this.gl;
    const formatRGBA = this.highPrecision ? gl.RGBA32F : gl.RGBA16F;
    const formatR = this.highPrecision ? gl.R32F : gl.R16F;

    this.velWater = new Field(gl, this.width, this.height, formatRGBA, gl.LINEAR);
    this.pigment = new Field(gl, this.width, this.height, formatRGBA, gl.LINEAR);
    this.deposit = new Field(gl, this.width, this.height, formatRGBA, gl.LINEAR);
    this.grain = new SingleField(gl, this.width, this.height, formatR, gl.LINEAR);
    
    this.pressure = new Field(gl, this.width, this.height, formatR, gl.NEAREST);
    this.divergence = new SingleField(gl, this.width, this.height, formatR, gl.NEAREST);

    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('Failed to create MRT framebuffer');
    this.mrtFbo = fbo;
  }

  /**
   * Samples the shared grain field into a Float32Array at sim resolution
   * (same CPU loop as before) and uploads it as an R16F/R32F texture.
   */
  public generatePaperGrain(settings: PaperSettings, grainField: PaperGrainField): void {
    const roughness = settings.roughness;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.grainData[y * this.width + x] = grainField.heightAt(x * this.scale, y * this.scale) * roughness;
      }
    }
    this.grain.uploadR(this.grainData);
  }

  /**
   * Deposit water + pigment at a canvas location. Runs two tiny scissored
   * splat draws blended directly into the current read textures — cheap
   * enough to run once per interpolated brush stamp, no batching needed.
   */
  public injectPaint(
    canvasX: number,
    canvasY: number,
    radius: number,
    r: number,
    g: number,
    b: number,
    amount: number,
    pigmentLoad: number,
    staining: number = 0.7
  ): void {
    if (this.disposed) return;
    this.currentStaining = staining;
    const gl = this.gl;
    const p = this.programs;

    const cx = canvasX / this.scale;
    const cy = canvasY / this.scale;
    const rad = Math.max(0.75, radius / this.scale);

    // Scissor to the splat bounding box (texture row 0 = canvas top = GL row 0;
    // no flip inside the sim, so scissor Y maps directly).
    const x0 = Math.max(0, Math.floor(cx - rad) - 1);
    const y0 = Math.max(0, Math.floor(cy - rad) - 1);
    const x1 = Math.min(this.width, Math.ceil(cx + rad) + 1);
    const y1 = Math.min(this.height, Math.ceil(cy + rad) + 1);
    if (x1 <= x0 || y1 <= y0) return;
    const scissor = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };

    // 1. Water + outward velocity, additive
    bindPass(gl, p.splatVel, this.velWater.fboRead, this.width, this.height, {
      scissor,
      blend: { srcRGB: gl.ONE, dstRGB: gl.ONE, srcAlpha: gl.ONE, dstAlpha: gl.ONE },
    });
    gl.uniform2f(p.splatVel.uniform('u_simSize'), this.width, this.height);
    gl.uniform2f(p.splatVel.uniform('u_center'), cx, cy);
    gl.uniform1f(p.splatVel.uniform('u_radius'), rad);
    gl.uniform1f(p.splatVel.uniform('u_amount'), amount);
    drawFullscreen(gl);

    // 2. Pigment, src-alpha blend (reproduces CPU 0.3*old + 0.7*new)
    bindPass(gl, p.splatPigment, this.pigment.fboRead, this.width, this.height, {
      scissor,
      blend: { srcRGB: gl.SRC_ALPHA, dstRGB: gl.ONE_MINUS_SRC_ALPHA, srcAlpha: gl.ZERO, dstAlpha: gl.ONE },
    });
    gl.uniform2f(p.splatPigment.uniform('u_simSize'), this.width, this.height);
    gl.uniform2f(p.splatPigment.uniform('u_center'), cx, cy);
    gl.uniform1f(p.splatPigment.uniform('u_radius'), rad);
    gl.uniform3f(p.splatPigment.uniform('u_color'), r, g, b);
    gl.uniform1f(p.splatPigment.uniform('u_pigmentLoad'), pigmentLoad);
    drawFullscreen(gl);

    this.wetness = 1.0;
  }

  /** One physics step: advect velocity/water, advect pigment, settle/deposit. */
  public step(paper: PaperSettings): void {
    if (this.disposed) return;
    const gl = this.gl;
    const p = this.programs;
    const texelX = 1 / this.width;
    const texelY = 1 / this.height;
    const absorb = 0.005 * (1 + paper.absorption * 2);

    // 1. Velocity + water: advection, slope force, bleed, evaporation
    bindPass(gl, p.advectVel, this.velWater.fboWrite, this.width, this.height);
    p.advectVel.bindTexture('u_velWater', this.velWater.read, 0);
    p.advectVel.bindTexture('u_grain', this.grain.tex, 1);
    gl.uniform2f(p.advectVel.uniform('u_texel'), texelX, texelY);
    gl.uniform1f(p.advectVel.uniform('u_grainDepth'), paper.grainDepth);
    gl.uniform1f(p.advectVel.uniform('u_absorb'), absorb);
    gl.uniform1f(p.advectVel.uniform('u_kDiff'), K_DIFF);
    drawFullscreen(gl);
    this.velWater.swap();

    // 2. Compute Divergence
    bindPass(gl, p.divergence, this.divergence.fbo, this.width, this.height);
    p.divergence.bindTexture('u_velWater', this.velWater.read, 0);
    gl.uniform2f(p.divergence.uniform('u_texel'), texelX, texelY);
    drawFullscreen(gl);

    // 3. Jacobi Pressure Solver (20 iterations, warm-started from last frame)
    const jacobiSteps = 20;
    for (let i = 0; i < jacobiSteps; i++) {
      bindPass(gl, p.jacobi, this.pressure.fboWrite, this.width, this.height);
      p.jacobi.bindTexture('u_pressure', this.pressure.read, 0);
      p.jacobi.bindTexture('u_divergence', this.divergence.tex, 1);
      gl.uniform2f(p.jacobi.uniform('u_texel'), texelX, texelY);
      drawFullscreen(gl);
      this.pressure.swap();
    }

    // 4. Project velocity (gradient subtraction) to make it divergence-free
    bindPass(gl, p.projection, this.velWater.fboWrite, this.width, this.height);
    p.projection.bindTexture('u_velWater', this.velWater.read, 0);
    p.projection.bindTexture('u_pressure', this.pressure.read, 1);
    gl.uniform2f(p.projection.uniform('u_texel'), texelX, texelY);
    drawFullscreen(gl);
    this.velWater.swap();

    // 5. Pigment: advection along the projected velocity + gated bleed + fringe advection
    bindPass(gl, p.advectPigment, this.pigment.fboWrite, this.width, this.height);
    p.advectPigment.bindTexture('u_pigment', this.pigment.read, 0);
    p.advectPigment.bindTexture('u_velWater', this.velWater.read, 1);
    gl.uniform2f(p.advectPigment.uniform('u_texel'), texelX, texelY);
    gl.uniform1f(p.advectPigment.uniform('u_kDiff'), K_DIFF);
    drawFullscreen(gl);
    this.pigment.swap();

    // 6. Settle/deposit (MRT: pigment + deposit written together)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.mrtFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pigment.write, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.deposit.write, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    bindPass(gl, p.deposit, this.mrtFbo, this.width, this.height);
    p.deposit.bindTexture('u_pigment', this.pigment.read, 0);
    p.deposit.bindTexture('u_deposit', this.deposit.read, 1);
    p.deposit.bindTexture('u_velWater', this.velWater.read, 2);
    p.deposit.bindTexture('u_grain', this.grain.tex, 3);
    gl.uniform2f(p.deposit.uniform('u_texel'), texelX, texelY);
    gl.uniform1f(p.deposit.uniform('u_staining'), this.currentStaining);
    drawFullscreen(gl);
    // Restore single-attachment convention before other passes reuse FBOs
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    this.pigment.swap();
    this.deposit.swap();

    // Activity bound: subtract the guaranteed per-step evaporation
    const prev = this.wetness;
    this.wetness = Math.max(0, this.wetness - absorb / WATER_CAP_CPU);
    if (prev > ACTIVE_EPS && this.wetness <= ACTIVE_EPS) {
      this.finalFramePending = true;
    }
  }

  /**
   * True while there may be wet paint to simulate/render. Replaces the old
   * CPU-side sparse scans of the water array; reading the GPU texture back
   * every frame would stall the pipeline, so this is a conservative
   * CPU-side upper bound instead.
   */
  public isActive(): boolean {
    return this.wetness > ACTIVE_EPS || this.finalFramePending;
  }

  /**
   * Render the sim into the shared GL canvas at full canvas resolution and
   * blit it into the caller's 2D canvas. Same-task drawImage is guaranteed
   * to see the frame even with preserveDrawingBuffer: false.
   */
  public drawToContext(ctx: CanvasRenderingContext2D): void {
    if (this.disposed) return;
    const gl = this.gl;
    const p = this.programs;
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;

    this.shared.ensureSize(cw, ch);

    const debugDiv = typeof window !== 'undefined' && window.location.search.includes('fluidDebug=div');

    if (debugDiv) {
      bindPass(gl, p.renderDiv, null, cw, ch);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      p.renderDiv.bindTexture('u_divergence', this.divergence.tex, 0);
    } else {
      bindPass(gl, p.render, null, cw, ch);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      p.render.bindTexture('u_pigment', this.pigment.read, 0);
      p.render.bindTexture('u_deposit', this.deposit.read, 1);
      p.render.bindTexture('u_velWater', this.velWater.read, 2);
    }
    drawFullscreen(gl);

    // Viewport (0,0,cw,ch) is the BOTTOM-left of the GL canvas in image
    // space, i.e. rect (0, glH-ch, cw, ch) for drawImage.
    const glH = this.shared.canvas.height;
    ctx.drawImage(this.shared.canvas, 0, glH - ch, cw, ch, 0, 0, cw, ch);

    this.lastBlitCanvas = ctx.canvas;
    this.finalFramePending = false;
  }

  /** Read back the divergence field from GPU memory. Useful for testing. */
  public getDivergenceField(): Float32Array {
    if (this.disposed) return new Float32Array(0);
    const gl = this.gl;
    const data = new Float32Array(this.width * this.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.divergence.fbo);
    gl.readPixels(0, 0, this.width, this.height, gl.RED, gl.FLOAT, data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return data;
  }

  /** Read back the pressure field from GPU memory. Useful for testing. */
  public getPressureField(): Float32Array {
    if (this.disposed) return new Float32Array(0);
    const gl = this.gl;
    const data = new Float32Array(this.width * this.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pressure.fboRead);
    gl.readPixels(0, 0, this.width, this.height, gl.RED, gl.FLOAT, data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return data;
  }

  /** Clear all paint (wet + dry). Paper grain is kept. */
  public clear(): void {
    if (this.disposed) return;
    this.velWater.clear();
    this.pigment.clear();
    this.deposit.clear();
    this.pressure.clear();
    this.divergence.clear();
    this.wetness = 0;
    this.finalFramePending = false;
  }

  /** Free all GPU resources. The simulator is unusable afterwards. */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeRestore();
    this.velWater.dispose();
    this.pigment.dispose();
    this.deposit.dispose();
    this.grain.dispose();
    this.pressure.dispose();
    this.divergence.dispose();
    this.gl.deleteFramebuffer(this.mrtFbo);
    releaseGL();
  }

  /**
   * Context-restored recovery: rebuild GPU resources, re-upload the cached
   * grain, and approximately reseed the dry deposit from the last blitted
   * 2D canvas (which still holds the last rendered frame). Wet paint is
   * lost — acceptable: "the water spilled".
   */
  private handleContextRestored(): void {
    if (this.disposed) return;
    programCache.delete(this.gl);
    this.programs = getPrograms(this.gl);
    this.createResources();
    this.grain.uploadR(this.grainData);
    this.wetness = 0;
    this.finalFramePending = false;

    if (!this.lastBlitCanvas) return;
    try {
      const tmp = document.createElement('canvas');
      tmp.width = this.width;
      tmp.height = this.height;
      const tctx = tmp.getContext('2d');
      if (!tctx) return;
      tctx.drawImage(this.lastBlitCanvas, 0, 0, this.width, this.height);
      const img = tctx.getImageData(0, 0, this.width, this.height);
      const data = new Float32Array(this.width * this.height * 4);
      for (let i = 0; i < this.width * this.height; i++) {
        data[i * 4] = img.data[i * 4];
        data[i * 4 + 1] = img.data[i * 4 + 1];
        data[i * 4 + 2] = img.data[i * 4 + 2];
        data[i * 4 + 3] = img.data[i * 4 + 3];
      }
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.deposit.read);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl.RGBA, gl.FLOAT, data);
    } catch {
      // Reseed is best-effort; a blank layer is the fallback.
    }
  }
}

