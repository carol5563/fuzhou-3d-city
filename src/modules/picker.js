import * as Cesium from "cesium";

/* =====================================================================================
 *  modules/picker.js —— 「屏幕上这一点，是什么东西」
 * =====================================================================================
 *
 *  职责边界（第 2 次课的新模块，最容易写歪的就是它）：
 *    只负责**从屏幕坐标问出答案**，然后把答案原样交出去。
 *    · 不碰 DOM、不 say()、不做高亮、不知道设备在哪
 *    · 它不认识 tileset 变量 —— scene.pick 不关心场景里有几件东西
 *
 *  为什么单独拆出来：
 *    第 3 周第 1 次课那句 `scene.pick` 藏在 30 行的鼠标回调里，
 *    想换"点地面出坐标"就得改那个回调。抽出来之后，
 *    app.js 只需要判断返回值，pick 的细节（instanceof、取属性）全在这里。
 *
 *  返回值统一是 null 或一个对象：
 *    { kind: "building", feature, buildingId, name, height, category }
 *    { kind: "entity",   entity, name }
 * ===================================================================================== */

export function createPicker(viewer) {
  const scene = viewer.scene;

  /**
   * 问一句「这个屏幕位置点到了什么」。
   *
   * ⚠️ 三个从第 3 周带过来的事实，这里已经处理掉：
   *   · `scene.pick` 拿到 3D Tiles 时给的是 `Cesium3DTileFeature`（batch table 的一行），
   *     想再拿到"整片 tileset"得走 `picked.primitive`
   *   · 属性只能 `getProperty(key)` 读，`"buildingId" in picked` 是 false（不报错，就是 false）
   *   · `scene.pick` **不拾取地球本身** —— 点地面/天空返回 undefined，
   *     所以"点空白"在这里天然表现为 null，不用额外判断
   *
   * @param {Cesium.Cartesian2} screenPosition 屏幕像素坐标（事件里的 `movement.position`）
   * @returns {object|null}
   */
  function pickAt(screenPosition) {
    const picked = scene.pick(screenPosition);
    if (!picked) return null; // 点了天空 / 点了地面（scene.pick 不拾取地球）

    // ① 3D Tiles 的一行（建筑）
    if (picked instanceof Cesium.Cesium3DTileFeature) {
      const buildingId = picked.getProperty("buildingId");
      if (!buildingId) return null; // 不是我们这套数据，别硬认
      return {
        kind: "building",
        feature: picked, // 高亮要它（feature.color 是乘数）
        buildingId,
        name: picked.getProperty("name"),
        height: picked.getProperty("height"),
        category: picked.getProperty("category"),
      };
    }

    // ② Entity（设备点 / 第 3 周那些测量实体）
    //    Entity 被 pick 到时，`picked.id` 就是那个 Entity 本身
    if (picked.id && picked.id.position) {
      const e = picked.id;
      const nameProp = e.properties && e.properties.name;
      return {
        kind: "entity",
        entity: e,
        name: nameProp && nameProp.getValue ? nameProp.getValue(Cesium.JulianDate.now()) : e.id,
      };
    }

    return null;
  }

  return { pickAt };
}
