import type { SpeedKeyframe } from '../types';

/**
 * 列车运动学: 分段线性速度曲线 → 解析积分得到位置。
 * 位置在段内是二次函数(速度线性变化), 这里直接解析求值, 无累积误差。
 */
export class TrainMotion {
  private keys: SpeedKeyframe[];
  private cumPos: number[]; // 各关键点处的累计位置

  constructor(keys: SpeedKeyframe[]) {
    if (keys.length < 2) throw new Error('速度曲线至少需要两个关键点');
    this.keys = [...keys].sort((a, b) => a.t - b.t);
    this.cumPos = [0];
    for (let i = 1; i < this.keys.length; i++) {
      const a = this.keys[i - 1], b = this.keys[i];
      this.cumPos.push(this.cumPos[i - 1] + 0.5 * (a.v + b.v) * (b.t - a.t));
    }
  }

  get duration(): number {
    return this.keys[this.keys.length - 1].t;
  }

  speed(t: number): number {
    t = clamp(t, 0, this.duration);
    const i = this.segIndex(t);
    const a = this.keys[i], b = this.keys[i + 1];
    if (b.t === a.t) return b.v;
    return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
  }

  position(t: number): number {
    t = clamp(t, 0, this.duration);
    const i = this.segIndex(t);
    const a = this.keys[i], b = this.keys[i + 1];
    const T = b.t - a.t;
    if (T === 0) return this.cumPos[i + 1];
    const dt = t - a.t;
    const acc = (b.v - a.v) / T;
    return this.cumPos[i] + a.v * dt + 0.5 * acc * dt * dt;
  }

  private segIndex(t: number): number {
    let lo = 0, hi = this.keys.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.keys[mid].t <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
  }
}

/**
 * 测速系统: 输出带延迟和噪声的"测得车速", 并数值积分成"测得位置"。
 * 点亮时序模块只能看到这里的测得值, 看不到真实运动 —— 误差由此产生。
 * fixedSpeed 非空时模拟"系统假设匀速"的非自适应模式。
 */
export class MeasuredTrack {
  readonly dt: number;
  private pos: Float64Array;

  constructor(
    private motion: TrainMotion,
    private latency: number,
    private noiseAmp: number,
    private fixedSpeed: number | null,
    dt = 0.0005,
  ) {
    this.dt = dt;
    const n = Math.ceil(motion.duration / dt) + 2;
    this.pos = new Float64Array(n);
    let p = 0;
    for (let i = 0; i < n; i++) {
      this.pos[i] = p;
      p += this.measSpeed(i * dt) * dt;
    }
  }

  private measSpeed(t: number): number {
    if (this.fixedSpeed != null) return this.fixedSpeed;
    const tt = Math.max(0, t - this.latency);
    let v = this.motion.speed(tt);
    if (this.noiseAmp > 0) {
      // 平滑伪噪声(确定性, 便于测试复现)
      const n = Math.sin(t * 13.7) * 0.6 + Math.sin(t * 7.1 + 2.7) * 0.4;
      v *= 1 + this.noiseAmp * n;
    }
    return v;
  }

  position(t: number): number {
    const x = clamp(t, 0, this.pos.length * this.dt) / this.dt;
    const i0 = Math.min(Math.floor(x), this.pos.length - 2);
    const f = x - i0;
    return this.pos[i0] * (1 - f) + this.pos[i0 + 1] * f;
  }
}

function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}
