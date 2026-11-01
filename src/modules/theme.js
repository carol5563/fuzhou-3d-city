import * as Cesium from "cesium";

/* =====================================================================================
 *  modules/theme.js —— 全站配色，唯一真来源
 * =====================================================================================
 *
 *  为什么要有这个文件（第 4 周第 3 次课「样式精调」的核心）：
 *
 *    以前颜色散在三个地方，改一个另外两个不会动 ——
 *      index.html 的 :root       --primary: #1a88ff
 *      modules/tileset.js        HIGHLIGHT_COLOR = "#1a88ff"   ← 和上面"碰巧"一样
 *      modules/devices.js        offline: "#8d99a6"             ← 和 --text-sub 的 #8d9399 是两个不同的灰
 *      modules/card.js           一堆 #f7f9fc / #eef0f3 / #a5abb1 写死在样式串里
 *
 *    结果是：想"整体调成深色系"，得改 4 个文件、还要逐个肉眼看有没有漏。
 *    真项目里这叫 **design token**（设计令牌）—— 颜色只在一处定义，其他地方全部引用。
 *
 *  职责边界：
 *    · 这个文件只描述「什么颜色」，不描述「哪个元素用它」
 *    · 不 import 任何业务模块
 *    · 不碰 viewer（`color()` 只做类型转换，不往场景里加东西）
 * ===================================================================================== */

/**
 * 色板。**改配色只改这里**。
 *
 * 命名规则：业务语义 + 用途，别叫「蓝色2」这种没法维护的名字。
 * 值一律用 #RRGGBB，alpha 在用到的时候单独给（`color("高亮", 0.75)`）。
 */
export const PALETTE = {
  /* —— 品牌色：面板按钮、卡片标题条、选中高亮、超链接 —— */
  主色: "#1a88ff",
  主色浅: "#3194ff",
  主色淡背景: "#eef6ff", // 按钮 hover 底 / 列表 hover 底
  主色选中背景: "#e3f0ff", // 卡片里当前设备行
  主色选中边框: "#a9d3ff", // 当前设备行那一圈 1px 内阴影

  /* —— 场景里的建筑 —— */
  建筑基础: "#c9d1d9", // 灰白：不抢设备的颜色
  /**
   * 选中那栋楼的颜色。
   * `null` = **跟随主色**（改主色时一起变）—— 这是 design token 里的"派生关系"，
   * 比"两个地方各写一遍 #1a88ff"可靠：写两遍就一定会有一次忘改。
   * 想让它独立于主色，直接写成 "#ff0000" 就覆盖掉了。
   */
  建筑高亮: null,
  建筑高亮透明度: 0.75, // 留 25% 让楼体本身的明暗透出来

  /* —— 设备三色（语义色，别拿品牌色顶替）—— */
  设备正常: "#34c759", // 绿
  设备告警: "#ff9f0a", // 橙
  设备离线: "#8d99a6", // 灰

  /* —— 场景本身 —— */
  /**
   * 地球的底色。
   * Cesium 默认是 `Color.BLUE`（实测 rgb(0,0,128)，一片刺眼的深蓝）——
   * 底图瓦片还没加载出来的那几秒，你看到的就是这个颜色。
   * 它不是 bug，是 `globe.baseColor`；跟着主题走就顺眼了。
   */
  地球底色: "#dfe7ef",

  /* —— 性能指标的三档（帧率表用它，和设备的绿/橙/灰是同一套语义）—— */
  性能好: "#34c759", // ≥ 50 fps
  性能中: "#ff9f0a", // 30 ~ 50
  性能差: "#ff3b30", // < 30（计划里的验收线）

  /* —— 界面文字与背景 —— */
  文字主: "#46494d",
  文字次: "#5d6166",
  文字弱: "#8d9399",
  文字最弱: "#a5abb1",
  边框: "#e5e5e5",
  分隔线: "#eef0f3",
  面板底: "#ffffff",
  面板底浅: "#f7f9fc", // 按钮底 / 数据条底
  面板底更浅: "#f2f6fa", // say() 输出区
};

/**
 * 派生关系：值写 null 的 token 会去读这里指定的"父 token"。
 * 加一条就在这里加一行，`css()` 会自动解析。
 */
const FOLLOW = {
  建筑高亮: "主色",
};

/** PALETTE 里哪些 token 要同步成 CSS 变量（名字对齐 index.html 的 :root） */
const CSS_VARS = {
  主色: "--primary",
  主色浅: "--primary-hover",
  文字主: "--text-main",
  文字次: "--text-normal",
  文字弱: "--text-sub",
  边框: "--border",
  面板底: "--bg-card",
  主色淡背景: "--bg-hover",
  主色选中背景: "--bg-active",
  主色选中边框: "--primary-border",
  面板底浅: "--bg-soft",
  分隔线: "--line",
  文字最弱: "--text-faint",
};

/** 有没有装过（重复调用没有副作用，但重复写 DOM 没意义） */
let applied = false;

/**
 * 把色板写进 `:root` 的 CSS 变量。
 *
 * 面板和卡片的样式里写的都是 `var(--primary, #1a88ff)` ——
 * 所以只要在这里改一次变量，整页 DOM 的颜色就跟着变，**一行 CSS 都不用动**。
 */
export function applyCssVars() {
  const root = document.documentElement;
  for (const [token, varName] of Object.entries(CSS_VARS)) {
    if (PALETTE[token] == null) continue; // 派生 token（null）不直接写，避免写出 "null"
    root.style.setProperty(varName, PALETTE[token]);
  }
  applied = true;
  return CSS_VARS;
}

/** 取色值字符串。传错名字直接抛 —— 配色写错必须是响亮的错误，不能静默变黑 */
export function css(token) {
  let v = PALETTE[token];
  if (v == null) {
    const parent = FOLLOW[token];
    if (parent) v = PALETTE[parent];
  }
  if (v == null) throw new Error(`theme: 没有这个颜色 token「${token}」（也没在 FOLLOW 里登记父 token）`);
  return v;
}

/**
 * 取一个 Cesium.Color。
 * @param {keyof PALETTE} token 色板名
 * @param {number} [alpha] 不传就用色板里的（如果有 透明度 字段），否则 1
 */
export function color(token, alpha) {
  const a = alpha ?? (PALETTE[`${token}透明度`] ?? 1);
  return Cesium.Color.fromCssColorString(css(token)).withAlpha(a);
}

/**
 * 把"场景侧"的颜色应用到 scene 上。
 *
 * ⚠️ 这是和 `applyCssVars()` **并列的第二条路**：CSS 变量管不了 Cesium 里的东西。
 *    凡是 scene / tileset / entity 上的颜色，都得走这里（或者各自的模块方法）。
 */
export function applyToScene(scene) {
  if (!scene) return false;
  scene.globe.baseColor = color("地球底色");
  return true;
}

/** 给调试面板/README 用：把当前色板列成表 */
export function paletteTable() {
  return Object.keys(PALETTE)
    .filter((k) => typeof PALETTE[k] === "string" || PALETTE[k] === null)
    .map((k) => `${k.padEnd(8)} ${PALETTE[k] === null ? `（跟随 ${FOLLOW[k] || "?"}）= ${css(k)}` : PALETTE[k]}`);
}

export function isApplied() {
  return applied;
}
