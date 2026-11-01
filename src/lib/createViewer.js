import * as Cesium from "cesium";
import { ION_TOKEN, TIANDITU_KEY } from "../config.js";

/** 判断某个 key 到底填了没有（占位符 / 空 都算没填） */
const filled = (v) => typeof v === "string" && v.length > 0 && !v.startsWith("在这里");

/**
 * 创建 Viewer —— 这是第 2 月已经会的东西，这里当成"脚手架"直接给你。
 *
 * 本次课（第 3 月第 2 周第 2 次课）你不用动这个文件，
 * 你的作业在 src/exercises/week2-day2-camera.js。
 */
export function createViewer(containerId) {
  if (filled(ION_TOKEN)) {
    Cesium.Ion.defaultAccessToken = ION_TOKEN;
  } else {
    console.warn("[config] 还没填 ION_TOKEN（本次相机课不影响；后面 3D Tiles 的课才必须）。见 src/config.js");
  }

  const viewer = new Cesium.Viewer(containerId, {
    // ⚠️ baseLayer: false —— 不要 Cesium 默认那层 ion 影像。
    // 原因：默认影像要 ion token，没配就会去请求并解码失败，
    //      控制台会刷 "The source image could not be decoded"，甚至 Rendering has stopped。
    // 底图我们在下面 setupBaseImagery 里自己加。
    baseLayer: false,

    // 第 2 月第 2 次课做过：关掉默认控件，界面干净
    timeline: false,
    animation: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
  });

  // 你这台机器没有硬件加速（Chrome 走软件渲染），降分辨率是保帧率的第一手段。
  // 折腾通了想看得更清楚，就把它改成 1.0。
  viewer.resolutionScale = 0.5;

  // 初始视角：直接停在福州上空 8000 米俯视。
  // （等价于练习文件里 ④ 复位用的 initialView —— 两处保持一致）
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(119.2965, 26.0745, 8000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-45),
      roll: 0,
    },
  });

  setupBaseImagery(viewer);
  startCameraHud(viewer);

  // index.html 里的 #panel 是【第 2 周第 2 次课】的静态面板（按钮 id 硬编码在 HTML 里）。
  // 从第 3 次课起，每课都在 JS 里自建面板 —— 那个旧面板会一直压在下面，
  // 把新面板一藏就露出来了（10-22 验收时发现）。
  // 所以这里统一默认隐藏；复习第 2 周第 2 次课时，那个 exercise 会自己把它显示回来。
  const legacyPanel = document.getElementById("panel");
  if (legacyPanel) legacyPanel.style.display = "none";

  return viewer;
}

/**
 * 底图 —— ⚠️ 严格说这是「第 2 周第 3 次课（影像图层）」的内容。
 * 这里我提前帮你接好，只为了本次课不至于对着黑地球练相机。
 * 到你上第 3 次课那天，请把这个函数关掉、自己从零重写一遍。
 */
function setupBaseImagery(viewer) {
  const layers = viewer.imageryLayers;
  layers.removeAll(); // baseLayer:false 时本来就是空的，这里只是保险

  if (filled(TIANDITU_KEY)) {
    // 天地图：影像底图 + 影像注记（两层叠加才有地名），EPSG:3857 那套（矩阵集 = w）
    const tdt = (layer) =>
      new Cesium.UrlTemplateImageryProvider({
        url:
          `https://t{s}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile` +
          `&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w` +
          `&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_KEY}`,
        subdomains: ["0", "1", "2", "3", "4", "5", "6", "7"],
        maximumLevel: 18,
      });

    layers.addImageryProvider(tdt("img")); // 影像底图
    layers.addImageryProvider(tdt("cia")); // 影像注记
    console.info("[basemap] 已加载天地图影像 + 注记");
    return;
  }

  // 兜底：没天地图 key 也不能是黑地球（ion token 只留给 3D Tiles 用，不拿来做底图）
  layers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      maximumLevel: 18,
    })
  );
  console.warn("[basemap] 没填天地图 key，临时退到 OSM 底图。见 src/config.js");
}

/**
 * 右上角相机读数：让你肉眼看出 flyTo（高度平滑变化）和 setView（高度瞬间跳变）的区别。
 * 顺手演示 Cartographic（经纬度+高度，弧度）→ 转成"度"。
 */
function startCameraHud(viewer) {
  const $h = (id) => document.getElementById(id);

  // ⚠️ 防御：HUD 的 DOM 是写在 index.html 里的。如果哪天换了个没有 #hud 的页面
  //    （比如临时调试页），这里直接 return —— 否则 postRender 每帧抛异常，
  //    Cesium 会判定 "Rendering has stopped" 整体停摆，很难查。
  //    作品工程（fuzhou-3d-city）的页面就是没有 HUD 的：静默跳过，别在控制台刷 warn。
  if (!$h("hud-height")) return;

  let last = 0;

  viewer.scene.postRender.addEventListener(() => {
    const now = performance.now();
    if (now - last < 150) return; // 别每帧都刷 DOM
    last = now;

    const c = viewer.camera.positionCartographic;
    $h("hud-height").textContent = Math.round(c.height).toLocaleString() + " m";
    $h("hud-lng").textContent = Cesium.Math.toDegrees(c.longitude).toFixed(5);
    $h("hud-lat").textContent = Cesium.Math.toDegrees(c.latitude).toFixed(5);
    $h("hud-pitch").textContent = Cesium.Math.toDegrees(viewer.camera.pitch).toFixed(1);
  });
}
