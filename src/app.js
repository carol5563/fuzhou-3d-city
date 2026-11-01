import * as Cesium from "cesium";
import { initApp2 } from "./app-core.js";
import { createPerfPanel } from "./modules/ui.js";
import { createPerfLayer } from "./modules/perf.js";
import { PALETTE, applyCssVars, applyToScene, paletteTable } from "./modules/theme.js";
import { SITE } from "./modules/tileset.js";

/* =====================================================================================
 *  app3.js —— 第 4 周第 3 次课：性能检查 + 样式精调                    【填空版 = 你的作业】
 * =====================================================================================
 *
 *  这一课**不新加功能**，只做两件事：
 *
 *    ① 把"流畅"从感觉变成数字：fps / draw call / 顶点 / 瓦片，然后判断瓶颈在哪一类
 *    ② 把颜色从 4 个文件里收成 1 处：改一个 token，全站跟着变
 *
 *  ★ 开工前先读这三行，能省你半小时：
 *
 *    · 上次课的 `initApp2` 原样调用，**功能一个都不许重写**。你在它之上加一层。
 *    · 新模块两个，各 100 行上下，都要读：
 *         modules/perf.js    测量与诊断（不碰 DOM）
 *         modules/theme.js   色板唯一来源
 *      UI 那边多了一个 `createPerfPanel()`（在 modules/ui.js 末尾）。
 *
 *    · ⚠️ 计划里写着「低于 30fps 就查雾效和 maximumScreenSpaceError」——
 *      这句在**这份数据上不成立**。手搓的园区只有 1 个瓦片、0 个孩子节点，
 *      没有"更粗的一级"可以退，MSSE 改成 4 和 64 帧率一模一样。
 *      这一课要你做的是：**量出来、说清楚**，而不是照着计划假装调好了。
 *
 *  分档：
 *    ★必做★  TODO 1 监视读数 / TODO 2 分辨率旋钮 / TODO 3 诊断 / TODO 4 两个 MSSE / TODO 5 换主题
 *    【选做】 A requestRenderMode   B autoTune 自动找达标档位（答案版里有，可对照）
 *
 *  时间盒（2 小时）：读模块 30 分钟 → TODO 1-2 30 分钟 → TODO 3-4 30 分钟 → TODO 5 20 分钟 → 自测 10 分钟
 * ===================================================================================== */

/** 诊断/自检时统一回到这个机位，否则"每次转过的角度不同"会让帧率不可比 */
const PERF_VIEW = { north: -820, height: 430, pitch: -30 };

export function initApp(viewer) {
  /* ── 先把第 2 次课的全部功能跑起来（漫游/面板/点击闭环都在里面）────────────── */
  initApp2(viewer);

  /** app2 已经挂出来的模块集合。app3 只在它之上加，不重写 */
  const app = window.app;

  /* ── ① 色板 → CSS 变量 ────────────────────────────────────────────────────── */
  // DOM 是 app2 建的（#app-panel / #b-card 已经在页面上），所以这一步必须在 initApp2 之后。
  // 做完这一句，面板按钮、卡片标题条、边框、文字色全部跟着 PALETTE 走。
  // 这句我已经替你调好了 —— TODO 5 里你会反复用到它。
  applyCssVars();
  applyToScene(viewer.scene); // 场景侧：地球底色（Cesium 默认是一片纯深蓝 rgb(0,0,128)）

  const perf = createPerfLayer(viewer);
  const pbar = createPerfPanel(PALETTE);

  /** 监视开关的真值。界面文字从它派生，不许各存一份 */
  let monitorOn = false;

  /* ══════════════════════════════════════════════════════════════════════════════
   *  ★ TODO 1 —— 常驻监视：每 600ms 把读数刷进性能条
   * ══════════════════════════════════════════════════════════════════════════════
   *
   *  ① `perf.startMonitor(cb)` —— cb 每 600ms 收到：
   *         { fps, drawcall, 顶点, 分辨率, 地表瓦片 }
   *  ② 回调里**只做一件事**：`pbar.update(s, PALETTE)`
   *     ⚠️ 别在回调里再算东西、别 console.log 每一条 —— 600ms 一次，
   *        一分钟 100 条，你自己就不看了。
   *  ③ 停：`perf.stopMonitor()`；
   *     按钮文字用 `pbar.btn.toggle.value = monitorOn ? "停止监视" : "开始监视"` 切
   *
   *  ⚠️ 幂等：`startMonitor()` 内部第一行就是 `stopMonitor()`，所以**监视器**不会翻倍；
   *     但**界面文字**只有你自己在改 —— 连点两次必须也能回到正确文字。
   *     所以把"改文字"收进 `syncMonitorUI()`，谁改了 monitorOn 就调它一次。
   *
   *  ✅ 期望：性能条 fps 每 0.6 秒跳一次、颜色随帧率变（≥50 绿 / ≥30 橙 / <30 红）；
   *          连点「停止/开始」3 次后，`app3.state.监视中` 与按钮文字一致，读数仍在更新。
   */
  function syncMonitorUI() {
    pbar.btn.toggle.value = monitorOn ? "停止监视" : "开始监视";
  }

  function toggleMonitor() {
    if (monitorOn) {
      perf.stopMonitor();
      monitorOn = false;
      pbar.say("监视已停止");
    } else {
      perf.startMonitor((sample) => pbar.update(sample, PALETTE));
      monitorOn = true;
      pbar.say("监视中 —— 转动一下相机，看 fps 和 draw call 怎么变");
    }
    syncMonitorUI();
  }

  perf.startMonitor((s) => pbar.update(s, PALETTE));
  monitorOn = true;
  syncMonitorUI();

  /* ══════════════════════════════════════════════════════════════════════════════
   *  ★ TODO 2 —— 分辨率滑条：这一课**唯一真正有效**的旋钮
   * ══════════════════════════════════════════════════════════════════════════════
   *
   *  ① 监听 `input`（边拖边触发），不是 `change`（松手才触发）—— 要边拖边看数字变
   *  ② `perf.setResolution(值)` 返回 `{ scale, 内部, 显示 }`
   *  ③ `pbar.syncRes(scale)` 让滑条和读数对齐
   *     ⚠️ 别只改一边：界面上写 0.7、实际是 0.5，下次调参就全靠猜
   *
   *  💡 为什么它最有效：`resolutionScale = 0.5` 意味着内部画布只有一半边长，
   *     **像素数是 1/4**，最后拉伸到全屏。你这台机器没有硬件加速（Chrome 走软件渲染），
   *     瓶颈就是"要填的像素太多"，所以这个旋钮效果最猛。
   *
   *  ✅ 期望：0.5 → 约 22 fps；0.35 → 约 34 fps；1.0 → 约 8 fps
   */
  pbar.range.res.addEventListener("input", () => {
    const info = perf.setResolution(pbar.range.res.value);
    pbar.syncRes(info.scale); // 用返回值里的真值，不要用滑条自己读的数
    pbar.say(`分辨率 ${info.scale} —— 内部画布 ${info.内部}，拉伸显示到 ${info.显示}`);
  });

  /* ══════════════════════════════════════════════════════════════════════════════
   *  ★ TODO 3 —— 诊断按钮：把"为什么卡"变成一句话结论
   * ══════════════════════════════════════════════════════════════════════════════
   *
   *  `await perf.diagnose()` 大约 10 秒，返回：
   *      { 噪声, 基线fps, 基线drawcall, 像素提升百分比, 提交提升百分比, 结论, 依据, 建议 }
   *
   *  ① 点下去先 `pbar.btn.diagnose.disabled = true` + 报一句"诊断中…约 10 秒"
   *     ⚠️ 不这么做，用户会以为没反应，再点一次
   *  ② `try / finally` 里一定要把 disabled 放开 —— 中途抛错也别把按钮永久锁死
   *  ③ 结论打进行下方 `pbar.say(...)`；性能模块不碰 DOM，展示是这一层的活
   *
   *  💡 它凭什么能判断：先量一次噪声（同配置测两遍，看差多少算"没变"），
   *     然后**只拧一个旋钮**看帧率动没动 —— 只降分辨率 / 只隐藏建筑。
   *     像素砍一半就变快 → 像素瓶颈；少一半 draw call 就变快 → 提交瓶颈；都不动 → 别处的问题。
   *
   *  ✅ 期望：结论 =「像素填充瓶颈」，像素提升 ≈ +45%、提交提升 ≈ +2%（在噪声内）
   */
  pbar.btn.diagnose.addEventListener("click", async () => {
    pbar.btn.diagnose.disabled = true;
    pbar.say("诊断中… 约 11 秒（先量噪声，再分别拧「像素」和「提交」两个旋钮）");
    try {
      const r = await perf.diagnose();
      console.log("%c[诊断]", "color:#1a88ff;font-weight:600", r);
      pbar.say(`结论：${r.结论}\n依据：${r.依据}\n建议：${r.建议}`);
    } catch (err) {
      console.error(err);
      pbar.say("诊断失败：看控制台");
    } finally {
      pbar.btn.diagnose.disabled = false; // 放开必须写 false，写 true 就等于"诊断完按钮永久锁死"
    }
  });

  /* ══════════════════════════════════════════════════════════════════════════════
   *  ★ TODO 4 —— 两个 MSSE：接上，然后**如实说明它在这份数据上没有用**
   * ══════════════════════════════════════════════════════════════════════════════
   *
   *  建筑：`perf.setTilesetMSSE(值)` 返回 `{ ok, msse, 瓦片总数, 已就绪, 能细化 }`
   *  地表：`perf.setGlobeMSSE(值)` 返回 `{ msse }`
   *
   *  ⚠️ 这条是本课的"诚实检查"，别糊弄过去：
   *     计划里写「低于 30fps 就查 maximumScreenSpaceError」，但这套手搓数据
   *     只有 1 个瓦片 —— 照抄计划会白忙一场。面板上必须把 `能细化 = false` 这件事说出来。
   *
   *  ✅ 期望：建筑 MSSE 输 64 → 提示「只有 1 个瓦片、没有子节点，帧率不会变」；
   *          地表 MSSE 输 8 → 提示「地表瓦片更少更粗，地形会变糊」
   */
  pbar.num.msse.addEventListener("change", () => {
    const r = perf.setTilesetMSSE(pbar.num.msse.value);
    if (!r.ok) return pbar.say(r.reason);
    if (!r.能细化) {
      pbar.say(
        `建筑 MSSE = ${r.msse} —— ⚠️ 这份数据只有 ${r.瓦片总数} 个瓦片、没有子节点，` +
          `没有更粗的一级可退，帧率不会变。\n` +
          `MSSE 只在「多级 LOD」的数据上才是性能旋钮 —— 这里它只是改了个没人读的数字。`
      );
    } else {
      pbar.say(`建筑 MSSE = ${r.msse}（瓦片 ${r.瓦片总数}，能细化 → 帧率会真的变）`);
    }
  });

  pbar.num.gmsse.addEventListener("change", () => {
    // 地表这条要自己说：不能把上一句"建筑只有 1 个瓦片"留在 note 里当结论
    const r = perf.setGlobeMSSE(pbar.num.gmsse.value);
    pbar.say(
      `地表 MSSE = ${r.msse} —— 它调的是「地表瓦片画多粗」：数值调大 → 地表瓦片更少更省，` +
        `但地形会变糊、楼群贴地的缝隙更明显。\n` +
        `注意它管不到建筑：园区那 20 栋是另一个 tileset，帧率主要由像素填充决定。`
    );
  });

  /* ══════════════════════════════════════════════════════════════════════════════
   *  ★ TODO 5 —— 换主题：改一个 token，全站跟着变
   * ══════════════════════════════════════════════════════════════════════════════
   *
   *  按顺序做**四件**事，少一件就有地方不变：
   *      ① 改色板             `PALETTE[token] = value`
   *      ② 写回 CSS 变量      `applyCssVars()`              → 面板、卡片、按钮、边框
   *      ③ 场景基础色          `applyToScene(viewer.scene)`  → 地球底色、雾
   *      ④ 场景里的对象        `app.deviceLayer.styleByStatus()`      → 10 个设备点重新贴色
   *                            `app.buildingLayer.reapplyHighlight()` → 已高亮那栋重新上色
   *
   *  ⚠️ ② 和 ③ 缺一不可：CSS 变量只管 DOM；场景里的颜色是 `Cesium.Color`，走的是另一条路。
   *  ⚠️ 色板里没有的 token 要**报错返回**，不能静默 —— 静默就等于"改了没效果"。
   *
   *  💡 为什么"主色改了高亮也跟着变"：theme.js 里 `建筑高亮: null` + `FOLLOW` 表，
   *     表示它**派生自主色**。想让它独立就写成具体色值覆盖掉。
   *
   *  ✅ 期望：`app3.retheme("主色", "#ff6b35")` → 面板按钮、卡片标题条、
   *          **选中那栋楼**同时变橙；`app3.retheme("主色", "#1a88ff")` 变回来。
   */
  function retheme(token, value) {
    if (!(token in PALETTE))
      return { ok: false, reason: `色板里没有「${token}」，可用：${Object.keys(PALETTE).join(" / ")}` };
    PALETTE[token] = value;
    applyCssVars();
    applyToScene(viewer.scene);
    app.deviceLayer.styleByStatus();
    app.buildingLayer.reapplyHighlight();
    return { ok: true, token, value };
  }

  /* ══════════════════════════════════════════════════════════════════════════════
   *  【选做 A】requestRenderMode：静止时不重画
   * ══════════════════════════════════════════════════════════════════════════════
   *  开了它，只有"有变化"时才画。代价：Cesium 感知不到的动画（自己 setTimeout 改东西）
   *  会漏帧，必须手动 `scene.requestRender()`。
   */
  function toggleRequestRender(on) {
    viewer.scene.requestRenderMode = !!on;
    viewer.scene.requestRender();
    return viewer.scene.requestRenderMode;
  }

  /* ══════════════════════════════════════════════════════════════════════════════
   *  【选做 B】autoTune：从清晰往模糊扫，找到第一个 ≥ 目标帧率的档位
   * ══════════════════════════════════════════════════════════════════════════════
   *  真实项目里没人手搓这个，但思路要有：给一个目标帧率，让它自己找到最清晰的档位。
   *  注意每测一档都要把相机复位，否则"转过的角度不同"会让数据不可比。
   */
  function resetCam() {
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(
      Cesium.Cartesian3.fromDegrees(SITE.lng, SITE.lat, SITE.height || 0)
    );
    const pos = Cesium.Matrix4.multiplyByPoint(
      enu,
      new Cesium.Cartesian3(0, PERF_VIEW.north, PERF_VIEW.height),
      new Cesium.Cartesian3()
    );
    viewer.camera.setView({
      destination: pos,
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(PERF_VIEW.pitch), roll: 0 }
    });
  }

  async function autoTune(targetFps = 30, ladder = [1.0, 0.85, 0.7, 0.55, 0.45, 0.35, 0.25]) {
    const tried = [];
    const before = viewer.resolutionScale;
    for (const s of ladder) {
      perf.setResolution(s);
      resetCam(); // 每档都回同一机位，否则"转过的角度不同"让数据不可比
      const m = await perf.measure(1500, { rotate: true });
      tried.push({ 分辨率: s, fps: Number(m.fps.toFixed(1)) });
      if (m.fps >= targetFps) {
        pbar.syncRes(s);
        pbar.say(`autoTune：${s} 达标（${m.fps.toFixed(1)} fps ≥ ${targetFps}），已停在最清晰的那一档`);
        return { ok: true, 分辨率: s, fps: m.fps, tried };
      }
    }
    perf.setResolution(before); // 全都不达标就还原，别把人留在 0.25
    pbar.syncRes(before);
    return { ok: false, 分辨率: before, tried, reason: `扫到底 ${ladder[ladder.length - 1]} 都达不到 ${targetFps} fps` };
  }

  pbar.btn.toggle.addEventListener("click", toggleMonitor);

  /* ── 调试出口 ─────────────────────────────────────────────────────────────── */

  window.app3 = {
    perf,
    pbar,
    PALETTE,
    toggleMonitor,
    retheme,
    toggleRequestRender,
    autoTune,
    resetCam,
    paletteTable,
    measure: (ms = 2000, rotate = true) => perf.measure(ms, { rotate }),
    diagnose: () => perf.diagnose(),
    get state() {
      return {
        监视中: monitorOn,
        fps: perf.state.最近fps,
        drawcall: perf.state.最近drawcall,
        顶点: perf.state.最近顶点,
        分辨率: viewer.resolutionScale,
        drawcall计数已装: perf.计数已装
      };
    }
  };

  pbar.say("性能条已就绪 —— 拖分辨率看 fps，或点「诊断瓶颈」");
  console.log(
    "%c[app3] window.app3 可用：.diagnose() / .measure() / .retheme('主色','#ff6b35') / .state",
    "color:#1a88ff"
  );
}
