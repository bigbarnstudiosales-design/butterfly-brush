/**
 * Paper grain field: a resolution-independent height sampler used both by
 * the physics grid (FluidSimulator.grainHeight, low-res) and by the visual
 * paper renderer (full canvas resolution). Sharing one sampler means the
 * paper you see matches the paper the fluid actually flows over.
 *
 * Two implementations:
 *  - Procedural: multi-octave simplex noise, tuned per PaperType.
 *  - Scan-based: a real paper photograph (grayscale luminance) tiled and
 *    lightly warped, for paper types that have a matching scan available.
 */

import { PaperSettings } from '../types';
import { SimplexNoise2D } from './noise';

export interface PaperGrainField {
  /** Returns a raw fiber height in roughly [0, 1] at canvas-space (x, y). */
  heightAt(x: number, y: number): number;
}

export interface ScanTexture {
  width: number;
  height: number;
  data: Float32Array; // normalized grayscale luminance, 0..1
}

/**
 * Loads an image from `url` and converts it into a contrast-normalized
 * grayscale height sample buffer. Downscales large scans since we only
 * need enough detail to tile-sample from, not full source resolution.
 */
export async function loadPaperScanTexture(url: string): Promise<ScanTexture> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Failed to load paper scan: ${url}`));
    img.src = url;
  });

  const maxDim = 1024;
  const factor = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * factor));
  const h = Math.max(1, Math.round(img.naturalHeight * factor));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable while processing paper scan');
  ctx.drawImage(img, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = new Float32Array(w * h);

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const luminance = (imgData.data[o] * 0.299 + imgData.data[o + 1] * 0.587 + imgData.data[o + 2] * 0.114) / 255;
    data[i] = luminance;
    if (luminance < min) min = luminance;
    if (luminance > max) max = luminance;
  }

  // The scan is a soft, low-contrast photo of paper under raking light;
  // stretch it to fill 0..1 so the fiber relief actually reads.
  const range = Math.max(0.0001, max - min);
  for (let i = 0; i < w * h; i++) data[i] = (data[i] - min) / range;

  return { width: w, height: h, data };
}

function mirrorIndex(t: number, n: number): number {
  let tt = t % (2 * n);
  if (tt < 0) tt += 2 * n;
  return tt < n ? tt : 2 * n - tt - 1;
}

/** Bilinear sample of a scan buffer with mirrored tiling (avoids hard seams at tile edges). */
function sampleScanMirrored(scan: ScanTexture, u: number, v: number): number {
  const x0f = Math.floor(u);
  const y0f = Math.floor(v);
  const fx = u - x0f;
  const fy = v - y0f;

  const x0 = mirrorIndex(x0f, scan.width);
  const x1 = mirrorIndex(x0f + 1, scan.width);
  const y0 = mirrorIndex(y0f, scan.height);
  const y1 = mirrorIndex(y0f + 1, scan.height);

  const v00 = scan.data[y0 * scan.width + x0];
  const v10 = scan.data[y0 * scan.width + x1];
  const v01 = scan.data[y1 * scan.width + x0];
  const v11 = scan.data[y1 * scan.width + x1];

  const top = v00 + (v10 - v00) * fx;
  const bot = v01 + (v11 - v01) * fx;
  return top + (bot - top) * fy;
}

/** Procedural fiber field: organic multi-octave noise, tuned per paper type. */
export function createProceduralGrainField(paper: PaperSettings, seed: number = 1): PaperGrainField {
  const noise = new SimplexNoise2D(seed);
  const featureScale = paper.fiberScale * 10 + 2;

  if (paper.type === 'canvas_linen') {
    const threadScale = featureScale * 1.5;
    return {
      heightAt(x, y) {
        const fiber = noise.fbm2D(x / featureScale, y / featureScale, 4);

        // Perturb thread lines slightly so the weave isn't a perfect grid.
        const jitterX = noise.fbm2D(x / (threadScale * 4), y / (threadScale * 4), 2) * threadScale * 0.6;
        const jitterY = noise.fbm2D((x + 512) / (threadScale * 4), (y + 512) / (threadScale * 4), 2) * threadScale * 0.6;
        const warp = Math.abs(Math.sin((x + jitterX) / threadScale)) * Math.abs(Math.sin((y + jitterY) / threadScale));

        return fiber * 0.4 + warp * 0.6;
      },
    };
  }

  return {
    heightAt(x, y) {
      return noise.fbm2D(x / featureScale, y / featureScale, 4);
    },
  };
}

/** Real-scan-based fiber field: tiles a paper photograph with mirrored wrapping and a touch of noise warp/dither. */
export function createScanGrainField(scan: ScanTexture, paper: PaperSettings, seed: number = 2): PaperGrainField {
  const noise = new SimplexNoise2D(seed);
  const tileSize = 150 + paper.fiberScale * 400; // canvas px per photo repeat

  return {
    heightAt(x, y) {
      const warp = noise.fbm2D(x / (tileSize * 3), y / (tileSize * 3), 2) * scan.width * 0.06;
      const u = (x / tileSize) * scan.width + warp;
      const v = (y / tileSize) * scan.height + warp;

      const base = sampleScanMirrored(scan, u, v);
      const microNoise = noise.fbm2D(x / 6, y / 6, 2);
      const mixed = base * 0.85 + microNoise * 0.15;

      return Math.max(0, Math.min(1, mixed));
    },
  };
}

/** Picks the scan-based field for paper types with a matching real scan, procedural noise otherwise. */
export function createGrainField(paper: PaperSettings, scan: ScanTexture | null): PaperGrainField {
  if (scan && paper.type === 'rough_watercolor') {
    return createScanGrainField(scan, paper);
  }
  return createProceduralGrainField(paper);
}
