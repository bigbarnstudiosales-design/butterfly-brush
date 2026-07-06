/**
 * Shared WebGL2 context singleton.
 *
 * All FluidSimulator instances (one per layer, plus the StudioPage
 * scratchpad) allocate their textures/FBOs on this single context and blit
 * their rendered frames from the shared hidden canvas into their own 2D
 * canvases. One context for the whole app sidesteps the browser's live
 * WebGL context limit (~8-16) with dynamically created/deleted layers.
 */

export interface SharedGL {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  /** Grow (never shrink) the shared blit canvas to at least w x h. */
  ensureSize(w: number, h: number): void;
  /** Subscribe to context-restored; returns an unsubscribe function. */
  onContextRestored(cb: () => void): () => void;
}

let shared: SharedGL | null = null;
let refCount = 0;
const restoredCallbacks = new Set<() => void>();

function createShared(): SharedGL {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;

  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    antialias: false,
    depth: false,
    stencil: false,
  }) as WebGL2RenderingContext | null;

  if (!gl) {
    throw new Error('WebGL2 is required for the watercolor engine but is not available in this browser.');
  }
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('WebGL2 float render targets (EXT_color_buffer_float) are required for the watercolor engine.');
  }

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);

  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => {
    gl.getExtension('EXT_color_buffer_float');
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    restoredCallbacks.forEach((cb) => cb());
  });

  return {
    gl,
    canvas,
    ensureSize(w: number, h: number) {
      if (canvas.width < w) canvas.width = w;
      if (canvas.height < h) canvas.height = h;
    },
    onContextRestored(cb: () => void) {
      restoredCallbacks.add(cb);
      return () => restoredCallbacks.delete(cb);
    },
  };
}

export function acquireGL(): SharedGL {
  if (!shared) shared = createShared();
  refCount++;
  return shared;
}

export function releaseGL(): void {
  refCount = Math.max(0, refCount - 1);
  // The context is intentionally kept alive at refcount 0 — it's cheap to
  // retain and re-creating contexts repeatedly risks hitting browser limits.
}
