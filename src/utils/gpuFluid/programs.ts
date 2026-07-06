/**
 * Minimal WebGL2 program wrapper + explicit pass-state binding.
 *
 * Every pass runs through bindPass() so viewport/scissor/blend are set
 * explicitly each time — multiple simulators share one GL context, and
 * inherited stale state is the classic bug in that setup.
 */

import { VERT_FULLSCREEN } from './shaders';

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}\n---\n${src}`);
  }
  return shader;
}

export class Program {
  public readonly handle: WebGLProgram;
  private uniforms = new Map<string, WebGLUniformLocation | null>();

  constructor(private gl: WebGL2RenderingContext, fragSrc: string) {
    const vs = compile(gl, gl.VERTEX_SHADER, VERT_FULLSCREEN);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
    const prog = gl.createProgram();
    if (!prog) throw new Error('Failed to create program');
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error(`Program link failed: ${log}`);
    }
    this.handle = prog;
  }

  use(): void {
    this.gl.useProgram(this.handle);
  }

  uniform(name: string): WebGLUniformLocation | null {
    if (!this.uniforms.has(name)) {
      this.uniforms.set(name, this.gl.getUniformLocation(this.handle, name));
    }
    return this.uniforms.get(name) ?? null;
  }

  bindTexture(name: string, tex: WebGLTexture, unit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.uniform(name), unit);
  }

  dispose(): void {
    this.gl.deleteProgram(this.handle);
    this.uniforms.clear();
  }
}

export interface PassBlend {
  srcRGB: number;
  dstRGB: number;
  srcAlpha: number;
  dstAlpha: number;
}

/**
 * Bind a pass: program + target FBO (null = default framebuffer) + explicit
 * viewport/scissor/blend state. Scissor defaults to the full viewport.
 */
export function bindPass(
  gl: WebGL2RenderingContext,
  program: Program,
  fbo: WebGLFramebuffer | null,
  width: number,
  height: number,
  opts?: {
    blend?: PassBlend;
    scissor?: { x: number; y: number; w: number; h: number };
    viewport?: { x: number; y: number; w: number; h: number };
  }
): void {
  program.use();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const vp = opts?.viewport ?? { x: 0, y: 0, w: width, h: height };
  gl.viewport(vp.x, vp.y, vp.w, vp.h);
  gl.enable(gl.SCISSOR_TEST);
  const sc = opts?.scissor ?? vp;
  gl.scissor(sc.x, sc.y, sc.w, sc.h);
  if (opts?.blend) {
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(opts.blend.srcRGB, opts.blend.dstRGB, opts.blend.srcAlpha, opts.blend.dstAlpha);
  } else {
    gl.disable(gl.BLEND);
  }
}

/** Draw the fullscreen triangle (no attributes; VERT_FULLSCREEN uses gl_VertexID). */
export function drawFullscreen(gl: WebGL2RenderingContext): void {
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
