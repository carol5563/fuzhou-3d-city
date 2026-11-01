import * as Cesium from "cesium";
import { PALETTE } from "./theme.js";

/* =====================================================================================
 *  modules/devices.js —— 设备（Entity）这一层的全部逻辑
 * =====================================================================================
 *
 *  从第 3 周第 3 次课搬过来的能力：
 *    load()           加载 GeoJSON → 干掉默认 pin → 挂 status/name 等属性
 *    styleByStatus()  按 status 三色
 *    addLabels()      名称 + 数值标签
 *    startTicker()    每 3 秒随机改一台设备的数值（幂等，起手先停）
 *    stopTicker()
 *
 *  第 4 周新增：
 *    list()           把 10 个 Entity 直接拿出来（数据自洽、过滤都靠它）
 *
 *  ⚠️ 同样的职责边界：这个文件不 say()、不碰 DOM。
 * ===================================================================================== */

/** 设备点位。同样用 BASE_URL 拼前缀 —— 写死根路径在部署后会 404（见 tileset.js 的说明） */
export const DEVICES_URL = `${import.meta.env.BASE_URL}devices/devices.geojson`;

/**
 * 三色。设备状态只有这三种，缺字段时按 normal 兜底。
 * 值来自 modules/theme.js —— 想统一改配色只改那一处。
 */
export const STATUS_COLOR = {
  // ⚠️ 写成 getter 而不是固定值：固定值在"模块加载那一刻"就拍下来了，
  //    之后改 theme.PALETTE 它不会跟着变（第 3 次课做「换主题」时踩的就是这个）。
  //    getter 每次读都现取 → 改色板立刻生效。
  get normal() {
    return PALETTE.设备正常;
  }, // 绿：正常
  get warn() {
    return PALETTE.设备告警;
  }, // 橙：告警
  get offline() {
    return PALETTE.设备离线;
  } // 灰：离线
};

const TICK_MS = 3000;

/**
 * 读 Entity 上的自定义属性。
 *
 * GeoJSON 加载出来的属性都包成了 Property 对象，必须 getValue(时间) 才是值。
 * 写成 `entity.properties.name` 拿到的是一个 ConstantProperty，不是字符串。
 */
export function propOf(entity, key) {
  const p = entity.properties && entity.properties[key];
  if (!p) return undefined;
  return p.getValue ? p.getValue(Cesium.JulianDate.now()) : p;
}

export function createDeviceLayer(viewer, options = {}) {
  const url = options.url || DEVICES_URL;

  let dataSource = null;
  let ticker = null;

  const state = { 已加载: false, 已配色: false, 有标签: false, 定时器在跑: false };

  /* ------------------------------------------------------------------ 加载 */

  async function load() {
    if (dataSource) return dataSource;

    // ⚠️ GeoJsonDataSource.load 默认给每个点建一个 billboard（蓝色图钉），
    //    下面 styleByStatus 里会把它干掉，否则图钉会盖住你自己设的 point。
    dataSource = await Cesium.GeoJsonDataSource.load(url, { clampToGround: false });
    viewer.dataSources.add(dataSource);

    state.已加载 = true;
    return dataSource;
  }

  function list() {
    return dataSource ? dataSource.entities.values : [];
  }

  /* ------------------------------------------------------------------ 三色 */

  function styleByStatus() {
    if (!dataSource) return false;

    for (const e of list()) {
      e.billboard = undefined; // 先干掉默认 pin

      const status = propOf(e, "status") || "normal";
      const css = STATUS_COLOR[status] || STATUS_COLOR.normal;

      e.point = {
        pixelSize: 11,
        color: Cesium.Color.fromCssColorString(css),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        // 设备在楼顶，俯视时会被前面的楼挡住 → 无穷大 = 永远画在最前面
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      };
    }

    state.已配色 = true;
    return countByStatus();
  }

  function countByStatus() {
    const list0 = list();
    const normal = list0.filter((e) => (propOf(e, "status") || "normal") === "normal").length;
    const warn = list0.filter((e) => propOf(e, "status") === "warn").length;
    const offline = list0.filter((e) => propOf(e, "status") === "offline").length;
    return { total: list0.length, normal, warn, offline };
  }

  /* ------------------------------------------------------------------ 标签 */

  function labelTextOf(entity) {
    const name = entity.name || propOf(entity, "name") || "未命名设备";
    const value = propOf(entity, "value");
    const unit = propOf(entity, "unit") || "";
    return `${name}\n${value}${unit}`;
  }

  function addLabels() {
    if (!dataSource) return false;

    for (const e of list()) {
      e.label = {
        text: labelTextOf(e),
        font: "13px Microsoft YaHei",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE, // 白字在浅色底图上必须描边
        pixelOffset: new Cesium.Cartesian2(0, -24), // 往上挪，别压在点上
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      };
    }

    state.有标签 = true;
    return true;
  }

  /* ------------------------------------------------------------------ 模拟数据 */

  /**
   * 每 3 秒随机挑一台设备改数值。
   * ★ 起手先 stopTicker()：这个按钮能点很多次，不先停就会建出 N 个 interval，
   *   而 ticker 变量只记得最后一个 → 卸载时清不干净（第 3 周实测 8 条空指针）。
   */
  function startTicker(onTick) {
    if (!dataSource) return false;
    stopTicker();

    const list0 = list();
    if (!list0.length) return false;

    ticker = setInterval(() => {
      const e = list0[Math.floor(Math.random() * list0.length)];

      const unit = propOf(e, "unit") || "";
      const old = Number(propOf(e, "value")) || 0;
      let next = old * (1 + (Math.random() * 0.1 - 0.05));
      if (unit === "%") next = Math.min(100, Math.max(0, next));
      next = Math.round(next * 10) / 10;

      // 写回属性必须包成 ConstantProperty（properties 里只接受 Property 对象）
      e.properties.value = new Cesium.ConstantProperty(next);

      // 数据变了标签不会自己变，得手动改
      if (e.label) e.label.text = labelTextOf(e);

      if (typeof onTick === "function") onTick(propOf(e, "id"), next, unit);
    }, TICK_MS);

    state.定时器在跑 = true;
    return true;
  }

  function stopTicker() {
    if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }
    state.定时器在跑 = false;
  }

  /* ------------------------------------------------------------------ 卸载 */

  function unload() {
    if (!dataSource) return false;
    stopTicker();
    // ⚠️ 第二个参数 destroy 默认是 false —— 不传 true，dataSource 只是"从列表里拿掉"，
    //    里面 10 个 Entity 的几何/纹理资源不会释放。传 true 才是真的销毁。
    //
    //    顺带记一条（10-27 查清）：卸载后 `scene.primitives.length` 会剩下 1 个
    //    PrimitiveCollection —— 那**不是泄漏**，是 Cesium 的 DataSourceDisplay 自己的
    //    容器（源码 DataSourceDisplay.js:80 `scene.primitives.add(this._primitives)`），
    //    第一次加载 DataSource 时建一次，之后一直复用，卸载 dataSource 不会带走它。
    viewer.dataSources.remove(dataSource, true);
    dataSource = null;
    state.已加载 = false;
    state.已配色 = false;
    state.有标签 = false;
    return true;
  }

  return {
    load,
    list,
    styleByStatus,
    countByStatus,
    addLabels,
    labelTextOf,
    startTicker,
    stopTicker,
    unload,
    state,
    get dataSource() {
      return dataSource;
    }
  };
}
