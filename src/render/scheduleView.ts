import type { Flash } from '../types';

/**
 * 点亮时序图: 横轴时间, 纵轴灯条编号, 颜色表示点亮的动画列。
 * 斜纹均匀 → 时序与车速匹配; 斜率突变/断裂 → 撕裂风险。
 */
export function drawScheduleView(
  canvas: HTMLCanvasElement,
  flashes: Flash[],
  simTime: number,
  cols: number,
  windowSec = 2.0,
): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (W === 0 || H === 0) return;
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width = W * dpr;
    canvas.height = H * dpr;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#101418';
  ctx.fillRect(0, 0, W, H);

  const t0 = simTime - windowSec;
  let minStrip = Infinity, maxStrip = -Infinity;
  for (const f of flashes) {
    if (f.strip < minStrip) minStrip = f.strip;
    if (f.strip > maxStrip) maxStrip = f.strip;
  }
  if (!isFinite(minStrip)) {
    ctx.fillStyle = '#667';
    ctx.font = '12px sans-serif';
    ctx.fillText('等待灯条进入画面区域…', 10, H / 2);
    return;
  }
  const stripSpan = Math.max(1, maxStrip - minStrip);

  for (const f of flashes) {
    if (f.t < t0) continue;
    const x = ((f.t - t0) / windowSec) * W;
    const y = H - 6 - ((f.strip - minStrip) / stripSpan) * (H - 24);
    const hue = (f.col / cols) * 360;
    ctx.fillStyle = `hsl(${hue}, 85%, 60%)`;
    ctx.fillRect(x, y, 1.6, 1.6);
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(W - 1, 0);
  ctx.lineTo(W - 1, H);
  ctx.stroke();
  ctx.fillStyle = '#667';
  ctx.font = '11px sans-serif';
  ctx.fillText(`灯条 #${minStrip}–#${maxStrip} · 右缘=现在 · 窗口 ${windowSec}s`, 8, 14);
}
