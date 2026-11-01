/* =====================================================================================
 *  modules/card.js —— 建筑详情卡（纯 DOM，0 行 Cesium）
 * =====================================================================================
 *
 *  职责边界：
 *    · 只知道"怎么把一张卡片画出来"，**不知道 3D 场景里发生了什么**
 *    · 不 import cesium、不 import 别的模块
 *    · 数据由外面塞进来（app.js 查完设备再传给它）
 *
 *  为什么要单独一个文件：
 *    第 3 周第 5 次课的闭环里，卡片 DOM 和 Cesium 代码搅在同一个函数里，
 *    想换个样式得翻 200 行找 innerHTML。拆开之后改样式只动这一个文件。
 *
 *  对外：
 *    show({ title, subtitle, rows, emptyText })   显示（可重复调用，会重建列表）
 *    hide()                                       收起
 *    onSelect(cb)                                 点某一行时回调 cb(row)
 *    setActive(id)                                高亮某一行（点了是谁的命令反馈）
 * ===================================================================================== */

const CSS = `
  #b-card {
    position: absolute; right: 16px; bottom: 16px; z-index: 12;
    width: 300px; max-height: 52vh; display: none; flex-direction: column;
    background: var(--bg-card, #fff); border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0,0,0,.22);
    color: var(--text-main, #46494d); font-size: 13px;
    font-family: -apple-system, "Microsoft YaHei", sans-serif;
    overflow: hidden;
  }
  #b-card.open { display: flex; }
  #b-card .hd {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px; border-bottom: 1px solid var(--line, #eef0f3);
  }
  #b-card .hd .t {
    flex: 1; font-size: 14px; font-weight: 600; line-height: 1.3;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  #b-card .hd .t::before {
    content: ""; display: inline-block; width: 3px; height: 13px;
    margin-right: 6px; vertical-align: -1px;
    background: var(--primary, #1a88ff); border-radius: 2px;
  }
  #b-card .hd .x {
    width: 22px; height: 22px; line-height: 1; padding: 0;
    border: none; border-radius: 4px; background: transparent;
    color: var(--text-sub, #8d9399); font-size: 16px; cursor: pointer;
  }
  #b-card .hd .x:hover { background: var(--bg-soft, #f7f9fc); color: var(--text-main, #46494d); }
  #b-card .sub {
    padding: 6px 12px 8px; color: var(--text-sub, #8d9399); font-size: 12px; line-height: 1.5;
  }
  #b-card .sub b { color: var(--primary, #1a88ff); font-weight: 600; }
  #b-card ul { list-style: none; margin: 0; padding: 0 8px 8px; overflow: auto; }
  #b-card li {
    display: flex; align-items: center; gap: 8px;
    padding: 7px 8px; margin-bottom: 4px; border-radius: 5px;
    background: var(--bg-soft, #f7f9fc); cursor: pointer; transition: background .12s;
  }
  #b-card li:hover { background: var(--bg-hover, #eef6ff); }
  #b-card li.active { background: var(--bg-active, #e3f0ff); box-shadow: inset 0 0 0 1px var(--primary-border, #a9d3ff); }
  #b-card li .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
  #b-card li .nm {
    flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--text-normal, #5d6166);
  }
  #b-card li .id { color: var(--text-faint, #a5abb1); font-size: 11px; font-family: monospace; }
  #b-card li .val { font-weight: 600; color: var(--text-main, #46494d); font-variant-numeric: tabular-nums; }
  #b-card .empty {
    padding: 14px 12px 18px; color: var(--text-faint, #a5abb1); font-size: 12px; text-align: center;
  }
  #b-card .ft {
    padding: 7px 12px; border-top: 1px solid var(--line, #eef0f3);
    color: var(--text-faint, #a5abb1); font-size: 11px;
  }
`;

let styleInjected = false;

function injectStyle() {
  if (styleInjected || document.getElementById("b-card-style")) return;
  const s = document.createElement("style");
  s.id = "b-card-style";
  s.textContent = CSS;
  document.head.appendChild(s);
  styleInjected = true;
}

export function createCard() {
  injectStyle();

  const el = document.createElement("div");
  el.id = "b-card";
  el.innerHTML = `
    <div class="hd">
      <span class="t"></span>
      <button class="x" title="关闭">×</button>
    </div>
    <div class="sub"></div>
    <ul></ul>
    <div class="empty" style="display:none"></div>
    <div class="ft">点设备行 → 相机飞过去</div>
  `;
  document.body.appendChild(el);

  const elTitle = el.querySelector(".hd .t");
  const elSub = el.querySelector(".sub");
  const elList = el.querySelector("ul");
  const elEmpty = el.querySelector(".empty");
  const elFt = el.querySelector(".ft");

  let selectCb = null;
  let rows = [];

  el.querySelector(".x").addEventListener("click", () => hide());

  // 事件委托：列表每次重建，但监听只挂一次（这就是"幂等"的省事写法）
  elList.addEventListener("click", (ev) => {
    const li = ev.target.closest("li");
    if (!li || !selectCb) return;
    const row = rows.find((r) => String(r.id) === li.dataset.id);
    if (row) selectCb(row);
  });

  function hide() {
    el.classList.remove("open");
  }

  /**
   * 显示卡片。
   * @param {{title:string, subtitle?:string, rows?:Array, emptyText?:string, footer?:string}} data
   */
  function show(data = {}) {
    elTitle.textContent = data.title || "—";
    elSub.innerHTML = data.subtitle || "";
    elFt.textContent = data.footer || "点设备行 → 相机飞过去";

    rows = Array.isArray(data.rows) ? data.rows : [];
    elList.innerHTML = "";
    rows.forEach((r) => {
      const li = document.createElement("li");
      li.dataset.id = r.id;

      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = r.color || "#8d99a6"  // 兜底：零状态;

      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = r.name || r.id;

      const id = document.createElement("span");
      id.className = "id";
      id.textContent = r.id;

      const val = document.createElement("span");
      val.className = "val";
      val.textContent = `${r.value ?? "—"}${r.unit ?? ""}`;

      li.append(dot, nm, id, val);
      elList.appendChild(li);
    });

    const isEmpty = rows.length === 0;
    elList.style.display = isEmpty ? "none" : "";
    elEmpty.style.display = isEmpty ? "" : "none";
    elEmpty.textContent = data.emptyText || "这里没有设备";

    el.classList.add("open");
  }

  /** 点行回调。传 null 取消。 */
  function onSelect(cb) {
    selectCb = cb;
  }

  /** 高亮某一行（相机飞过去之后给个"就是你"的反馈） */
  function setActive(id) {
    elList.querySelectorAll("li").forEach((li) => {
      li.classList.toggle("active", li.dataset.id === String(id));
    });
  }

  return { el, show, hide, onSelect, setActive, get isOpen() { return el.classList.contains("open"); } };
}
