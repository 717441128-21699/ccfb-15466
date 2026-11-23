import type { StripConfig, ViewConfig } from '../types';

export interface SchematicState {
  strips: StripConfig;
  trainPos: number;   // 列车当前位置 (m, 墙面坐标)
  view: ViewConfig;
  imgU0: number;      // 画面左缘(列车系)
  imgW: number;       // 画面宽度 (m)
  lastFlash: Float64Array; // 每根灯条最近一次点亮时刻
  simTime: number;
}

/** 隧道侧视示意图: 墙面灯条、列车车窗、乘客视线锥 */
export function drawSchematic(canvas: HTMLCanvasElement, s: SchematicState): void {
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

  const v = s.view;
  // 世界横向范围: 以画面为中心
  const cx = s.trainPos + s.imgU0 + s.imgW / 2;
  const span = s.imgW * 1.3 + 4;
  const x0 = cx - span / 2;
  const sx = (wx: number) => ((wx - x0) / span) * W;
  // 竖向: 0..3m 映射到画布(下边上轨面)
  const sy = (wy: number) => H - 14 - (wy / 3) * (H - 28);

  // 墙面
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, sy(0));
  ctx.lineTo(W, sy(0));
  ctx.stroke();
  ctx.fillStyle = '#888';
  ctx.font = '11px sans-serif';
  ctx.fillText('隧道墙 / 灯条', 6, 12);

  // 灯条
  const stripTop = s.strips.bottomY + s.strips.pixelsPerStrip * s.strips.pixelPitch;
  const i0 = Math.max(0, Math.floor((x0 - s.strips.startX) / s.strips.spacing));
  const i1 = Math.min(s.strips.count - 1, Math.ceil((x0 + span - s.strips.startX) / s.strips.spacing));
  for (let i = i0; i <= i1; i++) {
    const x = s.strips.startX + i * s.strips.spacing;
    const age = s.simTime - (s.lastFlash[i] ?? -1e9);
    const hot = age < 0.05;
    ctx.strokeStyle = hot ? '#ff5' : '#3a6ea5';
    ctx.lineWidth = hot ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(sx(x), sy(s.strips.bottomY));
    ctx.lineTo(sx(x), sy(stripTop));
    ctx.stroke();
  }

  // 画面区域(列车系 → 墙面坐标)
  const imgL = s.trainPos + s.imgU0;
  ctx.strokeStyle = 'rgba(0,255,200,0.7)';
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(sx(imgL), sy(2.6), s.imgW * (W / span), sy(2.2) - sy(2.6));
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(0,255,200,0.8)';
  ctx.fillText('广告画面(随车移动)', sx(imgL) + 4, sy(2.65));

  // 列车(半透明车体 + 车窗)
  const trainL = s.trainPos + v.winX0 - 1.2;
  const trainR = s.trainPos + v.winX1 + 1.2;
  ctx.fillStyle = 'rgba(120,140,180,0.25)';
  ctx.fillRect(sx(trainL), sy(2.1), (trainR - trainL) * (W / span), sy(0.2) - sy(2.1));
  ctx.strokeStyle = '#9ab';
  ctx.strokeRect(sx(trainL), sy(2.1), (trainR - trainL) * (W / span), sy(0.2) - sy(2.1));
  ctx.fillStyle = 'rgba(80,200,255,0.35)';
  ctx.fillRect(sx(s.trainPos + v.winX0), sy(v.winY1), (v.winX1 - v.winX0) * (W / span), sy(v.winY0) - sy(v.winY1));
  ctx.fillStyle = '#9ab';
  ctx.fillText('列车', sx(trainL) + 4, sy(2.0));

  // 乘客眼睛 + 视线锥(眼睛 → 车窗边缘 → 墙面)
  const ex = s.trainPos + v.eyeX;
  const scale = (v.eyeToWindow + v.wallDist) / v.eyeToWindow;
  ctx.fillStyle = '#ffb347';
  ctx.beginPath();
  ctx.arc(sx(ex), sy(v.eyeY), 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,179,71,0.5)';
  for (const wy of [v.winY0, v.winY1]) {
    const wallY = v.eyeY + (wy - v.eyeY) * scale;
    ctx.beginPath();
    ctx.moveTo(sx(ex), sy(v.eyeY));
    ctx.lineTo(sx(ex + (s.trainPos + v.winX0 - ex) * 1.0), sy(wy));
    ctx.lineTo(sx(ex + (s.trainPos + v.winX0 - ex) * scale), sy(wallY));
    ctx.stroke();
  }
}
