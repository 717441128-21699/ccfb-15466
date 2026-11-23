/**
 * 动画素材: 内存布局为 frames × rows × cols × RGBA。
 * 第 0 行是画面顶部(上传着色器时会翻转 v 坐标)。
 */
export interface AnimationData {
  label: string;
  cols: number;
  rows: number;
  frames: number;
  frameDuration: number; // 每帧时长 (s)
  data: Uint8ClampedArray;
}

type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number, f: number, F: number) => void;

function makeAnim(
  label: string,
  cols: number,
  rows: number,
  frames: number,
  frameDuration: number,
  draw: DrawFn,
): AnimationData {
  const cv = document.createElement('canvas');
  cv.width = cols;
  cv.height = rows;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  const data = new Uint8ClampedArray(cols * rows * 4 * frames);
  for (let f = 0; f < frames; f++) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cols, rows);
    draw(ctx, cols, rows, f, frames);
    data.set(ctx.getImageData(0, 0, cols, rows).data, f * cols * rows * 4);
  }
  return { label, cols, rows, frames, frameDuration, data };
}

/** 彩条测试卡: 滚动色相条 + 白色校准列, 便于肉眼直接看出拉伸 */
export function makeColorBars(cols = 320, rows = 64, frames = 12): AnimationData {
  return makeAnim('彩条测试', cols, rows, frames, 1 / 12, (ctx, w, h, f, F) => {
    for (let x = 0; x < w; x++) {
      const hue = Math.floor(((x / w) * 360 + (f / F) * 360) % 360);
      ctx.fillStyle = `hsl(${hue}, 90%, 55%)`;
      ctx.fillRect(x, 0, 1, h);
    }
    // 每 40 列一条白色校准竖线, 用于观察间距是否均匀
    ctx.fillStyle = '#fff';
    for (let x = 0; x < w; x += 40) ctx.fillRect(x, 0, 2, h);
    ctx.fillStyle = '#000';
    for (let x = 0; x < w; x += 40) ctx.fillRect(x, h / 2 - 3, 2, 6);
  });
}

/** 弹跳小球 */
export function makeBouncingBall(cols = 320, rows = 64, frames = 16): AnimationData {
  return makeAnim('弹跳小球', cols, rows, frames, 1 / 16, (ctx, w, h, f, F) => {
    // 地面
    ctx.fillStyle = '#264';
    ctx.fillRect(0, h - 4, w, 4);
    const r = h * 0.16;
    const x = ((f / F) * (w + 4 * r)) % (w + 4 * r) - 2 * r;
    const bounces = 3;
    const phase = ((f / F) * bounces) % 1;
    const y = h - 4 - r - Math.abs(Math.sin(phase * Math.PI)) * (h - 8 - 2 * r);
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, '#ffd');
    g.addColorStop(0.6, '#fa3');
    g.addColorStop(1, '#c20');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** 滚动文字 */
export function makeScrollingText(cols = 320, rows = 64, frames = 24): AnimationData {
  const text = '欢迎乘坐地铁 · WELCOME · 下一站 世纪大道 · ';
  // 先把整段文字画到长条离屏画布
  const strip = document.createElement('canvas');
  const sctx = strip.getContext('2d')!;
  const font = `bold ${Math.floor(rows * 0.62)}px "Microsoft YaHei", sans-serif`;
  sctx.font = font;
  const textW = Math.ceil(sctx.measureText(text).width) + 8;
  strip.width = textW;
  strip.height = rows;
  sctx.font = font;
  sctx.textBaseline = 'middle';
  sctx.fillStyle = '#000';
  sctx.fillRect(0, 0, textW, rows);
  const grad = sctx.createLinearGradient(0, 0, textW, 0);
  grad.addColorStop(0, '#0ff');
  grad.addColorStop(0.5, '#fff');
  grad.addColorStop(1, '#0af');
  sctx.fillStyle = grad;
  sctx.fillText(text, 4, rows / 2);

  return makeAnim('滚动文字', cols, rows, frames, 1 / 12, (ctx, w, h, f, F) => {
    const off = Math.floor((f / F) * textW);
    ctx.drawImage(strip, off, 0, w, h, 0, 0, w, h);
    if (off + w > textW) ctx.drawImage(strip, 0, 0, off + w - textW, h, textW - off, 0, off + w - textW, h);
  });
}

/** 波浪等离子 */
export function makeWave(cols = 320, rows = 64, frames = 16): AnimationData {
  return makeAnim('波浪等离子', cols, rows, frames, 1 / 16, (ctx, w, h, f, F) => {
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const ph = (f / F) * Math.PI * 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v =
          Math.sin(x * 0.09 + ph) +
          Math.sin((x * 0.05 + y * 0.18) - ph * 1.3) +
          Math.sin(Math.hypot(x - w / 2, y - h / 2) * 0.15 - ph);
        const i = (y * w + x) * 4;
        d[i] = 128 + 127 * Math.sin(v + ph);
        d[i + 1] = 128 + 127 * Math.sin(v + ph + 2.1);
        d[i + 2] = 128 + 127 * Math.sin(v + ph + 4.2);
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

/** 上传图片 → 动画。spriteFrames > 1 时按横向等分切成多帧。 */
export function animationFromImage(
  img: HTMLImageElement,
  cols: number,
  rows: number,
  spriteFrames: number,
  frameDuration: number,
): AnimationData {
  const fw = Math.floor(img.naturalWidth / spriteFrames);
  return makeAnim('上传图片', cols, rows, spriteFrames, frameDuration, (ctx, w, h, f) => {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, f * fw, 0, fw, img.naturalHeight, 0, 0, w, h);
  });
}

/** 空白动画(视频上传时占位, 每帧由视频更新) */
export function makeBlank(cols: number, rows: number): AnimationData {
  return {
    label: '视频上传',
    cols,
    rows,
    frames: 1,
    frameDuration: 1,
    data: new Uint8ClampedArray(cols * rows * 4),
  };
}
