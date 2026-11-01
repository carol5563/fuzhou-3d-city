import * as Cesium from "cesium";

/* =====================================================================================
 *  modules/perf.js —— 性能这一层：量出来、判出来、调得动
 * =====================================================================================
 *
 *  职责边界：
 *    · 只回答「现在多少帧、瓶颈在哪一类」，**不决定要不要降画质**
 *    · 不碰 DOM、不 say()、不 import 业务模块
 *    · 所有方法用返回值表达结果
 *
 *  为什么要有它：计划里那句「DevTools Performance 录一段看帧率」只能录、不能比对。
 *  真正要回答的是三个问题，每个都得有数据：
 *      ① 现在多少帧？                        → measure()
 *      ② 掉帧是因为像素画太多 / 指令发太多 / 还是顶点太多？  → diagnose()
 *      ③ 拧哪个旋钮真的有用？                → setResolution / setTilesetMSSE / setGlobeMSSE
 * ===================================================================================== */

/**
 * 每个"旋钮"影响什么 —— 这张表是本课最该背下来的东西
 *
 *  | 旋钮                          | 影响            | 什么时候有用                     |
 *  |-------------------------------|-----------------|----------------------------------|
 *  | resolutionScale               | 像素数量（平方）| 软件渲染 / 高分屏 / 大屏 —— **最猛** |
 *  | tileset.maximumScreenSpaceError | 瓦片层级深度  | 只有**多级 LOD** 的数据才有用      |
 *  | globe.maximumScreenSpaceError | 地表瓦片层级    | 地形复杂、地表瓦片多的时候         |
 *  | scene.fog                     | 远景可见度      | 观感 + 少量剔除，默认就开着        |
 *  | requestRenderMode             | 静止时是否重画  | 静态展示页省电；动画会漏帧         |
 */

/**
 * WebGL 的绘制调用计数（Cesium 自己不统计，得包一层）。
 *
 * ⚠️ `calls` / `verts` 是**只增不减的累计总数，永远不要归零**。
 *    因为监视器和 measure() 会同时用这两个数 —— 谁归零谁就把对方的账抹了。
 *    正确做法：每个消费者开始时记下"当前值"，结束时用差值算自己那段。
 *    （第一版我就是让 measure 归零，结果和常驻监视器抢计数器，draw call 读出 1.3。）
 */
let drawHook = { installed: false, calls: 0, verts: 0 };

/**
 * 包住 gl 的 drawElements / drawArrays / drawElementsInstanced 来数 draw call。
 *
 * 为什么要包：`draw call` = CPU 每帧向 GPU 提交几次绘制指令，是判断"CPU 瓶颈"的关键指标，
 * 但 WebGL / Cesium 都**没有**现成的计数器。GL 上下文是普通 JS 对象，方法可以直接替换 ——
 * 这也是浏览器里最常用的土办法：不改库、不改渲染流程，只在最底层记一笔。
 *
 * ⚠️ 只能包一次（重复包会套娃，数字翻倍），用 drawHook.installed 守住。
 */
function installDrawHook(viewer) {
  if (drawHook.installed) return true;
  const gl = viewer.scene.context && viewer.scene.context._gl;
  if (!gl) return false;

  const wrap = (name) => {
    const orig = gl[name];
    if (typeof orig !== "function") return;
    gl[name] = function (...args) {
      drawHook.calls++;
      // drawElements(mode, count, ...) / drawArrays(mode, first, count) —— count 位置不同
      const count = name === "drawArrays" ? args[2] : args[1];
      drawHook.verts += count || 0;
      return orig.apply(gl, args);
    };
  };
  wrap("drawElements");
  wrap("drawArrays");
  wrap("drawElementsInstanced");

  drawHook.installed = true;
  return true;
}

export function createPerfLayer(viewer) {
  const scene = viewer.scene;
  const camera = viewer.camera;

  const state = {
    已装监视: false,
    采样次数: 0,
    最近fps: 0,
    最近drawcall: 0,
    最近顶点: 0,
    分辨率: viewer.resolutionScale,
  };

  /** 每帧回调的注销函数（stopMonitor 要能真停掉，不能只改标志位） */
  let offPost = null;
  let offPre = null;
  let monitorTimer = null;

  /* ------------------------------------------------------------------ 单次测量 */

  /**
   * 测一段时间的帧率。**必须用 postRender 计数**，不能用 rAF：
   * postRender 是"这一帧真的画完了"，rAF 只是"浏览器准备画下一帧"，
   * 在 Cesium 自己控制渲染节奏时两者数量不等。
   *
   * @param {number} ms 测多久（建议 ≥ 2000，越短噪声越大）
   * @param {{rotate?:boolean}} opts rotate=true 时每帧转一点，模拟"用户正在操作"
   * @returns {Promise<{fps:number, frames:number, ms:number, drawcall:number, 顶点:number, 地表瓦片:number}>}
   */
  function measure(ms = 2000, opts = {}) {
    installDrawHook(viewer);
    const rotate = !!opts.rotate;
    const t = viewer.scene.primitives.get(0);

    return new Promise((resolve) => {
      let frames = 0;
      let done = false;
      const t0 = performance.now();
      // 只记"我开始的这一刻的累计值"，不动全局计数器
      const c0 = drawHook.calls;
      const v0 = drawHook.verts;

      const offPreRotate = rotate ? scene.preRender.addEventListener(() => camera.rotateRight(0.0035)) : null;

      const finish = (timedOut) => {
        if (done) return;
        done = true;
        offPost();
        if (offPreRotate) offPreRotate();
        clearTimeout(guard);

        const dt = performance.now() - t0;
        const g = scene.globe._surface;
        const result = {
          frames,
          ms: +dt.toFixed(0),
          fps: frames > 0 ? +(frames / (dt / 1000)).toFixed(1) : 0,
          drawcall: frames > 0 ? +((drawHook.calls - c0) / frames).toFixed(1) : 0,
          顶点: frames > 0 ? Math.round((drawHook.verts - v0) / frames) : 0,
          地表瓦片: g && g._tilesToRender ? g._tilesToRender.length : -1,
          建筑瓦片: t && t._selectedTiles ? t._selectedTiles.length : -1,
          超时: !!timedOut,
        };
        if (!timedOut) {
          state.采样次数++;
          state.最近fps = result.fps;
          state.最近drawcall = result.drawcall;
          state.最近顶点 = result.顶点;
        }
        resolve(result);
      };

      const offPost = scene.postRender.addEventListener(() => {
        frames++;
        if (performance.now() - t0 >= ms) finish(false);
      });

      // ⚠️ 兜底：开了 requestRenderMode 且画面不动时，postRender 可能一帧都不来，
      //    measure 就会永远不 resolve（实测挂死）。所以必须有超时。
      const guard = setTimeout(() => finish(true), ms * 2 + 1500);
    });
  }

  /* ------------------------------------------------------------------ 常驻监视 */

  /**
   * 常驻监视：每 intervalMs 采样一次，把结果交给回调。
   * ⚠️ 幂等：连点 3 次只能有 1 个监视器（否则回调次数翻倍、DOM 被刷屏）。
   */
  function startMonitor(onSample, intervalMs = 600) {
    stopMonitor();
    installDrawHook(viewer);

    let frames = 0;
    let last = performance.now();
    let c0 = drawHook.calls; // 本段的起点（只记差值，不归零全局计数器）
    let v0 = drawHook.verts;

    offPost = scene.postRender.addEventListener(() => {
      frames++;
      const now = performance.now();
      if (now - last < intervalMs) return;

      const dt = (now - last) / 1000;
      const sample = {
        fps: +(frames / dt).toFixed(1),
        drawcall: +((drawHook.calls - c0) / frames).toFixed(1),
        顶点: Math.round((drawHook.verts - v0) / frames),
        分辨率: viewer.resolutionScale,
        地表瓦片: scene.globe._surface && scene.globe._surface._tilesToRender ? scene.globe._surface._tilesToRender.length : -1,
      };
      frames = 0;
      c0 = drawHook.calls;
      v0 = drawHook.verts;
      last = now;

      state.最近fps = sample.fps;
      state.最近drawcall = sample.drawcall;
      state.最近顶点 = sample.顶点;
      if (typeof onSample === "function") onSample(sample);
    });

    state.已装监视 = true;
    return true;
  }

  function stopMonitor() {
    if (offPost) {
      offPost();
      offPost = null;
    }
    if (offPre) {
      offPre();
      offPre = null;
    }
    if (monitorTimer) {
      clearInterval(monitorTimer);
      monitorTimer = null;
    }
    state.已装监视 = false;
    return true;
  }

  /* ------------------------------------------------------------------ 三个旋钮 */

  /**
   * 分辨率倍率。**这是像素数量旋钮**：0.5 意味着内部画布只有一半边长，
   * 像素数是 1/4，最后拉伸到全屏显示。
   */
  function setResolution(scale) {
    const v = Math.min(1, Math.max(0.2, Number(scale) || 1));
    viewer.resolutionScale = v;
    state.分辨率 = v;
    const c = scene.canvas;
    // ⚠️ canvas.width 要**下一帧**才被 Cesium 的 resize() 改掉，
    //    这里立刻读会拿到上一档的值（实测 0.35 时还显示 0.5 的 742×374）。
    //    所以内部尺寸按公式算，别去读 canvas。
    return {
      scale: v,
      内部: `${Math.round(c.clientWidth * v)}×${Math.round(c.clientHeight * v)}`,
      显示: `${c.clientWidth}×${c.clientHeight}`,
    };
  }

  /**
   * 建筑的屏幕空间误差。
   * ⚠️ 它只在**有多级 LOD** 的数据上有效：值大 → 更少的子瓦片被细化 → 少 draw call。
   *    单瓦片数据（本工程的园区）改它等于改了个没人读的数字，帧率一动不动。
   * @returns 当前值 + 瓦片总数（用来说明"有没有得细化"）
   */
  function setTilesetMSSE(value) {
    const t = viewer.scene.primitives.get(0);
    if (!t || t.maximumScreenSpaceError === undefined) return { ok: false, reason: "建筑还没加载" };
    t.maximumScreenSpaceError = Number(value);
    const s = t._statistics || {};
    return {
      ok: true,
      msse: t.maximumScreenSpaceError,
      瓦片总数: s.numberOfTilesTotal,
      已就绪: s.numberOfTilesWithContentReady,
      能细化: t.root ? t.root.children.length > 0 : false,
    };
  }

  /** 地表的屏幕空间误差（默认 2）。值大 → 地表瓦片更少更粗 */
  function setGlobeMSSE(value) {
    scene.globe.maximumScreenSpaceError = Number(value);
    return { msse: scene.globe.maximumScreenSpaceError };
  }

  /* ------------------------------------------------------------------ 诊断 */

  /**
   * 三步定位法：先量噪声，再分别拧"像素"和"提交"两个旋钮，看谁让帧率动。
   *
   *  ① 基线 + 噪声：同一配置测两次，差多少算"没变"
   *  ② 只降分辨率（像素数砍到 49%）→ 明显变快 ⇒ 像素填充瓶颈
   *  ③ 只隐藏建筑（少一半 draw call）→ 明显变快 ⇒ 提交/几何瓶颈
   *
   * 全都不动 ⇒ 瓶颈不在渲染本身（CPU 主线程 / 浏览器帧率上限）。
   *
   * @returns {Promise<object>} 结构化结论，直接可以打进面板/控制台
   */
  async function diagnose() {
    const before = { res: viewer.resolutionScale, globe: scene.globe.show };
    const out = {};

    const m1 = await measure(2200, { rotate: true });
    const m2 = await measure(2200, { rotate: true });
    const noise = +Math.abs(m1.fps - m2.fps).toFixed(1);
    out.噪声 = noise;
    out.基线fps = +((m1.fps + m2.fps) / 2).toFixed(1);
    out.基线drawcall = m1.drawcall;

    // ② 像素：分辨率 0.5 → 0.35（像素数 ×0.49）
    setResolution(0.35);
    const mPix = await measure(2200, { rotate: true });
    setResolution(before.res);
    out["分辨率0.35的fps"] = mPix.fps;
    out.像素提升百分比 = Math.round(((mPix.fps - out.基线fps) / out.基线fps) * 100);

    // ③ 提交：隐藏建筑（draw call 明显减少）
    const t = viewer.scene.primitives.get(0);
    if (t) t.show = false;
    const mHide = await measure(2200, { rotate: true });
    if (t) t.show = true;
    scene.globe.show = before.globe;
    out["隐藏建筑后fps"] = mHide.fps;
    out["隐藏后drawcall"] = mHide.drawcall;
    out.提交提升百分比 = Math.round(((mHide.fps - out.基线fps) / out.基线fps) * 100);

    // 结论
    if (out.像素提升百分比 > 20) {
      out.结论 = "像素填充瓶颈（GPU 画不过来的像素太多）";
      out.依据 = `分辨率 0.5→0.35 像素数砍一半，帧率 ${out.基线fps} → ${mPix.fps}（+${out.像素提升百分比}%）`;
      out.建议 = "降 resolutionScale 最有效；或缩小 canvas 尺寸。draw call 和顶点都不是主因";
    } else if (out.提交提升百分比 > Math.max(noise * 2, 5)) {
      out.结论 = "提交/几何瓶颈（每帧要发的指令或顶点太多）";
      out.依据 = `隐藏建筑后 draw call ${out.基线drawcall} → ${mHide.drawcall}，帧率 ${out.基线fps} → ${mHide.fps}`;
      out.建议 = "调 maximumScreenSpaceError（多级 LOD 才有用）、合并批次、减少同时可见的对象";
    } else {
      out.结论 = "不是渲染瓶颈（瓶颈在别处：主线程逻辑 / 浏览器帧率上限 / 垂直同步）";
      out.依据 = `像素砍一半只 +${out.像素提升百分比}%、隐藏建筑只 +${out.提交提升百分比}%，都没超过噪声 ${noise}`;
      out.建议 = "先看有没有每帧跑的重逻辑（postRender 里的 DOM 操作、频繁 new 对象）";
    }

    viewer.resolutionScale = before.res;
    return out;
  }

  return {
    state,
    measure,
    startMonitor,
    stopMonitor,
    setResolution,
    setTilesetMSSE,
    setGlobeMSSE,
    diagnose,
    get 计数已装() {
      return drawHook.installed;
    },
  };
}
