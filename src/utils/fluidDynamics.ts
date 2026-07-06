/**
 * Fluid Dynamics & Media Interaction Engine
 *
 * The watercolor fluid simulation now runs on the GPU (WebGL2 fragment
 * shader passes) — see ./gpuFluid. The re-export below keeps existing
 * imports of FluidSimulator from this module working unchanged.
 *
 * This module still owns the oil impasto height-map physics (thick paint
 * accumulation, smear blending, and normal-map generation for 3D lighting),
 * which is CPU-based and independent of the fluid sim.
 */

export { FluidSimulator } from './gpuFluid';

/**
 * 3D Impasto Engine for Oil paint simulation.
 * Manages thickness heightmaps and light reflection rendering.
 */
export class ImpastoEngine {
  public width: number;
  public height: number;
  public heightMap: Float32Array; // Paint height/thickness at each pixel
  public normalMap: Float32Array; // Cached normals (dx, dy, dz)

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.heightMap = new Float32Array(width * height);
    this.normalMap = new Float32Array(width * height * 3);
    this.resetNormals();
  }

  private resetNormals() {
    for (let i = 0; i < this.width * this.height; i++) {
      const idx = i * 3;
      this.normalMap[idx] = 0.0;     // Nx
      this.normalMap[idx + 1] = 0.0; // Ny
      this.normalMap[idx + 2] = 1.0; // Nz
    }
  }

  /**
   * Apply oil paint volume and blend with neighboring heights.
   */
  public depositOil(
    x: number,
    y: number,
    radius: number,
    thickness: number
  ) {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const r = Math.ceil(radius);

    for (let dy = -r; dy <= r; dy++) {
      const py = ry + dy;
      if (py < 0 || py >= this.height) continue;

      for (let dx = -r; dx <= r; dx++) {
        const px = rx + dx;
        if (px < 0 || px >= this.width) continue;

        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > r) continue;

        const idx = py * this.width + px;
        const falloff = 1.0 - (dist / r);

        // Add thickness
        this.heightMap[idx] = Math.min(10.0, this.heightMap[idx] + thickness * falloff * 0.8);
      }
    }

    // Recompute normals around updated region
    this.computeNormalsSubset(rx - r - 2, ry - r - 2, rx + r + 2, ry + r + 2);
  }

  /**
   * Recompute normal map vectors based on height gradients.
   */
  private computeNormalsSubset(xStart: number, yStart: number, xEnd: number, yEnd: number) {
    const x0 = Math.max(1, xStart);
    const y0 = Math.max(1, yStart);
    const x1 = Math.min(this.width - 2, xEnd);
    const y1 = Math.min(this.height - 2, yEnd);

    // Sobel filters for height gradients
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const idx = y * this.width + x;

        // Heights of neighbors
        const hNW = this.heightMap[(y - 1) * this.width + (x - 1)];
        const hN  = this.heightMap[(y - 1) * this.width + x];
        const hNE = this.heightMap[(y - 1) * this.width + (x + 1)];
        const hW  = this.heightMap[y * this.width + (x - 1)];
        const hE  = this.heightMap[y * this.width + (x + 1)];
        const hSW = this.heightMap[(y + 1) * this.width + (x - 1)];
        const hS  = this.heightMap[(y + 1) * this.width + x];
        const hSE = this.heightMap[(y + 1) * this.width + (x + 1)];

        // Compute gradients (Sobel filter)
        // We multiply gradient by scale factor to adjust visual depth
        const depthScale = 1.8;
        const dx = -((hNE + 2 * hE + hSE) - (hNW + 2 * hW + hSW)) * depthScale;
        const dy = -((hSW + 2 * hS + hSE) - (hNW + 2 * hN + hNE)) * depthScale;
        const dz = 1.0;

        // Normalize
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const normalIdx = idx * 3;
        this.normalMap[normalIdx] = dx / len;
        this.normalMap[normalIdx + 1] = dy / len;
        this.normalMap[normalIdx + 2] = dz / len;
      }
    }
  }

  /**
   * Renders the 3D-lit shaded paint.
   * Uses phong specular lighting with adjustable light position.
   */
  public renderShaded(
    sourceCtx: CanvasRenderingContext2D,
    destCtx: CanvasRenderingContext2D,
    lightAngleDeg: number = 135,
    lightHeight: number = 0.5 // 0.1 to 1.0
  ) {
    const imgData = sourceCtx.getImageData(0, 0, this.width, this.height);
    const sData = imgData.data;

    const outputImgData = destCtx.createImageData(this.width, this.height);
    const dData = outputImgData.data;

    // Light direction vector
    const rad = (lightAngleDeg * Math.PI) / 180;
    const Lx = Math.cos(rad);
    const Ly = Math.sin(rad);
    const Lz = lightHeight;
    const LLen = Math.sqrt(Lx * Lx + Ly * Ly + Lz * Lz);
    const lXNorm = Lx / LLen;
    const lYNorm = Ly / LLen;
    const lZNorm = Lz / LLen;

    const ambient = 0.65;
    const specularStrength = 0.45;
    const shininess = 16.0;

    for (let i = 0; i < this.width * this.height; i++) {
      const cIdx = i * 4;
      const nIdx = i * 3;

      const alpha = sData[cIdx + 3] / 255;
      if (alpha <= 0.01) {
        // Transparent
        dData[cIdx] = 0;
        dData[cIdx + 1] = 0;
        dData[cIdx + 2] = 0;
        dData[cIdx + 3] = 0;
        continue;
      }

      // Normal vector
      const nx = this.normalMap[nIdx];
      const ny = this.normalMap[nIdx + 1];
      const nz = this.normalMap[nIdx + 2];

      // Lambertian diffuse: N dot L
      const nDotL = Math.max(0.0, nx * lXNorm + ny * lYNorm + nz * lZNorm);

      // Specular highlight (reflective shine)
      // Halfway vector (assuming view vector is [0, 0, 1])
      const hx = lXNorm;
      const hy = lYNorm;
      const hz = lZNorm + 1.0;
      const hLen = Math.sqrt(hx * hx + hy * hy + hz * hz);
      const hxNorm = hx / hLen;
      const hyNorm = hy / hLen;
      const hzNorm = hz / hLen;

      const nDotH = Math.max(0.0, nx * hxNorm + ny * hyNorm + nz * hzNorm);
      const specular = Math.pow(nDotH, shininess) * specularStrength;

      // Color calculations
      const r = sData[cIdx];
      const g = sData[cIdx + 1];
      const b = sData[cIdx + 2];

      // Blended shaded color
      const intensity = ambient + (1.0 - ambient) * nDotL;

      dData[cIdx] = Math.min(255, Math.round(r * intensity + specular * 255));
      dData[cIdx + 1] = Math.min(255, Math.round(g * intensity + specular * 255));
      dData[cIdx + 2] = Math.min(255, Math.round(b * intensity + specular * 255));
      dData[cIdx + 3] = sData[cIdx + 3];
    }

    destCtx.putImageData(outputImgData, 0, 0);
  }

  public clear() {
    this.heightMap.fill(0);
    this.resetNormals();
  }
}
