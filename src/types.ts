/** 全局配置类型定义 —— 四大模块:灯条布置 / 列车运行 / 乘客视角 / 点亮时序 */

/** 速度曲线关键点: t 秒, v 米/秒 */
export interface SpeedKeyframe {
  t: number;
  v: number;
}

/** 灯条布置 */
export interface StripConfig {
  count: number;          // 灯条数量
  spacing: number;        // 相邻灯条间距 (m)
  pixelsPerStrip: number; // 每根灯条竖直像素数
  pixelPitch: number;     // 像素竖直间距 (m)
  refreshRate: number;    // 每根灯条刷新率 (Hz)
  duty: number;           // 点亮占空比 0..1
  bottomY: number;        // 灯条底部高度 (m, 墙面坐标)
  startX: number;         // 第一根灯条的墙面位置 (m)
}

/** 列车运行 */
export interface TrainConfig {
  profile: SpeedKeyframe[]; // 速度曲线(分段线性)
  measLatency: number;      // 测速延迟 (s)
  measNoise: number;        // 测速噪声幅度(相对, 0..0.05)
  timingMode: 'adaptive' | 'fixed'; // 点亮时序: 按测速自适应 / 按固定假设速度
  fixedSpeed: number;       // fixed 模式下系统假设的车速 (m/s)
}

/** 乘客视角(列车参考系) */
export interface ViewConfig {
  eyeX: number;        // 眼睛纵向位置 (m, 列车系)
  eyeY: number;        // 眼睛高度 (m)
  eyeToWindow: number; // 眼睛到车窗平面距离 (m)
  wallDist: number;    // 车窗到隧道墙距离 (m)
  winX0: number;       // 车窗左缘 (m, 列车系)
  winX1: number;       // 车窗右缘
  winY0: number;       // 车窗下缘高度
  winY1: number;       // 车窗上缘高度
}

/** 仿真总配置 */
export interface SimConfig {
  strips: StripConfig;
  train: TrainConfig;
  view: ViewConfig;
  tau: number;           // 视觉暂留时间常数 (s)
  cols: number;          // 动画横向列数
  colWidth: number;      // 每列在墙面上占的宽度 (m)
  frameDuration: number; // 动画每帧时长 (s)
}

/** 一次点亮事件(闪光): 某根灯条在某时刻显示某一列 */
export interface Flash {
  t: number;      // 点亮时刻 (s)
  u: number;      // 点亮时灯条在列车参考系中的位置 (m) —— 用真实车速算出
  col: number;    // 显示的动画列号 —— 用测得车速算出(可能有误差)
  frame: number;  // 动画帧号
  strip: number;  // 灯条编号
}
