/**
 * Kubelka-Munk (KM) Pigment Blending Engine
 * 
 * In standard digital blending, colors are mixed by linear interpolation of RGB.
 * However, physical pigments absorb and scatter light differently.
 * This engine implements the simplified Kubelka-Munk model where:
 *   K/S = (1 - R)^2 / 2R
 * where R is reflectance, K is absorption, and S is scattering.
 * By setting S = 1.0 (single constant model), we can determine K for each channel
 * and mix paints by averaging their K values.
 */

export interface Pigment {
  name: string;
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
  description: string;
  staining: number; // 0 = granulating/non-staining, 1 = fully staining (real-world behaviour)
}

export const BASE_PIGMENTS: Record<string, Pigment> = {
  // staining values follow real watercolor behaviour: cadmiums & ultramarine
  // granulate and lift; blacks and many synthetics stain and dry rich.
  cadmiumRed: { name: 'Cadmium Red', r: 227, g: 38, b: 54, description: 'Bright, warm, highly opaque red.', staining: 0.35 },
  ultramarineBlue: { name: 'Ultramarine Blue', r: 18, g: 10, b: 180, description: 'Deep, rich, semi-transparent blue.', staining: 0.25 },
  lemonYellow: { name: 'Lemon Yellow', r: 255, g: 235, b: 59, description: 'Vibrant, cool, semi-opaque yellow.', staining: 0.55 },
  titaniumWhite: { name: 'Titanium White', r: 248, g: 249, b: 250, description: 'Bright, extremely opaque white for tinting.', staining: 0.15 },
  lampBlack: { name: 'Lamp Black', r: 20, g: 20, b: 22, description: 'Deep, cool black for shading.', staining: 0.7 },
};

/** Default staining when no pigment information is available. */
export const DEFAULT_STAINING = 0.7;

/**
 * Effective staining of a pigment mix — the mass-weighted average of each
 * base pigment's natural staining. Mixing a granulating blue into a staining
 * red gives an intermediate value, just like on the palette.
 */
export function pigmentMixToStaining(mix: {
  cadmiumRed: number;
  ultramarineBlue: number;
  lemonYellow: number;
  titaniumWhite: number;
  lampBlack: number;
}): number {
  const entries: [keyof typeof mix, Pigment][] = [
    ['cadmiumRed', BASE_PIGMENTS.cadmiumRed],
    ['ultramarineBlue', BASE_PIGMENTS.ultramarineBlue],
    ['lemonYellow', BASE_PIGMENTS.lemonYellow],
    ['titaniumWhite', BASE_PIGMENTS.titaniumWhite],
    ['lampBlack', BASE_PIGMENTS.lampBlack],
  ];
  let weighted = 0;
  let total = 0;
  for (const [key, pigment] of entries) {
    const w = mix[key] ?? 0;
    weighted += w * pigment.staining;
    total += w;
  }
  return total > 0 ? weighted / total : DEFAULT_STAINING;
}

/**
 * Convert a normalized reflectance R [0..1] to K/S ratio.
 * We clamp R away from 0 and 1 to prevent division by zero or infinite ratios.
 */
function rToKOverS(r: number): number {
  const clampedR = Math.max(0.005, Math.min(0.995, r));
  return Math.pow(1 - clampedR, 2) / (2 * clampedR);
}

/**
 * Solve for reflectance R from K/S ratio.
 * R = 1 + K/S - sqrt((K/S)^2 + 2(K/S))
 */
function kOverSToR(kOverS: number): number {
  const ks = Math.max(0.0001, kOverS);
  return 1 + ks - Math.sqrt(ks * ks + 2 * ks);
}

export interface RGB {
  r: number; // 0-255
  g: number;
  b: number;
}

/**
 * Blend two RGB colors using the Kubelka-Munk model.
 * ratio is the blending weight of color2 (0 = all color1, 1 = all color2).
 */
export function blendKM(c1: RGB, c2: RGB, ratio: number): RGB {
  if (ratio <= 0) return c1;
  if (ratio >= 1) return c2;

  // Normalize to 0..1
  const r1 = c1.r / 255;
  const g1 = c1.g / 255;
  const b1 = c1.b / 255;

  const r2 = c2.r / 255;
  const g2 = c2.g / 255;
  const b2 = c2.b / 255;

  // Convert to K/S values (assuming S=1)
  const kr1 = rToKOverS(r1);
  const kg1 = rToKOverS(g1);
  const kb1 = rToKOverS(b1);

  const kr2 = rToKOverS(r2);
  const kg2 = rToKOverS(g2);
  const kb2 = rToKOverS(b2);

  // Blend K/S values linearly
  const krMix = kr1 * (1 - ratio) + kr2 * ratio;
  const kgMix = kg1 * (1 - ratio) + kg2 * ratio;
  const kbMix = kb1 * (1 - ratio) + kb2 * ratio;

  // Convert back to reflectance (RGB)
  const rMix = kOverSToR(krMix);
  const gMix = kOverSToR(kgMix);
  const bMix = kOverSToR(kbMix);

  return {
    r: Math.round(rMix * 255),
    g: Math.round(gMix * 255),
    b: Math.round(bMix * 255),
  };
}

/**
 * Convert a PigmentMix (percentages of 5 base pigments) to an RGB color.
 */
export function pigmentMixToRGB(mix: {
  cadmiumRed: number;
  ultramarineBlue: number;
  lemonYellow: number;
  titaniumWhite: number;
  lampBlack: number;
}): RGB {
  const sum = mix.cadmiumRed + mix.ultramarineBlue + mix.lemonYellow + mix.titaniumWhite + mix.lampBlack;
  if (sum === 0) return { r: 255, g: 255, b: 255 }; // empty canvas is white paper

  // Calculate normalized weights
  const wRed = mix.cadmiumRed / sum;
  const wBlue = mix.ultramarineBlue / sum;
  const wYellow = mix.lemonYellow / sum;
  const wWhite = mix.titaniumWhite / sum;
  const wBlack = mix.lampBlack / sum;

  // Convert each pigment to K/S
  const pigments = [
    { p: BASE_PIGMENTS.cadmiumRed, w: wRed },
    { p: BASE_PIGMENTS.ultramarineBlue, w: wBlue },
    { p: BASE_PIGMENTS.lemonYellow, w: wYellow },
    { p: BASE_PIGMENTS.titaniumWhite, w: wWhite },
    { p: BASE_PIGMENTS.lampBlack, w: wBlack },
  ];

  let krMix = 0;
  let kgMix = 0;
  let kbMix = 0;

  pigments.forEach(({ p, w }) => {
    if (w > 0) {
      krMix += rToKOverS(p.r / 255) * w;
      kgMix += rToKOverS(p.g / 255) * w;
      kbMix += rToKOverS(p.b / 255) * w;
    }
  });

  return {
    r: Math.round(kOverSToR(krMix) * 255),
    g: Math.round(kOverSToR(kgMix) * 255),
    b: Math.round(kOverSToR(kbMix) * 255),
  };
}

/**
 * Mix pigments in a wet reservoir (for multi-pigment brush blending).
 * Merges two pigment mixes.
 */
export function blendPigmentMixes(
  mix1: Record<string, number>,
  mix2: Record<string, number>,
  ratio: number
): Record<string, number> {
  const result: Record<string, number> = {};
  const keys = ['cadmiumRed', 'ultramarineBlue', 'lemonYellow', 'titaniumWhite', 'lampBlack'];
  keys.forEach((key) => {
    const val1 = mix1[key] ?? 0;
    const val2 = mix2[key] ?? 0;
    result[key] = val1 * (1 - ratio) + val2 * ratio;
  });
  return result;
}

/**
 * Converts standard hex color string to approximation pigment mix
 * for compatibility when user uses RGB picker.
 */
export function hexToPigmentMix(hex: string): {
  cadmiumRed: number;
  ultramarineBlue: number;
  lemonYellow: number;
  titaniumWhite: number;
  lampBlack: number;
} {
  // Convert hex to rgb
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;

  // Basic projection to find coordinate weights in pigment space.
  // Since we want interactive responsiveness, we can do a simplified distance-based optimization.
  // We'll approximate the color by projecting to Red, Blue, Yellow, White, Black.
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  // Simple heuristic for base pigments
  let cadmiumRed = 0;
  let ultramarineBlue = 0;
  let lemonYellow = 0;
  let titaniumWhite = 0;
  let lampBlack = 0;

  // Dark colors get black
  const brightness = (rNorm + gNorm + bNorm) / 3;
  if (brightness < 0.2) {
    lampBlack = 1 - (brightness / 0.2);
  }

  // Light colors get white
  if (brightness > 0.7) {
    titaniumWhite = (brightness - 0.7) / 0.3;
  }

  // Pure color components
  // Yellow absorbs Blue
  lemonYellow = Math.max(0, gNorm - bNorm);
  // Blue absorbs Red/Yellow
  ultramarineBlue = Math.max(0, bNorm - rNorm);
  // Red absorbs Green/Blue
  cadmiumRed = Math.max(0, rNorm - gNorm);

  // Normalize weights so they look realistic
  const total = cadmiumRed + ultramarineBlue + lemonYellow + titaniumWhite + lampBlack;
  if (total === 0) {
    titaniumWhite = 1;
  } else {
    cadmiumRed /= total;
    ultramarineBlue /= total;
    lemonYellow /= total;
    titaniumWhite /= total;
    lampBlack /= total;
  }

  return { cadmiumRed, ultramarineBlue, lemonYellow, titaniumWhite, lampBlack };
}

/**
 * Converts a pigment mix back to a hex string.
 */
export function pigmentMixToHex(mix: {
  cadmiumRed: number;
  ultramarineBlue: number;
  lemonYellow: number;
  titaniumWhite: number;
  lampBlack: number;
}): string {
  const rgb = pigmentMixToRGB(mix);
  const rHex = rgb.r.toString(16).padStart(2, '0');
  const gHex = rgb.g.toString(16).padStart(2, '0');
  const bHex = rgb.b.toString(16).padStart(2, '0');
  return `#${rHex}${gHex}${bHex}`;
}
