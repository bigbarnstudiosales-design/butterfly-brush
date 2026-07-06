/**
 * Natural Media Brush Engine
 * 
 * Implements physical media interactions for Oil, Watercolor, Charcoal, 
 * Pastel, Graphite Pencil, Ink Pen, and Alcohol Markers.
 * 
 * Incorporates:
 *   - Stylus pressure and speed dynamics.
 *   - Paper grain interaction (depositing on peaks, filling valleys under pressure).
 *   - Wet paint mixing, depletion, and color pick-up.
 */

import { BrushSettings, PaperSettings } from '../types';
import { blendKM, RGB, hexToPigmentMix, pigmentMixToRGB, pigmentMixToStaining, DEFAULT_STAINING } from './kubelkaMunk';
import { FluidSimulator, ImpastoEngine } from './fluidDynamics';
import { PaperGrainField } from './paperGrain';

export class BrushEngine {
  private lastX: number | null = null;
  private lastY: number | null = null;
  private lastPressure: number = 0.5;

  // Active brush medium states
  public loadedPaint: RGB = { r: 255, g: 0, b: 0 };
  public currentLoad: number = 1.0; // depletion factor [0..1]

  // Underlying-canvas color sampled once per stroke segment (not per micro-stamp)
  // for oil smearing. Re-sampling per pointer-move event, rather than per
  // interpolated dab, avoids a synchronous getImageData readback on every dab.
  private underlyingColorCache: RGB | null = null;

  // Reusable scratch canvas for hard-media (charcoal/pastel/graphite) stamps,
  // resized on demand instead of allocating a new <canvas> per dab.
  private scratchCanvas: HTMLCanvasElement | null = null;

  constructor() {
    this.resetStroke();
  }

  public resetStroke() {
    this.lastX = null;
    this.lastY = null;
    this.lastPressure = 0.5;
    this.currentLoad = 1.0;
    this.underlyingColorCache = null;
  }

  /**
   * Primary entry point for making a brush stroke slice.
   * Interpolates points between last and current coordinates for smooth, high-precision lines.
   */
  public drawStrokeSegment(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number,
    tiltX: number, // in degrees, -90 to 90
    tiltY: number,
    settings: BrushSettings,
    paper: PaperSettings,
    fluidSim: FluidSimulator | null,
    impasto: ImpastoEngine,
    canvasWidth: number,
    canvasHeight: number,
    grainField: PaperGrainField
  ) {
    const startX = this.lastX !== null ? this.lastX : x;
    const startY = this.lastY !== null ? this.lastY : y;
    const startP = this.lastPressure !== null ? this.lastPressure : pressure;

    // Convert hex or pigment color
    if (settings.pigmentMix) {
      this.loadedPaint = pigmentMixToRGB(settings.pigmentMix);
    } else {
      this.loadedPaint = pigmentMixToRGB(hexToPigmentMix(settings.color));
    }

    // Sample the canvas under the brush once per segment (once per pointer
    // move), rather than once per interpolated micro-stamp below. A sync
    // getImageData readback per dab is a major perf cliff at real resolutions.
    if (settings.type === 'oil') {
      this.underlyingColorCache = this.sampleUnderlyingColor(ctx, x, y);
    }

    // Calculate distance and step interpolation
    const dx = x - startX;
    const dy = y - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.floor(dist / Math.max(1, settings.size * 0.05)));

    for (let i = 0; i <= steps; i++) {
      const t = steps > 0 ? i / steps : 1;
      const currX = startX + dx * t;
      const currY = startY + dy * t;
      const currP = startP + (pressure - startP) * t;

      this.applyBrushStamp(
        ctx,
        currX,
        currY,
        currP,
        tiltX,
        tiltY,
        settings,
        paper,
        fluidSim,
        impasto,
        canvasWidth,
        canvasHeight,
        grainField
      );
    }

    this.lastX = x;
    this.lastY = y;
    this.lastPressure = pressure;
  }

  /** Samples the average color under a small radius on the active canvas. Sync/slow — call sparingly. */
  private sampleUnderlyingColor(ctx: CanvasRenderingContext2D, x: number, y: number): RGB | null {
    const rx = Math.round(x);
    const ry = Math.round(y);
    try {
      const imgData = ctx.getImageData(Math.max(0, rx - 2), Math.max(0, ry - 2), 5, 5);
      let totalR = 0, totalG = 0, totalB = 0, count = 0;
      for (let i = 0; i < imgData.data.length; i += 4) {
        if (imgData.data[i + 3] > 10) {
          totalR += imgData.data[i];
          totalG += imgData.data[i + 1];
          totalB += imgData.data[i + 2];
          count++;
        }
      }
      if (count > 0) {
        return { r: totalR / count, g: totalG / count, b: totalB / count };
      }
    } catch {
      // Out of bounds
    }
    return null;
  }

  /**
   * Core physical simulation stamp for a single point.
   */
  private applyBrushStamp(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number,
    tiltX: number,
    tiltY: number,
    settings: BrushSettings,
    paper: PaperSettings,
    fluidSim: FluidSimulator | null,
    impasto: ImpastoEngine,
    canvasWidth: number,
    canvasHeight: number,
    grainField: PaperGrainField
  ) {
    const size = settings.size * (0.3 + pressure * settings.pressureSensitivity * 0.7);
    const opacity = settings.opacity * (0.2 + pressure * (1 - settings.pressureSensitivity) * 0.8);
    const tiltOffsetMultiplier = settings.tiltInfluence * size * 0.5;

    // Apply tilt deflection
    const tiltRadX = (tiltX * Math.PI) / 180;
    const tiltRadY = (tiltY * Math.PI) / 180;
    const brushX = x + Math.sin(tiltRadX) * tiltOffsetMultiplier;
    const brushY = y + Math.sin(tiltRadY) * tiltOffsetMultiplier;

    // Deplete brush load slowly. This runs for every interpolated micro-stamp,
    // so keep the per-stamp amount small enough that a normal stroke does not
    // turn into clear water halfway through the path.
    this.currentLoad = Math.max(0.0, this.currentLoad - (0.0007 / (settings.paintLoad + 0.1)));

    switch (settings.type) {
      case 'watercolor':
        // Requires the GPU fluid engine; silently no-op if it failed to init
        if (fluidSim) this.paintWatercolor(brushX, brushY, size, opacity, settings, fluidSim);
        break;
      case 'oil':
        this.paintOil(ctx, brushX, brushY, size, opacity, settings, impasto);
        break;
      case 'charcoal':
        this.paintHardMedia(ctx, brushX, brushY, size, opacity, settings, paper, grainField, 'charcoal');
        break;
      case 'pastel':
        this.paintHardMedia(ctx, brushX, brushY, size, opacity, settings, paper, grainField, 'pastel');
        break;
      case 'graphite':
        this.paintHardMedia(ctx, brushX, brushY, size, opacity, settings, paper, grainField, 'graphite');
        break;
      case 'ink':
        this.paintInk(ctx, brushX, brushY, size, opacity);
        break;
      case 'marker':
        this.paintMarker(ctx, brushX, brushY, size, opacity, settings, paper);
        break;
    }
  }

  /**
   * Watercolor brush deposits fluid/water and suspended pigments onto the FluidSimulator grid.
   */
  private paintWatercolor(
    x: number,
    y: number,
    size: number,
    opacity: number,
    settings: BrushSettings,
    fluidSim: FluidSimulator
  ) {
    const waterAmt = settings.fluidity * 0.6 + 0.1;
    const pigmentAmt = Math.min(1.5, settings.opacity * this.currentLoad * 1.4);

    // Staining: an explicit brush override wins; otherwise fall back to the
    // natural staining of the loaded pigment mix, then a neutral default.
    const staining = settings.staining
      ?? (settings.pigmentMix ? pigmentMixToStaining(settings.pigmentMix) : DEFAULT_STAINING);

    fluidSim.injectPaint(
      x,
      y,
      size,
      this.loadedPaint.r,
      this.loadedPaint.g,
      this.loadedPaint.b,
      waterAmt,
      pigmentAmt,
      staining
    );
  }

  /**
   * Oil brush applies viscous impasto depth, and smudges underlying canvas paint.
   */
  private paintOil(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    opacity: number,
    settings: BrushSettings,
    impasto: ImpastoEngine
  ) {
    const r = Math.ceil(size / 2);

    // Underlying color was sampled once for this whole stroke segment (see
    // drawStrokeSegment) rather than re-read via getImageData on every dab.
    const underlyingColor = this.underlyingColorCache;

    // 2. Mix loaded brush paint with underlying wet canvas paint using Kubelka-Munk
    let mixColor = this.loadedPaint;
    if (underlyingColor && settings.fluidity > 0) {
      // Fluidity determines how much the brush paint blends/smears with background
      const blendRatio = settings.fluidity * 0.4 * (1 - this.currentLoad * 0.5);
      mixColor = blendKM(this.loadedPaint, underlyingColor, blendRatio);
    }

    // 3. Render brush dab onto canvas context
    ctx.save();
    ctx.beginPath();
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    const alpha = opacity * this.currentLoad;
    grad.addColorStop(0, `rgba(${mixColor.r}, ${mixColor.g}, ${mixColor.b}, ${alpha})`);
    grad.addColorStop(0.7, `rgba(${mixColor.r}, ${mixColor.g}, ${mixColor.b}, ${alpha * 0.4})`);
    grad.addColorStop(1, `rgba(${mixColor.r}, ${mixColor.g}, ${mixColor.b}, 0)`);
    ctx.fillStyle = grad;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 4. Deposit 3D oil impasto volume
    const thickness = opacity * 0.8;
    impasto.depositOil(x, y, r, thickness);
  }

  /**
   * Hard Media (Charcoal, Pastel, Pencil):
   * Uses procedural noise and paper texture to deposit pigment onto canvas peaks.
   */
  private paintHardMedia(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    opacity: number,
    settings: BrushSettings,
    paper: PaperSettings,
    grainField: PaperGrainField,
    media: 'charcoal' | 'pastel' | 'graphite'
  ) {
    const r = Math.max(1, Math.ceil(size / 2));
    const dim = r * 2;
    ctx.save();

    // Reuse one scratch canvas across stamps instead of allocating a new
    // <canvas> element per dab (this ran once per interpolated stroke step).
    const offscreen = this.getScratchCanvas(dim);
    const oCtx = offscreen.getContext('2d');
    if (!oCtx) {
      ctx.restore();
      return;
    }

    const imgData = oCtx.createImageData(dim, dim);
    const data = imgData.data;

    // Physical characteristics
    const softMultiplier = media === 'pastel' ? 1.5 : media === 'charcoal' ? 1.0 : 0.6;
    const baseColor = this.loadedPaint;
    const roughness = paper.roughness;

    for (let dy = -r; dy < r; dy++) {
      for (let dx = -r; dx < r; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > r) continue;

        const idx = ((dy + r) * dim + (dx + r)) * 4;
        const falloff = 1.0 - (dist / r);

        // Shared paper grain field lookup (matches the paper you actually see)
        const grainNoise = grainField.heightAt(x + dx, y + dy);

        // Peak threshold logic:
        // Under light pressure/low thickness, pigment only sticks to the paper mountains.
        // Higher pressure (opacity) fills in the paper valleys.
        const paperPeakThreshold = 1.0 - (opacity * softMultiplier * falloff * (1 + roughness));
        const pigmentStick = grainNoise > paperPeakThreshold ? 1.0 : 0.0;

        if (pigmentStick > 0) {
          // Charcoal is powdery and scatters, graphite is dense, pastel is super rich
          let scatter = Math.random();
          if (media === 'charcoal' && scatter < 0.25) continue; // porous charcoal feel
          if (media === 'graphite' && scatter < 0.15) continue;

          const density = opacity * falloff * pigmentStick * this.currentLoad;
          data[idx] = baseColor.r;
          data[idx + 1] = baseColor.g;
          data[idx + 2] = baseColor.b;
          data[idx + 3] = Math.round(density * 255);
        }
      }
    }

    oCtx.putImageData(imgData, 0, 0);
    ctx.drawImage(offscreen, 0, 0, dim, dim, x - r, y - r, dim, dim);
    ctx.restore();
  }

  /** Reusable scratch canvas, grown on demand, for per-stamp offscreen compositing. */
  private getScratchCanvas(minSize: number): HTMLCanvasElement {
    if (!this.scratchCanvas) {
      this.scratchCanvas = document.createElement('canvas');
    }
    if (this.scratchCanvas.width < minSize) this.scratchCanvas.width = minSize;
    if (this.scratchCanvas.height < minSize) this.scratchCanvas.height = minSize;
    return this.scratchCanvas;
  }

  /**
   * Precise non-bleeding ink pen.
   */
  private paintInk(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    opacity: number
  ) {
    const r = Math.max(0.5, size / 2);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${this.loadedPaint.r}, ${this.loadedPaint.g}, ${this.loadedPaint.b}, ${opacity})`;
    ctx.fill();
    ctx.restore();
  }

  /**
   * Alcohol marker:
   * Layers transparent dye pigments that bleed slightly outward and blend on contact.
   */
  private paintMarker(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    opacity: number,
    settings: BrushSettings,
    paper: PaperSettings
  ) {
    const r = Math.ceil(size / 2);
    ctx.save();
    ctx.beginPath();

    // Markers have an elegant translucent bleed on layout/marker paper
    const bleedRadius = r * (1.0 + paper.absorption * 0.15);
    const grad = ctx.createRadialGradient(x, y, r * 0.8, x, y, bleedRadius);
    
    const alpha = opacity * 0.35 * this.currentLoad; // semi-transparent layering dye
    grad.addColorStop(0, `rgba(${this.loadedPaint.r}, ${this.loadedPaint.g}, ${this.loadedPaint.b}, ${alpha})`);
    grad.addColorStop(0.9, `rgba(${this.loadedPaint.r}, ${this.loadedPaint.g}, ${this.loadedPaint.b}, ${alpha * 0.4})`);
    grad.addColorStop(1, `rgba(${this.loadedPaint.r}, ${this.loadedPaint.g}, ${this.loadedPaint.b}, 0)`);
    
    ctx.fillStyle = grad;
    ctx.arc(x, y, bleedRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
