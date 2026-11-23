import type { Flash, StripConfig } from '../types';
import type { TrainMotion } from './train';

/** 点亮时序参数 */
export interface ScheduleParams {
  strips: StripConfig;
  cols: number;       // 动画列数
  colWidth: number;   // 每列墙面宽度 (m)
  imgU0: number;      // 画面左缘在列车系中的位置 (m)
  frameDuration: number;
  frameCount: number;
}

/**
 * 点亮时序生成器(在线)。
 *
 * 原理: 画面固定在列车参考系中, 第 c 列应出现在列车系位置 imgU0 + c*colWidth。
 * 灯条 n 位于墙面 x_n, t 时刻它在列车系中的位置是 u = x_n - p(t)。
 * 系统只能根据*测得*位置 p̃(t) 反解: 当 x_n - p̃(t) = imgU0 + c*colWidth 时点亮第 c 列。
 * 测速有误差时, 点亮的列与真实列车系位置对不上 → 画面被拉宽/压窄/倾斜。
 *
 * 视网膜上留下的痕迹锚定在点亮瞬间的列车系位置(用真实 p(t) 计算)。
 */
export class FlashGenerator {
  private next: Float64Array; // 每根灯条下一次点亮时刻

  constructor(
    private p: ScheduleParams,
    private motion: TrainMotion,
    private measPos: (t: number) => number,
  ) {
    this.next = new Float64Array(p.strips.count);
  }

  reset(): void {
    this.next.fill(0);
  }

  /** 推进到时刻 t, 把期间产生的闪光追加到 out */
  advance(t: number, out: Flash[]): void {
    const p = this.p;
    const dt = 1 / p.strips.refreshRate;
    const cMax = p.cols - 0.5;
    for (let n = 0; n < p.strips.count; n++) {
      const x = p.strips.startX + n * p.strips.spacing;
      let tf = this.next[n];
      while (tf <= t) {
        // 系统视角: 此刻该灯条应对应哪一列(用测得位置)
        const c = (x - this.measPos(tf) - p.imgU0) / p.colWidth;
        if (c >= -0.5 && c <= cMax) {
          out.push({
            t: tf,
            u: x - this.motion.position(tf), // 真实列车系位置(视网膜锚点)
            col: Math.round(c),
            frame: Math.floor(tf / p.frameDuration) % p.frameCount,
            strip: n,
          });
        }
        tf += dt;
      }
      this.next[n] = tf;
    }
  }
}

/** 离线生成整段运行的点亮时序(用于导出 CSV / 单元测试) */
export function simulateAll(
  p: ScheduleParams,
  motion: TrainMotion,
  measPos: (t: number) => number,
  tMax: number,
  step = 0.005,
): Flash[] {
  const g = new FlashGenerator(p, motion, measPos);
  const out: Flash[] = [];
  for (let t = 0; t <= tMax; t += step) g.advance(t, out);
  return out;
}
