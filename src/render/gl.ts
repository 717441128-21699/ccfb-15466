import type { AnimationData } from '../anim/animation';

const VS = `#version 300 es
layout(location=0) in vec2 aPos;      // x∈[-0.5,0.5] 横向剖面, y∈[0,1] 沿灯条
layout(location=1) in float aU;       // 痕迹在列车系中的位置 (m)
layout(location=2) in float aCol;     // 动画列号
layout(location=3) in float aFrame;   // 动画帧号
layout(location=4) in float aWeight;  // 余晖权重
uniform vec2 uViewX;   // 视野横向范围(墙面坐标)
uniform vec2 uViewY;   // 视野竖向范围
uniform vec2 uStripY;  // 灯条竖直跨度
uniform float uHalfWidth; // 单列痕迹的横向半宽 (m)
uniform float uCols;
out vec2 vLocal;
out float vColU;
out float vFrame;
out float vWeight;
void main() {
  float xw = aU + aPos.x * 2.0 * uHalfWidth;
  float yw = mix(uStripY.x, uStripY.y, aPos.y);
  float cx = (xw - uViewX.x) / (uViewX.y - uViewX.x) * 2.0 - 1.0;
  float cy = (yw - uViewY.x) / (uViewY.y - uViewY.x) * 2.0 - 1.0;
  gl_Position = vec4(cx, cy, 0.0, 1.0);
  vLocal = aPos;
  vColU = (aCol + 0.5) / uCols;
  vFrame = aFrame;
  vWeight = aWeight;
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2DArray uAnim;
uniform float uRows;
uniform float uScan;   // 是否模拟离散 LED 灯珠的横向暗纹
in vec2 vLocal;
in float vColU;
in float vFrame;
in float vWeight;
out vec4 outColor;
void main() {
  vec3 tex = texture(uAnim, vec3(vColU, 1.0 - vLocal.y, vFrame)).rgb;
  float prof = exp(-vLocal.x * vLocal.x * 6.0); // 单条痕迹的高斯横向剖面
  float scan = 1.0;
  if (uScan > 0.5) {
    float s = abs(sin(vLocal.y * uRows * 3.14159265));
    scan = 0.72 + 0.28 * s;
  }
  outColor = vec4(tex * (vWeight * prof * scan), 1.0);
}`;

const POST_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const POST_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uExposure;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  c = vec3(1.0) - exp(-c * uExposure); // 柔和高光滚降
  c = pow(c, vec3(1.0 / 2.2));
  outColor = vec4(c, 1.0);
}`;

export interface RenderOpts {
  instances: Float32Array; // 每个实例 4 个 float: u, col, frame, weight
  count: number;
  viewX0: number; viewX1: number;
  viewY0: number; viewY1: number;
  stripY0: number; stripY1: number;
  halfWidth: number;
  cols: number;
  rows: number;
  scanlines: boolean;
  exposure: number;
}

/**
 * 乘客视角渲染器(WebGL2)。
 * 每条视觉暂留痕迹画成一个实例化竖条, 加性混合叠加,
 * 先渲染到浮点帧缓冲, 再做曝光/伽马校正输出。
 */
export class PassengerRenderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private postProg: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject;
  private instVbo: WebGLBuffer;
  private animTex: WebGLTexture;
  private fbo: WebGLFramebuffer | null = null;
  private fboTex: WebGLTexture | null = null;
  private capacity = 0;
  private uni: Record<string, WebGLUniformLocation | null> = {};
  private postUni: Record<string, WebGLUniformLocation | null> = {};
  private animW = 1;
  private animH = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.prog = makeProgram(gl, VS, FS);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, 0, 0.5, 0, -0.5, 1, 0.5, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.instVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instVbo);
    for (let loc = 1; loc <= 4; loc++) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 1, gl.FLOAT, false, 16, (loc - 1) * 4);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);

    this.animTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.animTex);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]));

    if (gl.getExtension('EXT_color_buffer_float')) {
      this.postProg = makeProgram(gl, POST_VS, POST_FS);
      this.allocFbo();
    }

    for (const n of ['uViewX', 'uViewY', 'uStripY', 'uHalfWidth', 'uCols', 'uRows', 'uScan', 'uAnim'])
      this.uni[n] = gl.getUniformLocation(this.prog, n);
    if (this.postProg)
      for (const n of ['uTex', 'uExposure'])
        this.postUni[n] = gl.getUniformLocation(this.postProg, n);
  }

  private allocFbo(): void {
    const gl = this.gl;
    if (this.fboTex) { gl.deleteTexture(this.fboTex); gl.deleteFramebuffer(this.fbo); }
    this.fboTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.canvas.width, this.canvas.height, 0,
      gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  resize(): void {
    if (this.fbo) this.allocFbo();
  }

  setAnimation(anim: AnimationData): void {
    const gl = this.gl;
    this.animW = anim.cols;
    this.animH = anim.rows;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.animTex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, anim.cols, anim.rows, anim.frames, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, anim.data);
  }

  /** 视频模式: 每帧更新第 0 层 */
  updateFrame(data: Uint8ClampedArray): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.animTex);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, this.animW, this.animH, 1,
      gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  render(o: RenderOpts): void {
    const gl = this.gl;
    if (o.count > this.capacity) {
      this.capacity = Math.max(o.count, this.capacity * 2, 4096);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instVbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.capacity * 16, gl.DYNAMIC_DRAW);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, o.instances, 0, o.count * 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.prog);
    gl.uniform2f(this.uni.uViewX, o.viewX0, o.viewX1);
    gl.uniform2f(this.uni.uViewY, o.viewY0, o.viewY1);
    gl.uniform2f(this.uni.uStripY, o.stripY0, o.stripY1);
    gl.uniform1f(this.uni.uHalfWidth, o.halfWidth);
    gl.uniform1f(this.uni.uCols, o.cols);
    gl.uniform1f(this.uni.uRows, o.rows);
    gl.uniform1f(this.uni.uScan, o.scanlines ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.animTex);
    gl.uniform1i(this.uni.uAnim, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, o.count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);

    if (this.fbo && this.postProg) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(this.postProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
      gl.uniform1i(this.postUni.uTex, 0);
      gl.uniform1f(this.postUni.uExposure, o.exposure);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }
}

function makeProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(prog));
  return prog;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    throw new Error('着色器编译失败: ' + gl.getShaderInfoLog(sh));
  return sh;
}
