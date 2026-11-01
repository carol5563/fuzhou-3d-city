import "cesium/Build/Cesium/Widgets/widgets.css";
import * as Cesium from "cesium";
import { createViewer } from "./lib/createViewer.js";
import { initApp } from "./app.js";

/* 建地球 → 装应用 */
const viewer = createViewer("cesiumContainer");
initApp(viewer);

/* 挂到 window：方便在控制台直接调 API（演示时很有用，面试官也会看） */
window.viewer = viewer;
window.Cesium = Cesium;
