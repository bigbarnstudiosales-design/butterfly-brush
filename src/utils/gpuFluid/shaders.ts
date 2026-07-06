/**
 * GLSL ES 3.00 shader sources for the GPU watercolor engine.
 *
 * Conventions shared by every pass:
 *  - Texture row 0 = canvas TOP row. All sim passes are flip-agnostic; only
 *    FRAG_RENDER flips V so the drawImage blit lands upright.
 *  - Water is STORED rescaled to 0..1 (CPU engine used 0..5): half-float ULP
 *    at 5.0 (~0.0049) is the same size as the per-step evaporation (0.005),
 *    which would leave washes that never dry. Shaders convert to CPU units
 *    (x5) for the physics so constants port 1:1 from the old CPU code.
 *  - Pigment and deposit stay in the CPU 0..255 value range for the same
 *    reason (constants port unchanged); RGBA16F holds up to 65504.
 */

/** Fullscreen triangle, no attributes needed (gl_VertexID trick). */
export const VERT_FULLSCREEN = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = pos;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * Water + outward velocity splat. Drawn scissored to the splat bounding box
 * with ADDITIVE blending into the current read texture (no ping-pong).
 * Ports FluidSimulator.injectPaint water/velocity deposit; the min(5, w)
 * clamp lives in FRAG_ADVECT_VEL because blending cannot clamp.
 */
export const FRAG_SPLAT_VEL = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform vec2 u_simSize;    // grid dims in cells
uniform vec2 u_center;     // splat center, in cells
uniform float u_radius;    // in cells
uniform float u_amount;    // water/fluid load
void main() {
  vec2 d = v_uv * u_simSize - u_center;
  float dist = length(d);
  if (dist > u_radius) discard;
  float falloff = 1.0 - dist / u_radius;
  vec2 dir = dist > 0.0001 ? d / dist : vec2(0.0);
  // velocity += dir * amount * falloff * 0.5 ; water += amount * falloff * 2 (stored /5)
  o = vec4(dir * u_amount * falloff * 0.5, u_amount * falloff * 2.0 / 5.0, 0.0);
}
`;

/**
 * Pigment splat. Blended with (SRC_ALPHA, ONE_MINUS_SRC_ALPHA) on RGB and
 * (ZERO, ONE) on alpha: with src alpha 0.7 this reproduces the CPU formula
 * p' = 0.3*p + 0.7*(color * pigmentLoad * falloff * 5) exactly, while
 * leaving the (reserved) alpha channel untouched.
 */
export const FRAG_SPLAT_PIGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform vec2 u_simSize;
uniform vec2 u_center;
uniform float u_radius;
uniform vec3 u_color;        // 0..255
uniform float u_pigmentLoad;
void main() {
  vec2 d = v_uv * u_simSize - u_center;
  float dist = length(d);
  if (dist > u_radius) discard;
  float falloff = 1.0 - dist / u_radius;
  o = vec4(u_color * u_pigmentLoad * falloff * 5.0, 0.7);
}
`;

/**
 * Velocity + water update: semi-Lagrangian advection, paper-grain slope
 * force, friction damping, Laplacian water bleed (replaces the CPU 4-neighbor
 * sharing), evaporation, water clamp, border velocity mask.
 */
export const FRAG_ADVECT_VEL = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_velWater;
uniform sampler2D u_grain;
uniform vec2 u_texel;
uniform float u_grainDepth;
uniform float u_absorb;     // per-step evaporation, CPU water units
uniform float u_kDiff;      // water diffusion coefficient
void main() {
  vec4 c = texture(u_velWater, v_uv);
  vec2 back = v_uv - c.xy * u_texel;   // dt = 1 grid step
  vec4 s = texture(u_velWater, back);

  // Slope force: water flows downhill on the paper grain heightmap
  float hW = texture(u_grain, v_uv - vec2(u_texel.x, 0.0)).r;
  float hE = texture(u_grain, v_uv + vec2(u_texel.x, 0.0)).r;
  float hN = texture(u_grain, v_uv - vec2(0.0, u_texel.y)).r;
  float hS = texture(u_grain, v_uv + vec2(0.0, u_texel.y)).r;
  s.x += (hW - hE) * u_grainDepth * 0.1;
  s.y += (hN - hS) * u_grainDepth * 0.1;
  s.xy *= 0.85; // friction / viscosity damping
  
  // Clamp velocity to avoid NaN blowout and excessive speeds
  s.xy = clamp(s.xy, vec2(-5.0), vec2(5.0));

  // Water bleed: Laplacian diffusion in CPU units (stored water * 5)
  float wC = c.z * 5.0;
  float wW = texture(u_velWater, v_uv - vec2(u_texel.x, 0.0)).z * 5.0;
  float wE = texture(u_velWater, v_uv + vec2(u_texel.x, 0.0)).z * 5.0;
  float wN = texture(u_velWater, v_uv - vec2(0.0, u_texel.y)).z * 5.0;
  float wS = texture(u_velWater, v_uv + vec2(0.0, u_texel.y)).z * 5.0;
  float w = s.z * 5.0;
  w += u_kDiff * (wW + wE + wN + wS - 4.0 * wC);
  // Grain-modulated absorption: exposed peaks absorb faster than sheltered valleys
  float grainH = texture(u_grain, v_uv).r;
  w -= u_absorb * mix(1.4, 0.6, grainH);
  w = clamp(w, 0.0, 5.0);

  // Zero velocity in the outer 1-cell ring (closed box boundary)
  vec2 cell = v_uv / u_texel;
  vec2 size = 1.0 / u_texel;
  float border = step(1.5, min(min(cell.x, size.x - cell.x), min(cell.y, size.y - cell.y)));
  s.xy *= border;

  o = vec4(s.xy, w / 5.0, s.w);
}
`;

/**
 * Computes velocity divergence for pressure solver.
 */
export const FRAG_DIVERGENCE = `#version 300 es
precision highp float;
in vec2 v_uv;
out float o;
uniform sampler2D u_velWater;
uniform vec2 u_texel;
void main() {
  float uR = texture(u_velWater, v_uv + vec2(u_texel.x, 0.0)).x;
  float uL = texture(u_velWater, v_uv - vec2(u_texel.x, 0.0)).x;
  float vT = texture(u_velWater, v_uv + vec2(0.0, u_texel.y)).y;
  float vB = texture(u_velWater, v_uv - vec2(0.0, u_texel.y)).y;

  o = 0.5 * ((uR - uL) + (vT - vB));
}
`;

/**
 * Jacobi iteration pass for Poisson pressure solver.
 * Enforces Neumann boundary conditions by reflecting pressure values at borders.
 */
export const FRAG_JACOBI = `#version 300 es
precision highp float;
in vec2 v_uv;
out float o;
uniform sampler2D u_pressure;
uniform sampler2D u_divergence;
uniform vec2 u_texel;
void main() {
  vec2 cell = v_uv / u_texel;
  vec2 size = 1.0 / u_texel;

  float pC = texture(u_pressure, v_uv).r;

  float pL = cell.x > 0.5 ? texture(u_pressure, v_uv - vec2(u_texel.x, 0.0)).r : pC;
  float pR = cell.x < size.x - 0.5 ? texture(u_pressure, v_uv + vec2(u_texel.x, 0.0)).r : pC;
  float pB = cell.y > 0.5 ? texture(u_pressure, v_uv - vec2(0.0, u_texel.y)).r : pC;
  float pT = cell.y < size.y - 0.5 ? texture(u_pressure, v_uv + vec2(0.0, u_texel.y)).r : pC;

  float div = texture(u_divergence, v_uv).r;

  o = clamp(0.25 * (pL + pR + pB + pT - div), -1000.0, 1000.0);
}
`;

/**
 * Subtracts the pressure gradient from velocity to make it divergence-free.
 */
export const FRAG_PROJECTION = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_velWater;
uniform sampler2D u_pressure;
uniform vec2 u_texel;
void main() {
  vec4 c = texture(u_velWater, v_uv);
  vec2 cell = v_uv / u_texel;
  vec2 size = 1.0 / u_texel;

  float pC = texture(u_pressure, v_uv).r;

  float pL = cell.x > 0.5 ? texture(u_pressure, v_uv - vec2(u_texel.x, 0.0)).r : pC;
  float pR = cell.x < size.x - 0.5 ? texture(u_pressure, v_uv + vec2(u_texel.x, 0.0)).r : pC;
  float pB = cell.y > 0.5 ? texture(u_pressure, v_uv - vec2(0.0, u_texel.y)).r : pC;
  float pT = cell.y < size.y - 0.5 ? texture(u_pressure, v_uv + vec2(0.0, u_texel.y)).r : pC;

  vec2 gradP = 0.5 * vec2(pR - pL, pT - pB);
  vec2 vel = clamp(c.xy - gradP, vec2(-5.0), vec2(5.0));

  float border = step(1.5, min(min(cell.x, size.x - cell.x), min(cell.y, size.y - cell.y)));
  vel *= border;

  o = vec4(vel, c.z, c.w);
}
`;

/**
 * Divergence debug view: positive divergence in red, negative in blue.
 */
export const FRAG_RENDER_DIV = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_divergence;
void main() {
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  float div = texture(u_divergence, uv).r;

  float factor = 30.0; // scale up to make small values visible
  float absDiv = abs(div) * factor;
  if (div > 0.0) {
    o = vec4(absDiv, 0.0, 0.0, 1.0);
  } else {
    o = vec4(0.0, 0.0, absDiv, 1.0);
  }
}
`;

/**
 * Pigment advection: back-trace along the (already updated) velocity field
 * plus the same Laplacian bleed as water so pigment travels with it.
 * Diffusion is gated on water presence — suspended pigment can't creep
 * across dry paper.
 * Includes water-gradient fringe advection to drive pigment to the drying boundary.
 */
export const FRAG_ADVECT_PIGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_pigment;
uniform sampler2D u_velWater;
uniform vec2 u_texel;
uniform float u_kDiff;
void main() {
  float wC = texture(u_velWater, v_uv).z * 5.0;
  float wW = texture(u_velWater, v_uv - vec2(u_texel.x, 0.0)).z * 5.0;
  float wE = texture(u_velWater, v_uv + vec2(u_texel.x, 0.0)).z * 5.0;
  float wN = texture(u_velWater, v_uv - vec2(0.0, u_texel.y)).z * 5.0;
  float wS = texture(u_velWater, v_uv + vec2(0.0, u_texel.y)).z * 5.0;

  // Water gradient drives pigment toward drying edges (coffee-ring / fringe effect)
  vec2 gradW = 0.5 * vec2(wE - wW, wN - wS);
  const float FRINGE = 0.55;

  vec2 vel = texture(u_velWater, v_uv).xy;
  vec2 pigmentVel = clamp(vel - FRINGE * gradW, vec2(-5.0), vec2(5.0));
  
  vec2 back = v_uv - pigmentVel * u_texel;
  vec4 p = texture(u_pigment, back);

  vec3 pC = texture(u_pigment, v_uv).rgb;
  vec3 pW = texture(u_pigment, v_uv - vec2(u_texel.x, 0.0)).rgb;
  vec3 pE = texture(u_pigment, v_uv + vec2(u_texel.x, 0.0)).rgb;
  vec3 pN = texture(u_pigment, v_uv - vec2(0.0, u_texel.y)).rgb;
  vec3 pS = texture(u_pigment, v_uv + vec2(0.0, u_texel.y)).rgb;
  p.rgb += u_kDiff * (pW + pE + pN + pS - 4.0 * pC) * step(0.01, wC);
  p.rgb = clamp(p.rgb, vec3(0.0), vec3(1000.0));

  o = p;
}
`;

/**
 * Settling/deposit pass (MRT: pigment out at location 0, deposit at 1).
 *
 * Deposit accumulates dry pigment MASS: rgb = summed landed mass per channel,
 * a = summed landed mass (max channel), both uncapped (RGBA16F holds it). The
 * render pass recovers hue from rgb/a and opacity from a — so a saturated wash
 * dries to its true colour instead of washing out (the old premultiplied-with-
 * capped-coverage store hue-shifted heavy pigment to a pale ghost).
 *
 * Staining knob (u_staining, 0..1):
 *  - retention: staining pigment bonds to the paper and keeps ~all its mass;
 *    granulating pigment lifts off with the evaporating water and dries lighter.
 *  - granulation: granulating pigment pools into paper-grain valleys (speckle);
 *    staining pigment lays flat and even.
 *
 * Edge darkening: settle rate is boosted at the drying boundary (wet cells
 * adjacent to dry ones), concentrating pigment at the wash edge.
 */
export const FRAG_DEPOSIT = `#version 300 es
precision highp float;
in vec2 v_uv;
layout(location = 0) out vec4 outPigment;
layout(location = 1) out vec4 outDeposit;
uniform sampler2D u_pigment;
uniform sampler2D u_deposit;
uniform sampler2D u_velWater;
uniform sampler2D u_grain;
uniform vec2 u_texel;
uniform float u_staining;   // 0 = granulating, 1 = staining

const float RETAIN_FLOOR = 0.55; // granulating pigment keeps this fraction; staining keeps 1.0

void main() {
  float w = texture(u_velWater, v_uv).z * 5.0;
  vec4 pig = texture(u_pigment, v_uv);
  vec4 dep = texture(u_deposit, v_uv);
  float grain = texture(u_grain, v_uv).r;

  // Granulation: valleys trap granulating pigment; staining pigment lays flat.
  float grainTrap = pow(clamp(1.0 - grain, 0.0, 1.0), 2.0);
  float trap = mix(grainTrap, 1.0, u_staining);
  // Retention: how much of the settling pigment actually bonds vs. lifts away.
  float retention = mix(RETAIN_FLOOR, 1.0, u_staining);

  if (w <= 0.01) {
    // Final dry-out: remaining suspended pigment lands (× retention × trap);
    // the rest lifts off with the evaporating water and is lost.
    vec3 landed = pig.rgb * retention * trap;
    float cov = max(landed.r, max(landed.g, landed.b));
    outDeposit = vec4(dep.rgb + landed, dep.a + cov);
    outPigment = vec4(0.0, 0.0, 0.0, pig.a);
  } else {
    // Boundary detection: wet cell adjacent to at least one dry cell
    float wW = texture(u_velWater, v_uv - vec2(u_texel.x, 0.0)).z * 5.0;
    float wE = texture(u_velWater, v_uv + vec2(u_texel.x, 0.0)).z * 5.0;
    float wN = texture(u_velWater, v_uv - vec2(0.0, u_texel.y)).z * 5.0;
    float wS = texture(u_velWater, v_uv + vec2(0.0, u_texel.y)).z * 5.0;
    float boundary = step(0.01, max(max(step(wW, 0.01), step(wE, 0.01)),
                                     max(step(wN, 0.01), step(wS, 0.01))));

    // Settle rate: faster in shallow water
    float settleRate = 0.008 + 0.30 * smoothstep(0.3, 0.01, w);
    // Edge darkening boost at drying boundary
    settleRate += boundary * 0.20 * (1.0 - smoothstep(0.1, 0.01, w));

    vec3 s = min(pig.rgb * settleRate * trap, pig.rgb); // leaves suspension
    vec3 landed = s * retention;                        // bonds to paper
    float cov = max(landed.r, max(landed.g, landed.b));
    outDeposit = vec4(dep.rgb + landed, dep.a + cov);
    outPigment = vec4(max(pig.rgb - s, vec3(0.0)), pig.a);
  }
}
`;

/**
 * Final render to the shared GL canvas at full canvas resolution. LINEAR
 * texture sampling provides the bilinear upsample from sim resolution for
 * free. Outputs straight alpha; alpha 0 below the coverage threshold so
 * the paper shows through untouched regions.
 * V is flipped here so the drawImage blit lands upright.
 *
 * Deposit stores accumulated dry pigment mass (rgb per channel, a = max-channel
 * mass). Hue is rgb/a; opacity saturates with mass via a / (a + HALF_MASS).
 * Wet pigment is suspended pigment mass, composited over the dry layer.
 */
export const FRAG_RENDER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_pigment;
uniform sampler2D u_deposit;
uniform sampler2D u_velWater;

const float HALF_MASS = 90.0; // dry pigment mass at which the stain is ~50% opaque

void main() {
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec4 dep = texture(u_deposit, uv);
  vec3 wet = texture(u_pigment, uv).rgb;
  float water = texture(u_velWater, uv).z * 5.0;

  // Dry deposit: hue from accumulated mass, opacity saturates with mass.
  float depMass = dep.a;
  vec3 dryRGB = depMass > 0.5 ? clamp(dep.rgb / depMass, 0.0, 1.0) : vec3(0.0);
  float dryA = depMass / (depMass + HALF_MASS);

  // Wet pigment: normalize to hue, alpha from concentration * water
  float pigMax = max(wet.r, max(wet.g, wet.b));
  float wetA = clamp(pigMax / 128.0 * min(water, 1.0), 0.0, 0.9);
  vec3 wetRGB = pigMax > 0.5 ? clamp(wet / pigMax, 0.0, 1.0) : vec3(0.0);

  // Alpha-over: wet on top of dry
  float a = wetA + dryA * (1.0 - wetA);
  if (a < 0.02) {
    o = vec4(0.0);
    return;
  }
  vec3 rgb = (wetRGB * wetA + dryRGB * dryA * (1.0 - wetA)) / a;
  o = vec4(clamp(rgb, 0.0, 1.0), a);
}
`;

