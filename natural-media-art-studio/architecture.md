# Natural-Media Painting App — Architecture Handoff

**Context for whoever picks this up:** This is a from-scratch painting app concept, architected collaboratively across a long conversation between an artist (non-programmer, strong in geometry/design sensibility) and an AI assistant. The goal: a "Tier 2" brush engine — a single deformable geometric brush shape (not full per-bristle simulation) that reacts physically to motion, pressure, and tilt, feeding into a real fluid/pigment/paper simulation. Target platform: Flutter/iPad. The artist has NOT yet approved starting real production coding — this document is the pre-build design reference.

**How to use this document:** It's organized as a hierarchy, same shape as the mindmap diagram used in the original conversation. Top-level engines are H2 sections; their sub-systems are H3; specific mechanics/formulas are H4. Anything marked ⚠️ **UNVERIFIED / PLACEHOLDER** is a number or claim that was chosen for illustrative/demo purposes only and has NOT been validated against real paint behavior, real product internals, or any measured data — treat those as starting points for tuning, not facts.

---

## System overview

Five engines, mostly arranged in a top-to-bottom deposit cycle with a return path at the bottom:

```
Brush Engine  <──────────────────────────────┐
     │  pushes/lifts fluid                    │ paper resists/shapes brush
     ▼                                         │
Fluid Engine  <──────────────────────────────┐│
     │  carries pigment                        ││
     ▼                                         ││
Pigment Engine <─────────────────────────────┐││
     │  deposits/mixes on surface              │││
     ▼                                         │││
Canvas State  ────────────────────────────────┘││   (everything already on the paper —
     ▲                                          ││    wet/drying/dried layers; every engine
     │  paper shapes the deposit                ││    above reads AND writes this)
Texture Engine ─────────────────────────────────┘│   (the permanent paper surface —
                                                    never changes; feeds tooth/grain up)
```

- **Brush → Fluid → Pigment → Canvas State**: all bidirectional. Depositing paint flows down; lifting/picking-up paint (wet brush dragged through wet paint) flows the same path in reverse.
- **Texture → Canvas State**: one-way only. Paper is permanent; it never changes, it only informs.
- **Canvas State is the piece that was originally missing** from the design and had to be added — see "Design history / corrections" at the end for why.

---

## Engine 1: Brush Engine

*"A vector shape mimicking the overall shapes a brush stamp can take, limited by total bristle volume, with logical (not random) deformation."*

### 1.1 Shape definition
What the brush is at rest.
- Brush family: round, flat (chisel), filbert, fan, etc. Each has a different resting silhouette.
- Resting vector footprint and taper.
- **Bristle volume ceiling**: a hard limit on how far deformation physics is allowed to stretch/splay/squish the shape — stops a "flick" from producing a shape more hair than the brush physically has.

### 1.2 Deformation physics — ⭐ most developed sub-system, see full breakdown below
How the brush's live shape reacts to motion, pressure, and tilt.

### 1.3 Load and depletion
*(Named as a gap, not yet deep-dived.)*
- The brush carries a **finite reservoir** of paint/water.
- Fluid Engine draws from this reservoir as it deposits.
- Depletes over the course of a stroke — first inch rich, tail end dry-brush/skipping.
- Refilled by dipping in paint or water (a real user action).
- Bidirectional link to Contact & Pressure: how loaded the brush is changes its physical splay; how hard you press changes depletion rate.

### 1.4 Contact and pressure
*(Named as a gap, not yet deep-dived.)*
- Splay widens under downward force.
- Tilt changes the contact patch shape.
- Reads paper roughness from the Texture Engine.
- Feeds the deforming footprint downward into what actually touches the paper.

---

## Deformation Physics — full breakdown (the corrected model)

This went through several wrong turns before landing on the right architecture. The final, artist-approved model has **two independent layers that must not be conflated**:

### Layer A — Rigid geometric projection (drives the actual ink trail)

**This is the important correction.** The brush's edge orientation is a **fixed angle in world space** — it does NOT rotate to face the direction you drag, the way a first attempt assumed. Think of a chisel-tip pen held at a constant angle while you draw different strokes.

The stroke width is a pure geometry/trig consequence of sweeping that fixed-angle shape along the path — **not** a formula you calculate and then draw as a variable-width centerline. The correct implementation literally **stamps the rigid, fixed-orientation footprint repeatedly along the drag path** (a Minkowski-sum sweep), and the thin/wide behavior falls out for free:

- Drag **perpendicular** to the fixed edge orientation → full width (the whole edge length gets swept across your direction of travel).
- Drag **parallel** to the fixed edge orientation → hairline (the edge is slicing edge-on through its own path, only its thin cross-section gets swept).

Real-world equivalent: `width(θ) ≈ edgeLength × |sin(θ − edgeAngle)|` — the classic calligraphy-nib relationship. This is confirmed against real reference photos of a flat brush: same brush, same fixed hold-angle, dragged along its long axis → thin line; dragged perpendicular → full-width band.

**Round brush is a degenerate case of this** — a circle has no distinguished edge angle, so it produces the same width regardless of drag direction. Its only reactive property under Layer A is size (radius), driven by pressure/tilt, not direction.

- **Pressure and Handle tilt** (tilt = how far the handle is laid over from vertical, i.e. altitude angle) both scale up the base footprint size (thickness for flat, radius for round). ⚠️ **UNVERIFIED / PLACEHOLDER**: pressure and tilt currently produce mathematically interchangeable effects (both just multiply footprint thickness). In reality they are physically different causes — tilt should more properly elongate/reshape the contact patch in the direction the handle leans, pressure should more properly increase splay area. This was simplified for the demo and flagged as needing separation later.
- ⚠️ **UNVERIFIED / PLACEHOLDER**: the specific gain constants (how much a given pressure/tilt value increases thickness/radius) are guesses tuned to look reasonable on screen, not calibrated to anything.

### Layer B — Flexible bristle reaction (drives only the LIVE shape indicator, not the trail)

This is the "bend, twist, flick" layer, and it sits **on top of** Layer A without disturbing it. Layer A stays untouched (so the trail's direction-dependent width stays correct); Layer B only distorts what you visually see as the brush moves.

**Core mechanism — a single damped spring, not per-point physics.** Earlier attempts used many independent spring-damper points around the brush's rim, which produced chaotic, directionless wobbling with no geometric logic. The corrected approach uses exactly **one scalar value** (`drift`, 0 to 1) that eases toward a target derived from current speed and eases back to exactly 0 the instant motion stops. Every other visual deformation is a direct multiplier of this one number, which is what gives clean, predictable behavior and a stable, wiggle-free rest state (see "Idle stability" note below).

- **Bend/stretch**: for a flat brush, the shape has two ends (call them A and B, at the fixed edge angle). Whichever end is currently *trailing* (its resting direction points opposite your direction of travel — measured via dot product between that end's direction and the heading vector) stretches backward, proportional to `drift`. The *leading* end stays near its rest position. This produces natural-looking asymmetric bending — dragging obliquely to the edge angle produces a different bend than dragging straight — without needing a separate twist calculation for basic bend.
  - The trailing end also **tapers thinner** as it stretches (a "pennant flag" narrowing), rather than just sliding backward as a rigid parallelogram.
- **Bend/stretch (round brush)**: modeled as a true teardrop — the front stays a fixed-radius circle (the round tip "pressing normally"), while a trailing point drags out behind, distance proportional to `drift`. Implemented via tangent lines from an external trailing point to a fixed circle (standard tangent-point construction: `β = acos(r / L)` where `r` = circle radius, `L` = distance to the trailing point; tangent points sit at `centerAngle ± β`). At rest, the trailing point sits exactly on the circle's edge (`L = r`), which makes `β = 0` and the geometry collapse to a perfect circle automatically — no special-casing needed for "resting = round."
- **Twist**: tracks the *rate of change of heading* (not speed — how fast your direction itself is turning). Straight drags produce zero twist. Sharp hairpin turns rotate the brush's thickness axis slightly, producing a visible "wring" distinct from simple bending. Smoothed via its own small easing term so it doesn't snap instantly.
- **Flick / recovery**: because every Layer-B deformation is a direct function of `drift`, and `drift` springs back to exactly 0 on release, the shape doesn't just "look" recovered — it becomes mathematically identical to the plain rigid Layer-A shape again. This is what "the shape returning to form" means mechanically.
- **Stray bristle flicker ("tufts")**: small sine-wave jitter applied ONLY to midpoints along the hair-edges (the bend edges between the main vertices), never to the main vertices themselves, and only rendered above a small `drift` threshold. This constrains randomness to read as "living, slightly frayed bristle ends" rather than shape noise, and critically — it cannot make edges cross each other or exceed the bristle volume ceiling, because only the 2–4 fixed anchor vertices define the actual silhouette boundary.

### Idle stability (a bug worth documenting so it isn't reintroduced)

Early versions had jitter/wiggle amplitude with a nonzero baseline (`amplitude = 1.5 + drift × 3.5`), which kept animating even when the brush wasn't moving — looked like a glitch, not a material. **Fix pattern**: any per-frame jitter or deformation term must be a pure multiple of `drift` (`amplitude = drift × 3.5`, no added constant), AND `drift` itself should snap to exactly `0` once it's near enough (rather than asymptotically approaching but never arriving), AND the rendering branch should switch to plain straight/undeformed geometry entirely below a small gate threshold rather than rendering a "nearly invisible" deformed version. All three were necessary; any one alone still left residual motion.

---

## Engine 2: Fluid Engine

*"Mimics watercolor, oil, or ink. The brush pushes the simulation. Medium definition changes behavior. Influences how strokes interact, blend, combine."*

### 2.1 Medium definition
What the fluid *is* — the resting recipe, set once per medium, feeding everything else.

Three independent properties (not one "medium type" label — ink is the proof this needs three separate axes, since it's thin/low-tension like watercolor on two axes but behaves like oil on the third):

- **Viscosity**: `baseViscosity` (0–1, resting thickness) + `shearThinning` (0–1, how much thinner it gets *while actively being pushed* by the brush — real paint is thixotropic, thinning under shear and thickening at rest). Feeds: brush drag resistance, spread halo width, ridge/impasto visibility.
- **Surface tension**: split into `cohesion` (0–1, the fluid's own internal "wants to stay together" strength — visualized as beading) and `wettingCoefficient` (0–1, how eagerly it spreads across *whatever surface it's on* — this is really a relationship between medium and paper, only fully resolved once combined with Texture Engine surface data, not a fixed medium-only property).
- **Rewettability**: NOT simply binary. `rewetStrength` (0–1, how easily it resolubilizes within its window) + `rewetWindow` (`"indefinite"`, a time value, or `0`). Watercolor/gouache use gum arabic (indefinite rewet). Oil cures via oxidation (one-way, `rewetWindow = 0`). Acrylic has a genuine short rewet window before curing permanent — a real third case a binary "rewettable y/n" badge can't represent.

⚠️ **UNVERIFIED / PLACEHOLDER reference table** (illustrative starting points only, need real calibration):

| Medium | baseViscosity | shearThinning | cohesion | wettingCoeff | rewetStrength | rewetWindow |
|---|---|---|---|---|---|---|
| Watercolor | 0.08 | 0.1 | 0.1 | 0.9 | 1.0 | indefinite |
| Gouache | 0.42 | 0.3 | 0.28 | 0.6 | 0.6 | indefinite |
| Oil | 0.88 | 0.5 | 0.72 | 0.2 | 0 | 0 |
| Ink | 0.15 | 0.05 | 0.05 | 0.85 | 0 | 0 |
| *(future) Acrylic* | 0.35 | 0.2 | 0.4 | 0.5 | 0.7 | short (minutes) |

### 2.2 Flow behavior
How the fluid moves once deposited — reads from Medium Definition.

- **Gravity**: paint runs when the canvas is tilted. Sensitivity to gravity is inherited from viscosity — thin fluid obeys almost immediately, thick fluid's own body resists it (why oil paintings don't run when tilted mid-stroke the way watercolor does).
- **Spread rate**: how fast/far a deposited puddle grows before stopping — a *time-based* process, distinct from viscosity's static halo. Depends on viscosity AND how much time the Drying System gives it before locking (ink is thin/spreads-easily but sets so fast its spread window is tiny, so it ends up more compact than its viscosity alone would suggest — spread rate cannot be read off viscosity directly, it's viscosity × drying-window).
- **Edge diffusion**: soft/feathered (low surface tension: watercolor, ink) vs. hard/contained (high surface tension: oil) boundary. Dynamic — softens further as a puddle spreads, not just a fixed static-stroke property.

### 2.3 Drying system — the single clock
- Exponential decay curve, not linear — paint stays workable a while, then drops through states relatively fast, then asymptotically approaches fully dry.
- **Four threshold states**, each gating different Stroke Interaction behavior:
  - **Wet** (≥70%): full blending freedom.
  - **Damp** (40–70%): blooms/backruns zone — new wet paint pushes damp paint aside at the boundary.
  - **Tacky** (10–40%): mostly locked, uneven deposition, blending nearly impossible.
  - **Dry** (<10%): fully set, hard edges, rewettable media can still be reactivated.
- **Drying speed slider** (artist-facing, fast↔slow): does NOT change the curve's *shape*, only stretches/compresses the time axis — like adjusting studio humidity. Medium type sets a sensible default; the slider overrides it.
- **Single clock rule**: the Fluid Engine owns wetness-over-time as sole source of truth. The Pigment Engine *reads* this wetness to decide appearance shifts (watercolor lightens as it dries, gouache darkens) rather than running an independent timer — prevents two drying simulations from drifting out of sync.
- **Every point on the canvas gets its own independent timer**, started at the moment it was painted. Canvas State tracks all of these.
- ⚠️ **UNVERIFIED / PLACEHOLDER**: demo curve constants (e.g. "watercolor ≈2.4s, ink ≈0.55s") were compressed for on-screen legibility, NOT real drying times (real watercolor stays workable for minutes). The *ratio* between mediums (ink sets ~4–5× faster than watercolor) was chosen to reflect real relative behavior, but absolute values need real reference data or tuning against real reference paintings.

### 2.4 Stroke interaction — reads Canvas State + Drying System
- **Wet-on-wet**: strokes merge into one continuous fluid body, colors blend, soft halos bleed outward. Bleed amount should scale with brush load (water content).
- **Wet-on-damp**: blooms/backruns at the wet/damp boundary specifically (not uniform) — new wet paint has more energy than damp paint can resist, displacing it outward in feathery tendrils.
- **Wet-on-tacky**: deposition becomes uneven/noisy — the "just walk away" zone.
- **Wet-on-dry**: clean hard-edged layering, no blend — where glazing lives.
- **Lifting**: reverses the normal deposit flow (Canvas State → Pigment → Fluid → Brush instead of the other direction). Effectiveness gated by wetness state — easy from wet, barely possible from dry unless the medium is rewettable.

---

## Engine 3: Pigment Engine

*("Color mixing and color management. Yellow + blue = green — no nearest-neighbor approximation. Rebelle-level mixing. Colors mix and blend on paper like real life. The fluid they're in influences spread/behavior/drying opacity — transparent+light like watercolor, or opaque+dark like gouache/oil.")*

**Status: named and scoped at a high level in the original conversation; not yet deep-dived.** Known requirements so far:

- True **subtractive** color mixing (not RGB nearest-neighbor blending) — this was an explicit, emphatic requirement.
- Opacity/appearance is **medium-dependent**, read from the Fluid Engine's medium definition and live wetness state — same pigment looks different depending on what it's suspended in and how dry it currently is.
- Concentration/intensity and drying-shift (color changes as it dries) are pigment-engine concerns that read the Fluid Engine's single drying clock rather than running independent timers (see 2.3's "single clock" rule).
- **Open question for next session**: what actual color-mixing model to use for true subtractive mixing (e.g. Kubelka-Munk paint-mixing model is the standard real-world approach used by some serious digital paint simulators) — not yet decided or researched in this conversation.

---

## Engine 4: Texture Engine

*("The base layer connecting back to the brush. Influences how the brush deposits media — low points heavier in pigment, high points lighter. Canvas, hot press, cold press, sketch paper, rough, smooth, bristol, etc. Same medium+brush combo looks very different on different paper.")*

**Status: named and scoped at a high level; not yet deep-dived.** Known requirements so far:

- Represents paper/canvas tooth and grain as a height-field-like surface.
- Valleys hold more pigment, peaks stay lighter/skip more (drybrush-on-rough-paper effect).
- Permanent — never changes during painting (unlike Canvas State, which is the accumulating wet paint layer above it).
- Feeds tooth/grain data upward to Canvas State, which the Brush, Fluid, and Pigment engines all read from to modulate deposition, spread, and blending.
- **Open question for next session**: how to actually represent paper texture computationally (procedural noise field vs. photographed height maps vs. parametric roughness per paper type) — not yet decided.

---

## Engine 5: Canvas State — the layer that was missing from the first draft

*(Added as a correction — see "Design history" below for why this had to be introduced.)*

- Represents **everything currently on the paper**: wet, drying, or dried paint layers accumulated from every stroke so far — distinct from the permanent Texture Engine surface beneath it.
- Every engine above reads from it: Brush Engine checks it for drag resistance against existing wet paint; Fluid Engine checks it for wet-on-wet blending eligibility; Pigment Engine checks it for what color is already present before mixing.
- Owns the per-point wetness timers described in 2.3.
- Supports the **bidirectional** flow needed for lifting/blotting/scraping — not just depositing.
- **Open question for next session**: concrete data structure. Likely candidates discussed only in passing: a per-pixel or per-region record of {pigment concentration, wetness elapsed-time, medium type, layer history} — not yet designed in detail.

---

## Design history / corrections worth preserving

These are the wrong turns and fixes that shaped the final architecture — useful so the next model doesn't repeat them.

1. **Canvas State was originally missing entirely.** The first four-engine version (Brush → Fluid → Pigment → Texture) worked for describing a *single* stroke, but had no home for "what's already on the paper" from previous strokes — which is what makes wet-on-wet, lifting, and color-mixing-on-canvas work. Added as its own layer between Pigment and Texture.
2. **Brush load (finite paint reservoir) was originally missing.** Without it, every point along a stroke deposits identically, which is an obvious digital-brush tell. Added to Brush Engine as "Load and depletion."
3. **Two independent drying clocks would have drifted.** Original design let both Fluid and Pigment engines reason about "wetness" independently. Corrected to a single-clock rule: Fluid Engine owns wetness-over-time; Pigment Engine only reads it.
4. **Flow was originally drawn as strictly one-directional.** Real painting also involves lifting/picking up paint (wet brush through wet paint, palette-knife scraping). Corrected to bidirectional arrows between Brush/Fluid/Pigment/Canvas State (Texture→Canvas State remains one-way, since paper itself never changes).
5. **First deformation-physics attempt used many independent per-point springs with no geometric logic** — produced directionless, overly chaotic wobbling. Corrected to the two-layer model (Section "Deformation Physics" above): rigid fixed-angle geometry drives the trail, a single damped scalar drives visible bend/twist/flick.
6. **First flat-brush width model used per-corner convergence based on dot-product "alignment with heading," rotating the effective edge toward the drag direction.** This was physically wrong — real chisel/flat brushes hold a FIXED edge angle regardless of drag direction; the width variation is a sweep/projection effect, not a footprint-rotates-to-face-travel effect. Corrected by verifying against real reference photos of a flat brush (thin line when dragged parallel to its edge orientation, full-width band when dragged perpendicular, same brush, same hold-angle both times) and switching to literal repeated-stamping of a rigid, fixed-orientation footprint.
7. **Jitter/wiggle had a nonzero idle baseline**, causing constant tiny motion even at rest. See "Idle stability" note under Deformation Physics for the three-part fix.
8. Round and Filbert brushes were initially given the same triangular corner-convergence treatment as Flat. Corrected: Round is a fundamentally different shape family (circle-collapsing-to-teardrop via tangent-line construction, not a 3-corner triangle). Filbert was explicitly deferred/dropped from active demos ("no idea, let's leave it out for now").
9. A generic AI-search-overview document was fact-checked mid-conversation and found to be **partially useful, partially filler**: the tilt/azimuth-as-real-hardware-input concept was validated as genuinely applicable (real styluses report altitude + azimuth; this should eventually replace the manual "Brush angle" slider once on real hardware), but claims like the plain circle equation for round brushes, a vague tangent-slope claim for flat brushes, and unrelated generative-art/Fibonacci content were identified as either trivial or irrelevant padding, not actionable.

---

## Flutter architecture (code already generated — see accompanying files)

A working Dart sketch exists implementing the **Tier-2 single-engine-per-brush-type architecture** (separate from the deformation-physics demos above, which were browser/canvas prototypes for visual validation, not the production code path). Key design: each `Brush` declares an `engineType`; a `StrokeController` picks the matching `StrokeEngine` implementation; both engines only ever emit a shared `Stamp` primitive, so the `StrokeCompositor` (the only thing that touches `Canvas`) never needs to know which engine produced a given mark.

Files (already generated, available as separate downloads alongside this document):
- `lib/brush.dart` — `Brush`, `BrushEngineType` enum, `DynamicsConfig`, `PhysicalConfig`, example presets.
- `lib/stroke_types.dart` — `StrokePoint` (input), `Stamp` (output) — the shared seam between engines and rendering.
- `lib/engines/stroke_engine.dart` — abstract `StrokeEngine` interface (`reset`, `onPointerMove`, `onTick`, `isSettled`).
- `lib/engines/pen_renderer.dart` — near-zero-latency engine; Streamline lives here as a plain path low-pass filter (smooths WHERE the mark goes, never the stamp's shape) — this is deliberately kept separate from the physical/inertial engine so pen-family brushes never inherit unwanted lag.
- `lib/engines/physical_renderer.dart` — the original single-point spring-damper (drag/lag/taper) engine — this predates and is architecturally simpler than the two-layer Deformation Physics model developed later in the conversation (see note below).
- `lib/stroke_controller.dart` — picks engine per brush, drives per-frame settling via `onTick`.
- `lib/stroke_compositor.dart` — the only class that touches `Canvas`.
- `lib/canvas_widget_example.dart` — real Flutter widget wiring (Listener + CustomPaint + Ticker). **Contains a documented fix**: `CustomPainter.shouldRepaint` compares old/new stamp lists — mutating a list in place makes old and new painters reference the identical object, so the comparison is always trivially "no change" and Flutter skips repainting. Fix: build a new list each update (`_committedStamps = [..._committedStamps, ...stamps]`) rather than `.addAll()` in place.
- `brush_demo_main.dart` — runnable entry point with a real toolbar (Pen/Physical segmented control, Size slider, Drag slider — UI-facing "more drag" reads left-to-right correctly, inverted from the internal spring-stiffness parameter which is physically backwards from the intuitive label).

**Important gap to flag explicitly**: the Dart `PhysicalRenderer` implements only the *original* single-point drag/lag model, NOT the later two-layer corrected model (rigid fixed-angle geometric sweep + separate bend/twist/flick scalar) developed through the browser demos and reference-photo validation. Porting the corrected model into Dart is unstarted work — the browser/canvas demos are the validated design reference; the Dart code has not yet been updated to match.

---

## Open items for the next session (nothing here has been started)

- Pigment Engine: choose and implement an actual subtractive color-mixing model (Kubelka-Munk is the standard candidate for real paint-mixing simulation — unresearched in this conversation).
- Texture Engine: decide how paper texture is represented computationally (procedural vs. photographed height maps vs. parametric).
- Canvas State: design the actual per-point/per-region data structure.
- Brush Engine → Load and Depletion: not deep-dived at all; only named and scoped.
- Brush Engine → Contact and Pressure: not deep-dived at all; only named and scoped.
- Port the corrected two-layer Deformation Physics model (rigid sweep + single-scalar bend/twist/flick) from the JS canvas prototypes into the Dart `StrokeEngine` architecture — current Dart code only has the earlier, simpler single-point model.
- Tier-3 (full per-bristle simulation, à la Rebelle's Bristle Brushes / Corel Painter's RealBristle mass-spring system) was discussed as a distinct, much more expensive future direction — explicitly NOT what this document's Tier-2 architecture covers, and confirmed to not currently exist as a shipped feature on iPad (Fresco's bristle simulation was called out as weaker than desired).
- Tilt/azimuth as real stylus hardware input (replacing the manual "Brush angle" slider) — validated as a real, correct direction, not yet implemented anywhere.

---

*End of handoff document. All ⚠️ flags in this document mark numbers or claims that were chosen for demo legibility or as reasonable starting guesses, not verified against real paint physics, real product internals, or measured data — the next model/session should treat those as tuning targets, not ground truth.*