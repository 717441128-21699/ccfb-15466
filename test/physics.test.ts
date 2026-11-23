import { describe, it, expect } from 'vitest';
import { TrainMotion, MeasuredTrack } from '../src/physics/train';
import { simulateAll, type ScheduleParams } from '../src/physics/schedule';
import { measureStretch } from '../src/physics/persistence';
import type { Flash, StripConfig } from '../src/types';

const KMH = 1 / 3.6;

/** 正弦速度曲线: 60–80 km/h, 周期 15s */
function sineProfile(dur = 40): { t: number; v: number }[] {
  const keys = [];
  for (let t = 0; t <= dur; t += 0.25)
    keys.push({ t, v: (70 + 10 * Math.sin((2 * Math.PI * t) / 15)) * KMH });
  return keys;
}

const STRIPS: StripConfig = {
  count: 900, spacing: 1.0, pixelsPerStrip: 64, pixelPitch: 0.025,
  refreshRate: 1000, duty: 0.8, bottomY: 0.7, startX: 10,
};

const COLS = 320;
const COL_W = 0.02;

function makeParams(): ScheduleParams {
  return {
    strips: STRIPS,
    cols: COLS,
    colWidth: COL_W,
    imgU0: -(COLS * COL_W) / 2,
    frameDuration: 1 / 12,
    frameCount: 12,
  };
}

/** 在若干 0.25s 滑动窗口上测拉伸, 返回最大绝对值 */
function maxStretch(flashes: Flash[], tFrom: number, tTo: number): number {
  let max = 0;
  for (let t0 = tFrom; t0 <= tTo; t0 += 0.5) {
    const win = flashes.filter((f) => f.t > t0 - 0.25 && f.t <= t0);
    const r = measureStretch(win, COL_W);
    expect(r.count).toBeGreaterThan(100); // 每个窗口都有足够样本
    max = Math.max(max, Math.abs(r.stretchPct));
  }
  return max;
}

describe('列车运动学', () => {
  it('匀速: 位置 = 速度 × 时间', () => {
    const m = new TrainMotion([{ t: 0, v: 10 }, { t: 10, v: 10 }]);
    expect(m.position(5)).toBeCloseTo(50, 6);
    expect(m.speed(3)).toBeCloseTo(10, 6);
  });

  it('匀加速: 位置 = ½·a·t²', () => {
    const m = new TrainMotion([{ t: 0, v: 0 }, { t: 10, v: 20 }]);
    expect(m.position(10)).toBeCloseTo(100, 6);
    expect(m.speed(5)).toBeCloseTo(10, 6);
  });
});

describe('验收指标 1: 60–80 km/h 变速下按测速自适应, 横向拉伸 ≤ 2%', () => {
  it('正弦变速全程拉伸不超标', () => {
    const motion = new TrainMotion(sineProfile());
    // 测速: 60ms 延迟 + 0.5% 噪声(典型车载测速水平)
    const meas = new MeasuredTrack(motion, 0.06, 0.005, null);
    const flashes = simulateAll(makeParams(), motion, (t) => meas.position(t), motion.duration);
    expect(flashes.length).toBeGreaterThan(10000);
    const max = maxStretch(flashes, 5, 35);
    expect(max).toBeLessThanOrEqual(2);
  });

  it('测速延迟较大(0.15s)时仍不超标', () => {
    const motion = new TrainMotion(sineProfile());
    const meas = new MeasuredTrack(motion, 0.15, 0.005, null);
    const flashes = simulateAll(makeParams(), motion, (t) => meas.position(t), motion.duration);
    expect(maxStretch(flashes, 5, 35)).toBeLessThanOrEqual(2);
  });
});

describe('模型健全性: 时序与车速对不上时画面确实变形', () => {
  it('假设 70 km/h 实际 60 km/h → 明显压窄(>8%)', () => {
    const motion = new TrainMotion([{ t: 0, v: 60 * KMH }, { t: 40, v: 60 * KMH }]);
    const meas = new MeasuredTrack(motion, 0, 0, 70 * KMH); // 固定假设 70
    const flashes = simulateAll(makeParams(), motion, (t) => meas.position(t), motion.duration);
    expect(maxStretch(flashes, 5, 35)).toBeGreaterThan(8);
  });

  it('假设 60 km/h 实际 80 km/h → 明显拉宽(>8%)', () => {
    const motion = new TrainMotion([{ t: 0, v: 80 * KMH }, { t: 40, v: 80 * KMH }]);
    const meas = new MeasuredTrack(motion, 0, 0, 60 * KMH);
    const flashes = simulateAll(makeParams(), motion, (t) => meas.position(t), motion.duration);
    expect(maxStretch(flashes, 5, 35)).toBeGreaterThan(8);
  });
});
