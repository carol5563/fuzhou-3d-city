/* =====================================================================================
 *  modules/ui.js —— 界面这一层
 * =====================================================================================
 *
 *  职责边界：这里**只有 DOM**。它不知道 Cesium 是什么、不知道 towers 有几栋楼，
 *  只负责"把控件摆出来 + 把元素交出去"。谁想用就自己 addEventListener。
 *
 *  所以这个文件里一行 Cesium 都没有 —— 这就是"分层"最直观的好处：
 *  改配色不用碰三维代码，改三维不用碰 HTML。
 * ===================================================================================== */

const STYLE_ID = "app-panel-style";

export function createPanel() {
  injectStyle();

  const el = document.createElement("div");
  el.id = "app-panel";
  el.innerHTML = `
    <h1>福州园区 · 三维场景</h1>
    <p class="sub">20 栋建筑 · 10 台设备 · Cesium + 3D Tiles</p>
    <div class="now" id="app-now">—</div>

    <div class="sect">地形</div>
    <div class="row">
      <label><input type="checkbox" id="app-terrain" /> 接入真实地形（ion）</label>
    </div>

    <div class="sect">建筑 · 3D Tiles</div>
    <button id="app-load-buildings" class="btn">▶ 加载园区建筑</button>
    <div class="row">
      <label><input type="checkbox" id="app-show" checked /> 显示建筑</label>
    </div>
    <div class="row">
      <span>透明度</span>
      <input type="range" id="app-opacity" min="0" max="1" step="0.05" value="1" />
      <span id="app-opacity-label">1.00</span>
    </div>
    <div class="row">
      <span>炸开</span>
      <input type="range" id="app-explode" min="0" max="40" step="1" value="0" />
      <span id="app-explode-label">0 m</span>
    </div>

    <div class="sect">设备 · Entity</div>
    <button id="app-load-devices" class="btn">▣ 加载设备（10 台）</button>
    <button id="app-style-devices" class="btn">🎨 按状态配色 + 标签</button>
    <button id="app-toggle-ticker" class="btn">⏱ 模拟数据（开/关）</button>

    <div class="sect">交互 · 点击闭环</div>
    <button id="app-roam" class="btn">▶ 开始漫游（4 个机位）</button>
    <div class="row">
      <span>漫游进度</span>
      <span id="app-roam-state">—</span>
    </div>
    <button id="app-checklist" class="btn">✓ 功能清单自检</button>

    <div class="sect">数据</div>
    <button id="app-audit" class="btn">✓ 数据自洽检查（控制台看报告）</button>

    <div class="sect">收尾</div>
    <button id="app-unload" class="btn">■ 全部卸载</button>

    <div class="tip">
      20 栋建筑（自建 b3dm）· 10 台模拟设备<br />
      点楼出卡片 · 底部性能条可拖分辨率看帧率
    </div>
  `;
  document.body.appendChild(el);

  const $ = (s) => el.querySelector(s);

  return {
    el,
    say(text) {
      const box = $("#app-now");
      if (box) box.textContent = text;
    },
    btn: {
      loadBuildings: $("#app-load-buildings"),
      loadDevices: $("#app-load-devices"),
      styleDevices: $("#app-style-devices"),
      toggleTicker: $("#app-toggle-ticker"),
      roam: $("#app-roam"),
      checklist: $("#app-checklist"),
      audit: $("#app-audit"),
      unload: $("#app-unload"),
    },
    roamState: $("#app-roam-state"),
    chk: {
      terrain: $("#app-terrain"),
      show: $("#app-show"),
    },
    range: {
      opacity: $("#app-opacity"),
      explode: $("#app-explode"),
    },
    lab: {
      opacity: $("#app-opacity-label"),
      explode: $("#app-explode-label"),
    },
  };
}

/** 前面几课的面板都还挂在 body 上（各自 id），这里一次性收掉，免得叠一堆 */
export function hideLegacyPanels() {
  [
    "panel",
    "vis-panel",
    "shader-panel",
    "pick-panel",
    "pick-popup",
    "hl-panel",
    "dev-panel",
    "pnl-panel",
  ].forEach((id) => {
    const node = document.getElementById(id);
    if (node) node.style.display = "none";
  });
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #app-panel {
      position: absolute; top: 16px; left: 16px; z-index: 10;
      width: 300px; max-height: calc(100vh - 32px); overflow: auto;
      padding: 14px 16px;
      background: var(--bg-card, #fff); border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,.16);
      color: var(--text-main, #46494d); font-size: 13px;
      font-family: -apple-system, "Microsoft YaHei", sans-serif;
    }
    #app-panel h1 { margin: 0 0 2px; font-size: 15px; }
    #app-panel h1::before {
      content: ""; display: inline-block; width: 3px; height: 14px;
      margin-right: 6px; vertical-align: -2px;
      background: var(--primary, #1a88ff); border-radius: 2px;
    }
    #app-panel .sub { margin: 0 0 8px; color: var(--text-sub, #8d9399); font-size: 12px; }
    #app-panel .now {
      margin: 8px 0 10px; padding: 8px 10px; border-radius: 4px;
      background: var(--bg-soft, #f7f9fc); min-height: 18px; line-height: 1.5;
    }
    #app-panel .sect {
      margin: 10px 0 6px; padding-top: 8px; border-top: 1px dashed var(--border, #e5e5e5);
      color: var(--text-sub, #8d9399); font-size: 12px; letter-spacing: .3px;
    }
    #app-panel .btn {
      display: block; width: 100%; height: 32px; margin-bottom: 8px; padding: 0 10px;
      text-align: left; border: 1px solid var(--border, #e5e5e5); border-radius: 4px;
      background: var(--bg-soft, #f7f9fc); color: var(--text-normal, #5d6166);
      font-size: 13px; cursor: pointer;
    }
    #app-panel .btn:hover {
      border-color: var(--primary, #1a88ff); color: var(--primary, #1a88ff); background: var(--bg-hover, #eef6ff);
    }
    #app-panel .row {
      display: flex; align-items: center; gap: 8px; margin: 2px 0 8px;
      color: var(--text-sub, #8d9399); font-size: 12px;
    }
    #app-panel .row input[type="range"] { flex: 1; accent-color: var(--primary, #1a88ff); }
    #app-panel input[type="checkbox"] { accent-color: var(--primary, #1a88ff); }
    #app-panel .row label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    #app-panel .tip {
      margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border, #e5e5e5);
      color: var(--text-sub, #8d9399); font-size: 12px; line-height: 1.6;
    }
    #app-panel code { color: var(--primary, #1a88ff); font-size: 12px; }
  `;
  document.head.appendChild(style);
}

/* =====================================================================================
 *  性能条（第 4 周第 3 次课新增）
 * =====================================================================================
 *
 *  为什么单独一个面板、而不是塞进左边那个：左边是"功能面板"，天天要用；
 *  性能条是"体检工具"，演示的时候应该能藏起来。分开才不互相牵连。
 *
 *  放在底部居中：左边 300px 是功能面板、右下 300px 是详情卡，只有中间那条是空的。
 * ===================================================================================== */

const PERF_STYLE_ID = "perf-bar-style";

/** 帧率染色：阈值就是计划里的验收线（< 30 算不合格）。颜色全来自 theme */
function fpsColor(fps, P) {
  if (fps >= 50) return P.性能好;
  if (fps >= 30) return P.性能中;
  return P.性能差;
}

export function createPerfPanel(P) {
  if (!document.getElementById(PERF_STYLE_ID)) {
    const st = document.createElement("style");
    st.id = PERF_STYLE_ID;
    st.textContent = `
    #perf-bar {
      position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%);
      z-index: 11; width: 620px; max-width: calc(100vw - 660px);
      padding: 10px 14px; border-radius: 8px;
      background: var(--bg-card, #fff); box-shadow: 0 4px 16px rgba(0,0,0,.16);
      color: var(--text-main, #46494d); font-size: 12px;
    }
    #perf-bar .row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    #perf-bar .row + .row { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--line, #eef0f3); }
    #perf-bar .k { color: var(--text-sub, #8d9399); }
    #perf-bar b { font-variant-numeric: tabular-nums; font-size: 13px; }
    #perf-bar label { display: flex; align-items: center; gap: 6px; color: var(--text-sub, #8d9399); }
    /* ⚠️ 浏览器原生控件（range / checkbox / radio）的颜色不受 color / background 影响，
       它们有自己的 accent-color，默认是 Chrome 的蓝 —— 不显式设就永远是蓝的，
       换主题时会成为唯一一批"没跟上的元素"。 */
    #perf-bar input[type=range] { width: 110px; accent-color: var(--primary, #1a88ff); }
    #perf-bar input[type=checkbox] { accent-color: var(--primary, #1a88ff); }
    #perf-bar input[type=number] { width: 52px; padding: 2px 4px; border: 1px solid var(--border, #e5e5e5); border-radius: 3px; font-size: 12px; }
    #perf-bar input[type=button] {
      padding: 4px 10px; border: 1px solid var(--border, #e5e5e5); border-radius: 4px;
      background: var(--bg-soft, #f7f9fc); color: var(--text-normal, #5d6166); cursor: pointer; font-size: 12px;
    }
    #perf-bar input[type=button]:hover { border-color: var(--primary, #1a88ff); color: var(--primary, #1a88ff); background: var(--bg-hover, #eef6ff); }
    #perf-bar input[type=button]:disabled { opacity: .55; cursor: default; }
    #perf-bar .note {
      margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--line, #eef0f3);
      color: var(--text-faint, #a5abb1); font-size: 11px; line-height: 1.6; min-height: 16px;
      white-space: pre-line;
    }`;
    document.head.appendChild(st);
  }

  const el = document.createElement("div");
  el.id = "perf-bar";
  el.innerHTML = `
    <div class="row">
      <span class="k">fps</span><b id="perf-fps" style="color:${P.文字弱}">—</b>
      <span class="k">draw call / 帧</span><b id="perf-dc">—</b>
      <span class="k">顶点 / 帧</span><b id="perf-vtx">—</b>
      <span class="k">地表瓦片</span><b id="perf-tiles">—</b>
      <span class="k">分辨率</span><b id="perf-res">—</b>
    </div>
    <div class="row">
      <label>分辨率
        <input id="perf-res-range" type="range" min="0.2" max="1" step="0.05" value="0.5">
      </label>
      <label>建筑 MSSE <input id="perf-msse" type="number" min="1" max="128" step="1" value="16"></label>
      <label>地表 MSSE <input id="perf-gmsse" type="number" min="1" max="16" step="1" value="2"></label>
      <input id="perf-diagnose" type="button" value="诊断瓶颈">
      <input id="perf-toggle" type="button" value="停止监视">
    </div>
    <div class="note" id="perf-note">监视中 —— 转动一下相机，看 fps 和 draw call 怎么变</div>`;
  document.body.appendChild(el);

  const $ = (id) => document.getElementById(id);

  return {
    el,
    fps: $("perf-fps"),
    dc: $("perf-dc"),
    vtx: $("perf-vtx"),
    tiles: $("perf-tiles"),
    res: $("perf-res"),
    note: $("perf-note"),
    range: { res: $("perf-res-range") },
    num: { msse: $("perf-msse"), gmsse: $("perf-gmsse") },
    btn: { diagnose: $("perf-diagnose"), toggle: $("perf-toggle") },

    /** 刷一次读数（perf 模块每 600ms 调一次，别每帧调 —— 那是拿 DOM 当画板） */
    update(s, palette) {
      this.fps.textContent = s.fps.toFixed(1);
      this.fps.style.color = fpsColor(s.fps, palette);
      this.dc.textContent = s.drawcall;
      this.vtx.textContent = s.顶点.toLocaleString();
      this.tiles.textContent = s.地表瓦片;
      this.res.textContent = s.分辨率;
    },
    /** 让滑条的值跟实际分辨率对齐（别让"界面显示"和"真值"分叉） */
    syncRes(scale) {
      this.range.res.value = String(scale);
      this.res.textContent = String(scale);
    },
    say(text, color) {
      this.note.textContent = text;
      if (color) this.note.style.color = color;
    },
  };
}
