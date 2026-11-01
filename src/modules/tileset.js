import * as Cesium from "cesium";
import { PALETTE, css, color } from "./theme.js";

/* =====================================================================================
 *  modules/tileset.js —— 建筑（3D Tiles）这一层的全部逻辑
 * =====================================================================================
 *
 *  职责边界（很重要，第 4 周就是练这个）：
 *    这个文件只知道"屋檐下的建筑怎么画"，**不知道页面上有没有按钮、也不知道设备**。
 *    所以它从不调 say()、从不读 DOM —— 只 return true/false 或抛错，由 app.js 决定说什么。
 *
 *  对外能力（从第 3 周的第 1/2/4 次课搬过来的，代码一字未改逻辑）：
 *    load()         加载瓦片 + 默认灰白样式 + 飞到园区
 *    setVisible()   显隐（走 show，不是 remove）
 *    setOpacity()   整体透明度（走 style 的 color alpha）
 *    setExplode()   分层炸开（走 customShader 改 positionMC.y）
 *    resetExplode() 复原
 *    flyTo()        飞到园区视角
 *    unload()       卸载
 *    readBuildingIds()  读出 batch table 里所有建筑的 buildingId（第 4 周新增，数据自洽要用）
 * ===================================================================================== */

/**
 * 手搓的 b3dm 数据集。
 *
 * ⚠️ 必须用 `import.meta.env.BASE_URL` 拼前缀，**不能写死 "/buildings/..."**：
 *    dev 时 BASE_URL 是 "/"，线上 GitHub Pages 是 "/fuzhou-3d-city/"。
 *    写死根路径 → 本地一切正常、部署后 404，建筑一片不显示，而且控制台只报一句
 *    "Failed to fetch"，最容易漏。第 4 周第 4 次课部署时实测踩到。
 */
export const BUILDINGS_URL = `${import.meta.env.BASE_URL}buildings/tile.json`;

/** 场地：福州五一广场。所有模块共用这一个原点，别各写一份 */
export const SITE = { lng: 119.3022, lat: 26.0785, height: 0 };

/** 园区取景参数：相机在园区正南 820 m、高 430 m、俯角 -30° */
export const PARK_VIEW = { east: 0, north: -820, height: 430, heading: 0, pitch: -30 };

/**
 * 基础色 / 高亮色 —— 值都在 modules/theme.js 里。
 * 这里仍导出同名常量，是因为别的文件已经 `import { BASE_COLOR }` 了；
 * 但**取值的源头只有一处**，想改颜色去 theme.js 改。
 */
export const BASE_COLOR = PALETTE.建筑基础;

/**
 * 选中高亮色。乘在基础色上，所以别用太亮的纯色，否则看不出楼层轮廓。
 * ⚠️ 这是个**加载时的快照**：改 theme.PALETTE 之后它不会跟着变。
 *    运行时要拿实时值请用 `color("建筑高亮")`（highlight() 用的就是它）。
 */
export const HIGHLIGHT_COLOR = css("建筑高亮");

/** 炸开时"每多少米一组"：数据每 12 m 一块 → 36 正好 3 块一组，缝对得齐 */
const FLOOR_GROUP_H = 36;

export function createTilesetLayer(viewer) {
  const scene = viewer.scene;

  /** 当前瓦片集。null = 还没加载 */
  let tileset = null;
  /** 炸开着色器。记住它是为了"改参数不重建" */
  let explodeShader = null;
  /** 当前被高亮的那一栋（Cesium3DTileFeature）。null = 没有 */
  let highlighted = null;

  /** 给面板/调试看的实时状态。**只读** —— 由各方法自己写，别在外面改 */
  const state = { 已加载: false, 显示: true, 透明度: 1, 炸开: 0 };

  /* ------------------------------------------------------------------ 加载 */

  async function load() {
    if (tileset) return tileset;

    tileset = await Cesium.Cesium3DTileset.fromUrl(BUILDINGS_URL);
    scene.primitives.add(tileset);

    applyBaseStyle();
    flyTo();

    state.已加载 = true;
    state.显示 = true;
    return tileset;
  }

  function applyBaseStyle() {
    if (!tileset) return;
    tileset.style = new Cesium.Cesium3DTileStyle({ color: `color('${BASE_COLOR}')` });
  }

  /* ------------------------------------------------------------------ 相机 */

  function flyTo() {
    if (!tileset) return false;
    const origin = Cesium.Cartesian3.fromDegrees(SITE.lng, SITE.lat, SITE.height);
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
    const camWorld = Cesium.Matrix4.multiplyByPoint(
      enu,
      new Cesium.Cartesian3(PARK_VIEW.east, PARK_VIEW.north, PARK_VIEW.height),
      new Cesium.Cartesian3()
    );
    viewer.camera.setView({
      destination: camWorld,
      orientation: {
        heading: Cesium.Math.toRadians(PARK_VIEW.heading),
        pitch: Cesium.Math.toRadians(PARK_VIEW.pitch),
        roll: 0,
      },
    });
    return true;
  }

  /* ------------------------------------------------------------------ 显隐 */

  /**
   * 显隐：走 `tileset.show`。
   * 不用 scene.primitives.remove() —— 那样再打开要重新流式加载一遍。
   * @returns {boolean} false = 还没加载，调用方自己去提示
   */
  function setVisible(show) {
    if (!tileset) return false;
    tileset.show = show;
    state.显示 = show;
    return true;
  }

  /* ------------------------------------------------------------------ 透明度 */

  function setOpacity(alpha) {
    if (!tileset) return false;
    tileset.style = new Cesium.Cesium3DTileStyle({
      color: `color('${BASE_COLOR}', ${alpha})`,
    });
    state.透明度 = alpha;
    return true;
  }

  /* ------------------------------------------------------------------ 炸开 */

  /**
   * 分层炸开。
   * ⚠️ `Cesium3DTileStyle`（1.146）没有 translation/scale，位置只能在着色器里改。
   * ⚠️ gap === 0 时直接复原（既省 GPU，也让"拖回 0"和"点复原"效果一致）。
   */
  function setExplode(gap) {
    if (!tileset) return false;
    if (gap <= 0) {
      resetExplode();
      return true;
    }

    if (!explodeShader) {
      explodeShader = new Cesium.CustomShader({
        uniforms: {
          // 🧠 uniforms 里登记什么，Cesium 就自动生成对应的 `uniform` 声明
          u_gap: { type: Cesium.UniformType.FLOAT, value: gap },
        },
        vertexShaderText: `
          void vertexMain(VertexInput vsInput, inout czm_modelVertexOutput vsOutput) {
            float h = vsInput.attributes.positionMC.y;   // 顶点离地多高（米）
            float k = floor(h / ${FLOOR_GROUP_H.toFixed(1)});  // 第几段（0,1,2…）
            vsOutput.positionMC.y += u_gap * k;          // 越高的段抬得越多
          }
        `,
      });
      tileset.customShader = explodeShader;
    } else {
      // 建过一次就只改参数 —— 这就是 uniform 的意义：代码和参数分离
      explodeShader.uniforms.u_gap.value = gap;
    }

    state.炸开 = gap;
    return true;
  }

  function resetExplode() {
    if (!tileset) return false;
    tileset.customShader = undefined; // 实测：这么做 style 的配色还在，不会一起丢
    explodeShader = null;
    state.炸开 = 0;
    return true;
  }

  /* ------------------------------------------------------------------ 高亮 */

  /**
   * 高亮某一栋楼（第 2 次课新增）。
   *
   * 三条从第 3 周踩出来的规矩，全在这 6 行里：
   *   ① `feature.color` 是**乘数**不是"替换色"：`Color.WHITE` = 乘 1 = 不改色，
   *      所以"清高亮"就是把乘数设回白，楼自然回到 style 给的底色
   *   ② getter 复用内部 `_color` 对象，赋值前要 `clone()`，否则下次读出来是被你改过的
   *   ③ 同一栋重复高亮直接 return —— 第 3 周悬停时"每帧刷一遍"导致闪一下，
   *      就是少了这个提前返回
   *
   * @param {Cesium.Cesium3DTileFeature|null} feature 传 null = 清除高亮
   * @returns {boolean} false = 还没加载
   */
  function highlight(feature) {
    if (!tileset) return false;
    if (highlighted === feature) return true; // 同一栋，什么都不用做

    if (highlighted) highlighted.color = Cesium.Color.WHITE.clone(); // 上一栋还原
    highlighted = feature || null;
    if (highlighted) highlighted.color = color("建筑高亮"); // alpha 也来自 theme

    return true;
  }

  /**
   * 重新给"当前高亮的那栋"上一次色。
   * 用途：改了主题色之后，已经高亮的那栋还压在旧颜色上 —— 调这个让它跟上。
   * @returns {boolean} false = 当前没有高亮
   */
  function reapplyHighlight() {
    if (!highlighted) return false;
    highlighted.color = color("建筑高亮");
    return true;
  }

  /* ------------------------------------------------------------------ 读 batch table */

  /**
   * 读出瓦片里**每一栋楼**的 buildingId（B01…B20）。
   *
   * 为什么要轮询而不用事件：`initialTilesLoaded` 只响一次，你要是挂晚了就永远等不到；
   * 而 `tileset.root.content` 是瓦片流式加载完才有的。轮询最笨也最可靠。
   *
   * ⚠️ 实测（10-26）两个"看起来好了其实没好"的中间态，条件必须两个一起判：
   *      ① `root.content` 已经是 undefined → 内容还没解析
   *      ② `root.content.featuresLength === 0` → 内容对象有了，但 b3dm 的 batch table 还没建好
   *    只判 ① 会读到空数组（我第一次就是这么错，面板显示"已加载 0 栋"）。
   */
  async function readBuildingIds(timeoutMs = 20000) {
    if (!tileset) throw new Error("先 load() 再读 buildingId");

    const t0 = performance.now();
    const ready = () => tileset.root && tileset.root.content && tileset.root.content.featuresLength > 0;

    while (!ready()) {
      if (performance.now() - t0 > timeoutMs) {
        throw new Error("20 秒内瓦片内容没准备好 —— 相机是不是不在园区上空？");
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    const content = tileset.root.content; // b3dm 的内容对象 = 一张"行句柄表"
    const ids = [];
    for (let i = 0; i < content.featuresLength; i++) {
      ids.push(content.getFeature(i).getProperty("buildingId"));
    }
    return ids;
  }

  /* ------------------------------------------------------------------ 卸载 */

  function unload() {
    if (!tileset) return false;
    resetExplode();
    highlighted = null; // 瓦片都要扔了，别再攥着里面的 feature
    scene.primitives.remove(tileset);
    tileset = null;
    state.已加载 = false;
    state.显示 = true;
    state.透明度 = 1;
    return true;
  }

  return {
    load,
    flyTo,
    setVisible,
    setOpacity,
    setExplode,
    resetExplode,
    highlight,
    reapplyHighlight,
    readBuildingIds,
    unload,
    state,
    get tileset() {
      return tileset;
    },
  };
}
