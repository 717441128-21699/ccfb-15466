import type { Flash } from '../types';

/** 视觉暂留权重: 指数衰减 */
export function persistenceWeight(age: number, tau: number): number {
  return age <= 0 ? 1 : Math.exp(-age / tau);
}

export interface StretchResult {
  stretchPct: number; // 段内横向拉伸 %, >0 拉宽, <0 压窄
  tearCols: number;   // 段间错位(列), 撕裂程度
  count: number;      // 参与统计的闪光数
  strips: number;     // 参与统计的灯条数
}

/**
 * 横向拉伸测量(按灯条分段拟合)。
 *
 * 单根灯条在余晖窗口内扫过一段画面: 它显示第 c 列的时刻由测得速度 ṽ 决定,
 * 而痕迹落在由真实速度 v 决定的列车系位置上, 因此段内 du/dc = (v/ṽ)·colWidth。
 * 测速偏快 → 画面压窄, 测速偏慢 → 拉宽, 加减速期间各段斜率不一 → 倾斜/撕裂。
 *
 * 对每根灯条的痕迹分别做最小二乘拟合 u = a + b·c:
 *  - 拉伸 = 加权平均 b 相对 colWidth 的偏差
 *  - 撕裂 = 各段截距 a 的离散度(理想情况下所有段的截距都等于 imgU0)
 */
export function measureStretch(flashes: Flash[], colWidth: number): StretchResult {
  interface Acc { sc: number; su: number; scc: number; scu: number; n: number }
  const byStrip = new Map<number, Acc>();
  for (const f of flashes) {
    let g = byStrip.get(f.strip);
    if (!g) {
      g = { sc: 0, su: 0, scc: 0, scu: 0, n: 0 };
      byStrip.set(f.strip, g);
    }
    g.sc += f.col;
    g.su += f.u;
    g.scc += f.col * f.col;
    g.scu += f.col * f.u;
    g.n++;
  }
  let wSum = 0, slopeSum = 0, bSum = 0, b2Sum = 0, strips = 0;
  for (const g of byStrip.values()) {
    if (g.n < 5) continue;
    const d = g.n * g.scc - g.sc * g.sc;
    if (d === 0) continue;
    const slope = (g.n * g.scu - g.sc * g.su) / d;
    const intercept = (g.su - slope * g.sc) / g.n;
    slopeSum += slope * g.n;
    bSum += intercept * g.n;
    b2Sum += intercept * intercept * g.n;
    wSum += g.n;
    strips++;
  }
  if (wSum === 0) return { stretchPct: 0, tearCols: 0, count: flashes.length, strips: 0 };
  const slope = slopeSum / wSum;
  const meanB = bSum / wSum;
  const stdB = Math.sqrt(Math.max(0, b2Sum / wSum - meanB * meanB));
  return {
    stretchPct: (slope / colWidth - 1) * 100,
    tearCols: stdB / colWidth,
    count: flashes.length,
    strips,
  };
}

/**
 * 画面覆盖率: 视野范围内应被点亮的列中, 当前余晖权重足够亮的比例。
 * 覆盖率低 → 画面出现暗缝/闪烁。
 */
export function measureCoverage(
  flashes: Flash[],
  now: number,
  tau: number,
  cols: number,
  imgU0: number,
  colWidth: number,
  viewX0: number,
  viewX1: number,
  threshold = 0.25,
): number {
  const weight = new Float64Array(cols);
  for (const f of flashes) {
    if (f.col < 0 || f.col >= cols) continue;
    weight[f.col] += persistenceWeight(now - f.t, tau);
  }
  let expected = 0, lit = 0;
  for (let c = 0; c < cols; c++) {
    const u = imgU0 + c * colWidth;
    if (u < viewX0 || u > viewX1) continue;
    expected++;
    if (weight[c] >= threshold) lit++;
  }
  return expected === 0 ? 1 : lit / expected;
}
