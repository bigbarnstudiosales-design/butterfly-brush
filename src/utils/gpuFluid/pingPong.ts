/**
 * Float texture + framebuffer helpers: ping-pong pairs for iterative passes
 * and single-buffer fields for write-once/read-many data (grain, divergence).
 */

function createTexture(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  internalFormat: number,
  filter: number
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('Failed to create texture');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function createFbo(gl: WebGL2RenderingContext, tex: WebGLTexture): WebGLFramebuffer {
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('Failed to create framebuffer');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Framebuffer incomplete: 0x${status.toString(16)} (float render targets unsupported?)`);
  }
  return fbo;
}

export class Field {
  public read: WebGLTexture;
  public write: WebGLTexture;
  public fboRead: WebGLFramebuffer;
  public fboWrite: WebGLFramebuffer;

  constructor(
    private gl: WebGL2RenderingContext,
    public readonly width: number,
    public readonly height: number,
    internalFormat: number,
    filter: number
  ) {
    this.read = createTexture(gl, width, height, internalFormat, filter);
    this.write = createTexture(gl, width, height, internalFormat, filter);
    this.fboRead = createFbo(gl, this.read);
    this.fboWrite = createFbo(gl, this.write);
    this.clear();
  }

  swap(): void {
    [this.read, this.write] = [this.write, this.read];
    [this.fboRead, this.fboWrite] = [this.fboWrite, this.fboRead];
  }

  clear(): void {
    const gl = this.gl;
    gl.disable(gl.SCISSOR_TEST);
    for (const fbo of [this.fboRead, this.fboWrite]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.read);
    gl.deleteTexture(this.write);
    gl.deleteFramebuffer(this.fboRead);
    gl.deleteFramebuffer(this.fboWrite);
  }
}

export class SingleField {
  public tex: WebGLTexture;
  public fbo: WebGLFramebuffer;

  constructor(
    private gl: WebGL2RenderingContext,
    public readonly width: number,
    public readonly height: number,
    internalFormat: number,
    filter: number
  ) {
    this.tex = createTexture(gl, width, height, internalFormat, filter);
    this.fbo = createFbo(gl, this.tex);
    this.clear();
  }

  clear(): void {
    const gl = this.gl;
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Upload single-channel float data (R16F texture, FLOAT source). */
  uploadR(data: Float32Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl.RED, gl.FLOAT, data);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.tex);
    gl.deleteFramebuffer(this.fbo);
  }
}
