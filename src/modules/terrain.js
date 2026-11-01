import * as Cesium from "cesium";
import { ION_TOKEN } from "../config.js";

/* =====================================================================================
 *  modules/terrain.js —— 地形这一层
 * =====================================================================================
 *
 *  为什么第 4 周才做地形：前 3 周所有数据都建在**椭球面高度 0** 上（平地假设）。
 *  一旦接上真实地形，这个假设立刻失效 —— 实测（10-26 真机，ion World Terrain）：
 *
 *      园区中心地形高   20.97 m
 *      西南角           24.16 m
 *      正北 200 m 处    41.11 m
 *
 *  也就是说：接上地形的瞬间，20 栋楼会**整片陷进地里 21~41 米**（楼底被吃掉）。
 *  这不是 bug，是"两套高度基准没对齐"。修法两个：
 *
 *    ① 简单粗暴：把整片 tileset 抬高到园区地形高（snapTileset()，本文件已实现）
 *       —— 只能对齐一个点，地形有起伏的地方仍然会差几米，城市级演示够用。
 *    ② 正规做法：建筑数据本身就带"底面高程"字段，逐栋贴合（要重新造数据）。
 *
 *  ⚠️ 还有一个坑：开了地形之后 `camera.pickEllipsoid()` 拿到的是**椭球面**，
 *     不是看得见的地面 —— 第 4 次课的测距/测面积要改用
 *     `scene.globe.pick(camera.getPickRay(pos), scene)`。本文件给了 pickGround()。
 * ===================================================================================== */

export function createTerrainLayer(viewer, options = {}) {
  const assetId = options.assetId ?? 1; // 1 = Cesium World Terrain

  /** 地形服务提供者。null = 还在用椭球（平地） */
  let provider = null;

  const state = { 已开启: false, 服务商: "椭球面（平地，height=0）", 园区地形高: null };

  /* ------------------------------------------------------------------ 开关 */

  async function enable() {
    if (!provider) {
      if (ION_TOKEN) Cesium.Ion.defaultAccessToken = ION_TOKEN;
      // 实测：从发起请求到可用约 5.7 s（第一次，之后有缓存）
      provider = await Cesium.CesiumTerrainProvider.fromIonAssetId(assetId);
    }
    viewer.terrainProvider = provider;
    state.已开启 = true;
    state.服务商 = "ion World Terrain（asset " + assetId + "）";
    return true;
  }

  function disable() {
    viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
    state.已开启 = false;
    state.服务商 = "椭球面（平地，height=0）";
    return true;
  }

  /* ------------------------------------------------------------------ 采高 */

  /** 取某个经纬度的地形高（米）。地形高度 ≠ 椭球高，这才是"地"的高度 */
  async function heightAt(lng, lat) {
    if (!provider) throw new Error("先 enable() 才能采地形高");
    const [carto] = await Cesium.sampleTerrainMostDetailed(provider, [
      Cesium.Cartographic.fromDegrees(lng, lat),
    ]);
    return carto.height;
  }

  /* ------------------------------------------------------------------ 贴地 */

  /**
   * 把整片 3D Tiles 抬到园区地形高，让它"站"在地面上。
   *
   * 原理：modelMatrix 是"赋值替换"不是叠加。砖块数据里的坐标是相对园区原点的，
   *      给一个"沿椭球法线向上 delta 米"的位移矩阵，整片就一起上去了。
   *      ⚠️ 必须沿**法线**，不能直接加 (0,0,delta) —— ECEF 里 z 不是"上"。
   */
  async function snapTileset(tileset, site) {
    if (!tileset) throw new Error("先加载建筑");
    const h = await heightAt(site.lng, site.lat);

    const origin = Cesium.Cartesian3.fromDegrees(site.lng, site.lat, 0);
    const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(origin);
    const offset = Cesium.Cartesian3.multiplyByScalar(up, h, new Cesium.Cartesian3());

    tileset.modelMatrix = Cesium.Matrix4.fromTranslation(offset);
    state.园区地形高 = h;
    return h;
  }

  /** 开了地形之后取地面点（替代 camera.pickEllipsoid） */
  function pickGround(position) {
    if (!state.已开启) {
      return viewer.camera.pickEllipsoid(position, Cesium.Ellipsoid.WGS84) || null;
    }
    return viewer.scene.globe.pick(viewer.camera.getPickRay(position), viewer.scene) || null;
  }

  return { enable, disable, heightAt, snapTileset, pickGround, state };
}
