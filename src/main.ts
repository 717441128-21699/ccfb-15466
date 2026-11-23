import type { Flash, SimConfig } from './types';
import { TrainMotion, MeasuredTrack } from './physics/train';
import { FlashGenerator, simulateAll, type ScheduleParams } from './physics/schedule';
import { measureStretch, measureCoverage } from './physics/persistence';
import {
  makeColorBars, makeBouncingBall, makeScrollingText, makeWave,
  animationFromImage, makeBlank, type AnimationData,
} from './anim/animation';
import { PassengerRenderer } from './render/gl';
import { drawSchematic } from './render/schematic';
import { drawScheduleView } from './render/scheduleView';
import { STRIP_PRESETS, TRAIN_PRESETS, VIEW_PRESETS } from './ui/presets';

// ---------------------------------------------------------------- 配置与状态

const cfg: SimConfig = {
  strips: STRIP_PRESETS.standard.make(),
  train: {
    profile: TRAIN_PRESETS.sine.profile,
    measLatency: 0.06,
    measNoise: 0.005,
    timingMode: 'adaptive',
    fixedSpeed: 70 / 3.6,
  },
  view: {
    eyeX: 0, eyeY: 1.25, eyeToWindow: 0.5, wallDist: 2.0,
    winX0: -0.25, winX1: 0.95, winY0: 0.9, winY1: 1.7,
  },
  tau: 0.06,
  cols: 320,
  colWidth: 0.02,
  frameDuration: 1 / 12,
};

const ANIM_BUILDERS: Record<string, () => AnimationData> = {
  bars: makeColorBars,
  ball: makeBouncingBall,
  text: makeScrollingText,
  wave: makeWave,
};

let anim: AnimationData = makeColorBars();
let videoEl: HTMLVideoElement | null = null; // 非空表示视频模式
let motion: TrainMotion;
let meas: MeasuredTrack;
let gen: FlashGenerator;
let flashes: Flash[] = [];
let lastFlash: Float64Array = new Float64Array(0);
let simTime = 0;
let playing = true;
let timeScale = 1;
let exposure = 2.0;
let scanlines = true;

// ---------------------------------------------------------------- DOM 工具

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`缺少元素 #${id}`);
  return e as T;
}
const num = (id: string) => parseFloat(el<HTMLInputElement>(id).value);
const setNum = (id: string, v: number) => { el<HTMLInputElement>(id).value = String(v); };

// ---------------------------------------------------------------- 仿真核心

function imgU0(): number {
  return (cfg.view.winX0 + cfg.view.winX1) / 2 - (cfg.cols * cfg.colWidth) / 2;
}

function scheduleParams(): ScheduleParams {
  return {
    strips: cfg.strips,
    cols: cfg.cols,
    colWidth: cfg.colWidth,
    imgU0: imgU0(),
    frameDuration: anim.frameDuration,
    frameCount: anim.frames,
  };
}

function rebuild(): void {
  motion = new TrainMotion(cfg.train.profile);
  meas = new MeasuredTrack(
    motion, cfg.train.measLatency, cfg.train.measNoise,
    cfg.train.timingMode === 'fixed' ? cfg.train.fixedSpeed : null,
  );
  gen = new FlashGenerator(scheduleParams(), motion, (t) => meas.position(t));
  flashes = [];
  lastFlash = new Float64Array(cfg.strips.count).fill(-1e9);
  simTime = 0;
}

/** 乘客透过车窗看到的墙面范围(相似三角形投影) */
function viewRange(): { x0: number; x1: number; y0: number; y1: number } {
  const v = cfg.view;
  const s = (v.eyeToWindow + v.wallDist) / v.eyeToWindow;
  return {
    x0: v.eyeX + (v.winX0 - v.eyeX) * s,
    x1: v.eyeX + (v.winX1 - v.eyeX) * s,
    y0: v.eyeY + (v.winY0 - v.eyeY) * s,
    y1: v.eyeY + (v.winY1 - v.eyeY) * s,
  };
}

// ---------------------------------------------------------------- 渲染初始化

const viewCanvas = el<HTMLCanvasElement>('passengerView');
const renderer = new PassengerRenderer(viewCanvas);
renderer.setAnimation(anim);

const MAX_INST = 65536;
const inst = new Float32Array(MAX_INST * 4);

// 视频上传的帧抓取
const videoScratch = document.createElement('canvas');
function uploadVideoFrame(): void {
  if (!videoEl || videoEl.readyState < 2) return;
  videoScratch.width = anim.cols;
  videoScratch.height = anim.rows;
  const ctx = videoScratch.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(videoEl, 0, 0, anim.cols, anim.rows);
  renderer.updateFrame(ctx.getImageData(0, 0, anim.cols, anim.rows).data);
}

// ---------------------------------------------------------------- 主循环

let lastNow = performance.now();
let fps = 60;
let metricTimer = 0;
let stretchPct = 0;
let tearCols = 0;
let coverage = 1;

function frame(now: number): void {
  const realDt = Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now;
  fps = fps * 0.95 + (1 / Math.max(realDt, 1e-4)) * 0.05;

  if (playing) {
    let target = simTime + realDt * timeScale;
    if (target >= motion.duration) {
      target = 0;
      flashes = [];
      gen.reset();
      lastFlash.fill(-1e9);
    }
    const before = flashes.length;
    gen.advance(target, flashes);
    for (let i = before; i < flashes.length; i++) lastFlash[flashes[i].strip] = flashes[i].t;
    simTime = target;
  }

  // 丢弃余晖窗口之外的痕迹
  const keep = 4 * cfg.tau;
  let w = 0;
  for (let i = 0; i < flashes.length; i++) {
    if (simTime - flashes[i].t <= keep) flashes[w++] = flashes[i];
  }
  flashes.length = w;

  // 组装实例: 每条痕迹 = (列车系位置, 列, 帧, 余晖权重)
  const vr = viewRange();
  const stripTop = cfg.strips.bottomY + cfg.strips.pixelsPerStrip * cfg.strips.pixelPitch;
  const stripVisible = stripTop >= vr.y0 && cfg.strips.bottomY <= vr.y1;
  let n = 0;
  if (stripVisible) {
    for (const f of flashes) {
      if (n >= MAX_INST) break;
      if (f.u < vr.x0 - 0.1 || f.u > vr.x1 + 0.1) continue;
      const wt = cfg.strips.duty * Math.exp(-(simTime - f.t) / cfg.tau);
      inst[n * 4] = f.u;
      inst[n * 4 + 1] = f.col;
      inst[n * 4 + 2] = videoEl ? 0 : f.frame;
      inst[n * 4 + 3] = wt;
      n++;
    }
  }

  if (videoEl) uploadVideoFrame();

  renderer.render({
    instances: inst, count: n,
    viewX0: vr.x0, viewX1: vr.x1, viewY0: vr.y0, viewY1: vr.y1,
    stripY0: cfg.strips.bottomY, stripY1: stripTop,
    halfWidth: cfg.colWidth * 0.75,
    cols: cfg.cols, rows: anim.rows,
    scanlines, exposure,
  });

  // 指标(每 0.25s 更新)
  metricTimer += realDt;
  if (metricTimer >= 0.25) {
    metricTimer = 0;
    const recent = flashes.filter((f) => simTime - f.t <= 0.25);
    const m = measureStretch(recent, cfg.colWidth);
    stretchPct = m.stretchPct;
    tearCols = m.tearCols;
    coverage = measureCoverage(recent, simTime, cfg.tau, cfg.cols, imgU0(), cfg.colWidth, vr.x0, vr.x1);
    updateHud(n);
    updateSchedStats();
  }

  drawSchematic(el('schematic'), {
    strips: cfg.strips, trainPos: motion.position(simTime), view: cfg.view,
    imgU0: imgU0(), imgW: cfg.cols * cfg.colWidth, lastFlash, simTime,
  });
  drawScheduleView(el('scheduleView'), flashes, simTime, cfg.cols);

  requestAnimationFrame(frame);
}

function updateHud(instCount: number): void {
  const kmh = motion.speed(simTime) * 3.6;
  el('hud').textContent =
    `FPS ${fps.toFixed(0)}  |  横向拉伸 ${stretchPct >= 0 ? '+' : ''}${stretchPct.toFixed(2)}%  |  ` +
    `错位 ${tearCols.toFixed(1)}列  |  覆盖 ${(coverage * 100).toFixed(0)}%  |  车速 ${kmh.toFixed(1)} km/h  |  ` +
    `t=${simTime.toFixed(1)}s  |  痕迹 ${instCount}`;
}

function updateSchedStats(): void {
  const recent = flashes.filter((f) => simTime - f.t <= 1.0);
  const strips = new Set(recent.map((f) => f.strip));
  el('schedStats').textContent =
    `近1s点亮 ${recent.length} 次 · 活跃灯条 ${strips.size} 根 · ` +
    `模式: ${cfg.train.timingMode === 'adaptive' ? '按测速自适应' : `固定假设 ${(cfg.train.fixedSpeed * 3.6).toFixed(0)} km/h`}`;
}

// ---------------------------------------------------------------- UI 绑定

function fillSelect(id: string, entries: Record<string, { label: string }>): void {
  const sel = el<HTMLSelectElement>(id);
  sel.innerHTML = '';
  for (const [key, val] of Object.entries(entries)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = val.label;
    sel.appendChild(opt);
  }
}

function syncStripInputs(): void {
  setNum('inSpacing', cfg.strips.spacing);
  setNum('inCount', cfg.strips.count);
  setNum('inPixels', cfg.strips.pixelsPerStrip);
  setNum('inPitch', cfg.strips.pixelPitch);
  setNum('inRefresh', cfg.strips.refreshRate);
  setNum('inDuty', cfg.strips.duty);
}

function syncViewInputs(): void {
  const v = cfg.view;
  setNum('inEyeX', v.eyeX);
  setNum('inEyeY', v.eyeY);
  setNum('inEyeToWin', v.eyeToWindow);
  setNum('inWallDist', v.wallDist);
  setNum('inWinCX', (v.winX0 + v.winX1) / 2);
  setNum('inWinW', v.winX1 - v.winX0);
  setNum('inWinY0', v.winY0);
  setNum('inWinY1', v.winY1);
}

function bind(): void {
  fillSelect('selStripPreset', STRIP_PRESETS);
  fillSelect('selTrainPreset', TRAIN_PRESETS);
  fillSelect('selViewPreset', VIEW_PRESETS);
  fillSelect('selAnim', Object.fromEntries(Object.keys(ANIM_BUILDERS).map((k) => [k, { label: ANIM_BUILDERS[k]().label }])));
  el<HTMLSelectElement>('selTrainPreset').value = 'sine';
  syncStripInputs();
  syncViewInputs();
  setNum('inLatency', cfg.train.measLatency);
  setNum('inNoise', cfg.train.measNoise * 100);
  setNum('inFixedSpeed', cfg.train.fixedSpeed * 3.6);
  setNum('inTau', cfg.tau * 1000);
  setNum('inExposure', exposure);

  // 灯条布置
  el('selStripPreset').addEventListener('change', (e) => {
    cfg.strips = STRIP_PRESETS[(e.target as HTMLSelectElement).value].make();
    syncStripInputs();
    rebuild();
  });
  const stripChanged = () => {
    cfg.strips = {
      ...cfg.strips,
      spacing: num('inSpacing'), count: Math.round(num('inCount')),
      pixelsPerStrip: Math.round(num('inPixels')), pixelPitch: num('inPitch'),
      refreshRate: num('inRefresh'), duty: num('inDuty'),
    };
    rebuild();
  };
  for (const id of ['inSpacing', 'inCount', 'inPixels', 'inPitch', 'inRefresh', 'inDuty'])
    el(id).addEventListener('change', stripChanged);

  // 列车运行
  el('selTrainPreset').addEventListener('change', (e) => {
    cfg.train.profile = TRAIN_PRESETS[(e.target as HTMLSelectElement).value].profile;
    rebuild();
  });
  el('inLatency').addEventListener('change', () => { cfg.train.measLatency = num('inLatency'); rebuild(); });
  el('inNoise').addEventListener('change', () => { cfg.train.measNoise = num('inNoise') / 100; rebuild(); });
  el('selTimingMode').addEventListener('change', (e) => {
    cfg.train.timingMode = (e.target as HTMLSelectElement).value as 'adaptive' | 'fixed';
    rebuild();
  });
  el('inFixedSpeed').addEventListener('change', () => { cfg.train.fixedSpeed = num('inFixedSpeed') / 3.6; rebuild(); });

  // 乘客视角(只影响渲染, 不必重算时序)
  el('selViewPreset').addEventListener('change', (e) => {
    Object.assign(cfg.view, VIEW_PRESETS[(e.target as HTMLSelectElement).value].view);
    syncViewInputs();
  });
  const viewChanged = () => {
    const cx = num('inWinCX'), w = num('inWinW');
    cfg.view = {
      eyeX: num('inEyeX'), eyeY: num('inEyeY'),
      eyeToWindow: num('inEyeToWin'), wallDist: num('inWallDist'),
      winX0: cx - w / 2, winX1: cx + w / 2,
      winY0: num('inWinY0'), winY1: num('inWinY1'),
    };
  };
  for (const id of ['inEyeX', 'inEyeY', 'inEyeToWin', 'inWallDist', 'inWinCX', 'inWinW', 'inWinY0', 'inWinY1'])
    el(id).addEventListener('change', viewChanged);

  // 点亮时序
  el('btnRebuild').addEventListener('click', rebuild);
  el('btnCSV').addEventListener('click', exportCSV);

  // 动画素材
  el('selAnim').addEventListener('change', (e) => {
    videoEl = null;
    anim = ANIM_BUILDERS[(e.target as HTMLSelectElement).value]();
    renderer.setAnimation(anim);
    rebuild();
  });
  el<HTMLInputElement>('fileUpload').addEventListener('change', onUpload);
  el('inTau').addEventListener('change', () => { cfg.tau = num('inTau') / 1000; });
  el('inExposure').addEventListener('change', () => { exposure = num('inExposure'); });
  el<HTMLInputElement>('chkScan').addEventListener('change', (e) => {
    scanlines = (e.target as HTMLInputElement).checked;
  });

  // 播放
  el('btnPlay').addEventListener('click', () => {
    playing = !playing;
    el('btnPlay').textContent = playing ? '暂停' : '播放';
  });
  el('btnReset').addEventListener('click', rebuild);
  el('inTimeScale').addEventListener('change', () => { timeScale = Math.max(0.1, num('inTimeScale')); });
}

function onUpload(e: Event): void {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  if (file.type.startsWith('video/')) {
    const v = document.createElement('video');
    v.src = url;
    v.muted = true;
    v.loop = true;
    v.play();
    videoEl = v;
    anim = makeBlank(cfg.cols, 64);
    renderer.setAnimation(anim);
    rebuild();
  } else {
    const img = new Image();
    img.onload = () => {
      videoEl = null;
      const frames = Math.max(1, Math.round(num('inSpriteFrames')));
      anim = animationFromImage(img, cfg.cols, 64, frames, cfg.frameDuration);
      renderer.setAnimation(anim);
      rebuild();
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }
}

function exportCSV(): void {
  const all = simulateAll(scheduleParams(), motion, (t) => meas.position(t), motion.duration);
  const cap = Math.min(all.length, 500000);
  let csv = 'strip,time_s,column,frame,u_train_m\n';
  for (let i = 0; i < cap; i++) {
    const f = all[i];
    csv += `${f.strip},${f.t.toFixed(4)},${f.col},${f.frame},${f.u.toFixed(3)}\n`;
  }
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'lighting-schedule.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------- 启动

bind();
rebuild();
requestAnimationFrame(frame);
