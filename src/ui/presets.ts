import type { SpeedKeyframe, StripConfig, ViewConfig } from '../types';

/** 灯条布置预设(数量按隧道约 900m 换算) */
export const STRIP_PRESETS: Record<string, { label: string; make: () => StripConfig }> = {
  standard: {
    label: '标准 · 间距1.0m · 64px · 1kHz',
    make: () => ({
      count: 900, spacing: 1.0, pixelsPerStrip: 64, pixelPitch: 0.025,
      refreshRate: 1000, duty: 0.8, bottomY: 0.7, startX: 10,
    }),
  },
  dense: {
    label: '密排高清 · 间距0.6m · 96px · 1.5kHz',
    make: () => ({
      count: 1500, spacing: 0.6, pixelsPerStrip: 96, pixelPitch: 0.018,
      refreshRate: 1500, duty: 0.8, bottomY: 0.65, startX: 10,
    }),
  },
  sparse: {
    label: '稀疏经济 · 间距2.0m · 48px · 800Hz',
    make: () => ({
      count: 450, spacing: 2.0, pixelsPerStrip: 48, pixelPitch: 0.035,
      refreshRate: 800, duty: 0.85, bottomY: 0.7, startX: 10,
    }),
  },
};

const KMH = 1 / 3.6;

function sineProfile(v0: number, amp: number, period: number, dur: number): SpeedKeyframe[] {
  const keys: SpeedKeyframe[] = [];
  for (let t = 0; t <= dur; t += 0.25)
    keys.push({ t, v: (v0 + amp * Math.sin((2 * Math.PI * t) / period)) * KMH });
  return keys;
}

function constProfile(kmh: number, dur: number): SpeedKeyframe[] {
  return [{ t: 0, v: kmh * KMH }, { t: dur, v: kmh * KMH }];
}

function rampProfile(kmh0: number, kmh1: number, rampT: number, dur: number): SpeedKeyframe[] {
  return [
    { t: 0, v: kmh0 * KMH },
    { t: rampT, v: kmh1 * KMH },
    { t: dur, v: kmh1 * KMH },
  ];
}

/** 列车运行预设(速度曲线) */
export const TRAIN_PRESETS: Record<string, { label: string; profile: SpeedKeyframe[] }> = {
  sine: { label: '变速 60–80 km/h(正弦, 周期15s)', profile: sineProfile(70, 10, 15, 40) },
  cruise: { label: '匀速 70 km/h', profile: constProfile(70, 40) },
  depart: { label: '出站加速 60→80 km/h', profile: rampProfile(60, 80, 12, 40) },
  arrive: { label: '进站减速 80→60 km/h', profile: rampProfile(80, 60, 12, 40) },
};

/** 乘客视角预设 */
export const VIEW_PRESETS: Record<string, { label: string; view: Partial<ViewConfig> }> = {
  sitWindow: {
    label: '坐着 · 靠窗',
    view: { eyeX: 0, eyeY: 1.25, eyeToWindow: 0.5 },
  },
  stand: {
    label: '站着 · 扶杆',
    view: { eyeX: -0.8, eyeY: 1.6, eyeToWindow: 0.9 },
  },
  opposite: {
    label: '坐着 · 对面座位',
    view: { eyeX: 0.2, eyeY: 1.25, eyeToWindow: 1.6 },
  },
  door: {
    label: '车门旁',
    view: { eyeX: -1.5, eyeY: 1.55, eyeToWindow: 0.4 },
  },
};
