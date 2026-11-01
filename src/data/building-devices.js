import { propOf } from "../modules/devices.js";

/* =====================================================================================
 *  data/building-devices.js —— 建筑 ↔ 设备的"数据契约"
 * =====================================================================================
 *
 *  第 4 周第 1 次课的验收标准之一是「**数据自洽**」。什么叫自洽？就三句话：
 *
 *    ① 设备身上的 buildingId（B01…B20）必须真的能在建筑里找到 —— 否则点那栋楼永远列不出设备
 *    ② 设备 id（ENV-01…）不能重复 —— 否则列表里会出现两个一样的
 *    ③ 列表要用的字段（id/name/status/value/unit）一个都不能缺
 *
 *  这三条就是下面 audit() 要检查的东西。用真数据跑一遍，比在这张表上打勾靠谱。
 * ===================================================================================== */

/** 建筑编号：B01 … B20（跟 tools/make-buildings-tileset.mjs 的 batch table 一致） */
export const BUILDING_IDS = Array.from({ length: 20 }, (_, i) => `B${String(i + 1).padStart(2, "0")}`);

/** 设备列表要用的字段 —— 少一个，「点建筑列设备」那张表就会有空单元格 */
export const REQUIRED_FIELDS = ["id", "name", "status", "buildingId", "value", "unit"];

/* ══════════════════════════════════════════════════════════════════════════════════════
 *  ★ TODO A —— 按建筑过滤设备
 * ══════════════════════════════════════════════════════════════════════════════════════
 *
 *  输入：deviceEntities = deviceLayer.list()（10 个 Entity）
 *         buildingId    = 点中的楼，比如 "B09"
 *  输出：这栋楼上的设备实体数组（每台都是一个 Entity，可以直接读属性）
 *
 *  提示：
 *    · 读属性用 `propOf(entity, "buildingId")`（已经从 modules/devices.js 导进来了）
 *    · 用 `filter`，别用 `for` + `push`，一行就能写完
 *    · 边界：buildingId 传空 / 传不存在的值，应该返回空数组而不是抛错
 *
 *  自查（控制台）：
 *      app.devicesOfBuilding("B09").length   // → 1
 *      app.devicesOfBuilding("B02").length   // → 0（B02 上没装设备）
 */
export function devicesOfBuilding(entities, buildingId) {
  if (!entities || !buildingId) return [];
  return entities.filter((e) => propOf(e, "buildingId") === buildingId);
}

/* ══════════════════════════════════════════════════════════════════════════════════════
 *  ★ TODO B —— 数据自洽体检
 * ══════════════════════════════════════════════════════════════════════════════════════
 *
 *  输入：buildingIds    = 瓦片里真实的建筑编号数组（tilesetLayer.readBuildingIds() 给的）
 *         deviceEntities = deviceLayer.list()
 *
 *  输出：{ ok: true/false, problems: [字符串…], stats: { … } }
 *
 *  必须查出这四类问题（每类一条 problem 文案，把出问题的 id 写进去）：
 *    ① 设备指向的建筑不存在            → "设备 ENV-03 指向的 B21 不在建筑里"
 *    ② 设备 id 重复                    → "设备 id 重复：ENV-01"
 *    ③ 设备缺必填字段                  → "设备 ENV-05 缺字段：unit"
 *    ④ 建筑里有楼一台设备都没有（这条**不算错误**，只进 stats，用于核对覆盖率）
 *
 *  stats 建议放：{ 建筑数, 设备数, 有设备的楼, 空楼, 状态分布 }
 *
 *  自查（控制台）：先加载建筑 + 设备，再敲
 *      await app.runAudit()
 *    → 期望 `数据自洽 ✓（20 栋 / 10 台）`
 * ===================================================================================== */
export function audit(buildingIds, deviceEntities) {
  const problems = [];
  const ids = Array.isArray(buildingIds) ? buildingIds : [];
  const devices = Array.isArray(deviceEntities) ? deviceEntities : [];

  // ① 指向的建筑存不存在
  for (const e of devices) {
    const bid = propOf(e, "buildingId");
    if (!bid) {
      problems.push(`设备 ${propOf(e, "id") || "(无 id)"} 没有 buildingId`);
    } else if (!ids.includes(bid)) {
      problems.push(`设备 ${propOf(e, "id")} 指向的 ${bid} 不在建筑里`);
    }
  }

  // ② id 重复
  const seen = new Map();
  for (const e of devices) {
    const id = propOf(e, "id");
    seen.set(id, (seen.get(id) || 0) + 1);
  }
  for (const [id, n] of seen) {
    if (n > 1) problems.push(`设备 id 重复：${id}（出现 ${n} 次）`);
  }

  // ③ 缺必填字段
  for (const e of devices) {
    const miss = REQUIRED_FIELDS.filter((f) => propOf(e, f) === undefined);
    if (miss.length) problems.push(`设备 ${propOf(e, "id") || "(无 id)"} 缺字段：${miss.join("/")}`);
  }

  // ④ 覆盖率（不算错误）
  const usedBids = new Set(devices.map((e) => propOf(e, "buildingId")).filter(Boolean));
  const empty = ids.filter((b) => !usedBids.has(b));

  const statusDist = { normal: 0, warn: 0, offline: 0 };
  for (const e of devices) {
    const s = propOf(e, "status") || "normal";
    statusDist[s] = (statusDist[s] || 0) + 1;
  }

  return {
    ok: problems.length === 0,
    problems,
    stats: {
      建筑数: ids.length,
      设备数: devices.length,
      有设备的楼: usedBids.size,
      空楼: empty.length,
      状态分布: statusDist,
    },
  };
}
