import * as Cesium from "cesium";
import { createPanel, hideLegacyPanels } from "./modules/ui.js";
import { createTilesetLayer, SITE } from "./modules/tileset.js";
import { createDeviceLayer, propOf, STATUS_COLOR } from "./modules/devices.js";
import { createTerrainLayer } from "./modules/terrain.js";
import { createPicker } from "./modules/picker.js";
import { createCameraLayer, ROAM_PATH } from "./modules/camera.js";
import { createCard } from "./modules/card.js";
import { audit, devicesOfBuilding } from "./data/building-devices.js";

/* =====================================================================================
 *  app2.js —— 第 4 周第 2 次课：功能串联                            
 * =====================================================================================
 *
 *  这一次课不写新算法，只干「把已经验证过的能力接到同一根线上」：
 *
 *      漫游（第 2 周） + 控制面板（第 1 次课） + 点击闭环（第 3 周第 5 次课）
 *
 *  新增 3 个模块（都读一遍，50 行一个）：
 *      modules/picker.js   屏幕点 → 命中了什么（只回答，不做事）
 *      modules/camera.js   漫游队列 + flyToPoint + cancelFlight
 *      modules/card.js     建筑详情卡（0 行 Cesium）
 *
 *  ★ 本课唯一的真冲突：
 *      **漫游进行中点击建筑，要能打断漫游** —— 否则你点中的楼会被相机迅速带走。
 *      两个动作缺一不可：`cancelFlight()` 刹当前这段 + `playing` 标志拦下一段。
 * ===================================================================================== */

export function initApp2(viewer) {
  hideLegacyPanels();

  const ui = createPanel();
  const buildingLayer = createTilesetLayer(viewer);
  const deviceLayer = createDeviceLayer(viewer);
  const terrainLayer = createTerrainLayer(viewer);
  const picker = createPicker(viewer);
  const cameraLayer = createCameraLayer(viewer, SITE);
  const card = createCard();

  const say = (t) => ui.say(t);
  let tickerOn = false;
  /** 当前选中的建筑（null = 没选）。卡片、高亮、功能清单都靠它对齐 */
  let current = null;

  /* ══════════════════════════════════════════════════════════════════════════════
   *  第一部分：第 1 次课已经写好的 5 段（这里已修正 3 处，见注释）
   * ══════════════════════════════════════════════════════════════════════════════ */

  async function loadBuildings() {
    if (buildingLayer.tileset) return say("已经加载过了");
    try {
      await buildingLayer.load();
      const ids = await buildingLayer.readBuildingIds();
      say(`园区已加载：${ids.length} 栋（${ids[0]} ~ ${ids[ids.length - 1]}）`);
    } catch (err) {
      console.error(err);
      say("加载失败：看控制台");
    }
  }

  ui.btn.loadBuildings.addEventListener("click", loadBuildings);

  ui.chk.show.addEventListener("change", () => {
    const want = ui.chk.show.checked;
    if (!buildingLayer.setVisible(want)) {
      ui.chk.show.checked = !want; // 没加载 → 复位，别让勾选框骗人
      say("先加载建筑");
    }
  });

  ui.range.opacity.addEventListener("input", () => {
    const a = Number(ui.range.opacity.value);
    ui.lab.opacity.textContent = a.toFixed(2);
    if (!buildingLayer.setOpacity(a)) say("先加载建筑");
  });

  ui.range.explode.addEventListener("input", () => {
    const g = Number(ui.range.explode.value);
    ui.lab.explode.textContent = `${g} m`;
    if (!buildingLayer.setExplode(g)) say("先加载建筑");
  });

  async function loadDevices() {
    await deviceLayer.load();
    const c = deviceLayer.styleByStatus();
    deviceLayer.addLabels();
    // ★ 修 1：countByStatus() 返回的键是 total（早期版本叫 总数，已统一成英文，别再换成中文键）
    say(`已加载 ${c.total} 台设备：${c.normal} 绿 / ${c.warn} 橙 / ${c.offline} 灰`);
  }

  ui.btn.loadDevices.addEventListener("click", loadDevices);

  ui.btn.styleDevices.addEventListener("click", () => {
    const c = deviceLayer.styleByStatus();
    if (!c) return say("先加载设备");
    deviceLayer.addLabels();
    say(`已按状态配色：${c.normal} 绿 / ${c.warn} 橙 / ${c.offline} 灰`);
  });

  function toggleTicker() {
    if (tickerOn) {
      deviceLayer.stopTicker();
      tickerOn = false;
      return say("模拟数据已停");
    }
    tickerOn = deviceLayer.startTicker((id, v, unit) => say(`${id} → ${v}${unit}`));
    say(tickerOn ? "模拟数据已启动" : "先加载设备");
  }

  ui.btn.toggleTicker.addEventListener("click", toggleTicker);

  async function runAudit() {
    // ★ 修 2：补上前置判断。不补的话 readBuildingIds() 会直接 throw（"先 load() 再读 buildingId"）
    if (!buildingLayer.tileset) return say("先加载建筑");
    if (!deviceLayer.dataSource) return say("先加载设备");

    const buildingIds = await buildingLayer.readBuildingIds();
    const report = audit(buildingIds, deviceLayer.list());

    console.table(report.stats);
    if (report.ok) {
      console.log("%c[体检] 数据自洽 ✓", "color:#34c759;font-weight:600");
    } else {
      console.warn("[体检] 查出 " + report.problems.length + " 条问题：");
      report.problems.forEach((p) => console.warn("  · " + p));
    }
    say(
      report.ok
        ? `数据自洽 ✓（${report.stats.建筑数} 栋 / ${report.stats.设备数} 台 / ${report.stats.空楼} 栋空楼）`
        : `体检：查出 ${report.problems.length} 条问题（看控制台）`
    );
    return report; // ★ 修 3：返回值要带出来，否则控制台 `await app.runAudit()` 永远是 undefined
  }

  ui.btn.audit.addEventListener("click", () => {
    runAudit().catch((err) => {
      console.error("[体检] 失败", err);
      say("体检失败：看控制台");
    });
  });

  async function toggleTerrain(on) {
    if (on) {
      try {
        await terrainLayer.enable();
      } catch (err) {
        console.error(err);
        ui.chk.terrain.checked = false; // ion 偶发超时 → 复位勾选框
        return say("地形接入失败：看控制台");
      }
      // ★ 修 4：开地形后必须贴地，否则 20 栋楼整片陷进地里
      if (!buildingLayer.tileset) return say("地形已接入（建筑还没加载，加载后会陷进地面）");
      const h = await terrainLayer.snapTileset(buildingLayer.tileset, SITE);
      return say(`地形已接入；园区地形高 ${h.toFixed(1)} m，建筑已抬高贴地`);
    }

    terrainLayer.disable();
    if (buildingLayer.tileset) buildingLayer.tileset.modelMatrix = Cesium.Matrix4.IDENTITY;
    say("地形已关闭（建筑回到椭球高 0）");
  }

  ui.chk.terrain.addEventListener("change", () => {
    toggleTerrain(ui.chk.terrain.checked).catch((err) => console.error(err));
  });

  /* ══════════════════════════════════════════════════════════════════════════════
   *  第二部分：第 2 次课——把点击闭环接上
   * ══════════════════════════════════════════════════════════════════════════════ */

  /** 清空选中态：高亮、卡片、current 三处一起复位（少一处就会"卡片关了楼还亮着"） */
  function clearSelection() {
    buildingLayer.highlight(null);
    card.hide();
    current = null;
  }

  /**
   * 选中一栋楼：高亮 + 建卡片。
   *
   * 注意这里**没有任何 Cesium 代码** —— 三个调用都是"我把结果交给你"，
   * 谁去画高亮、谁去拼 HTML 都在各自模块里。这就是第 1 次课说的分层。
   */
  function selectBuilding(hit) {
    const devices = devicesOfBuilding(deviceLayer.list(), hit.buildingId);

    buildingLayer.highlight(hit.feature);
    current = hit.buildingId;

    card.show({
      title: hit.name || hit.buildingId,
      subtitle:
        `<b>${hit.buildingId}</b> · ${hit.height} m · ${hit.category}` +
        ` · 设备 <b>${devices.length}</b> 台`,
      rows: devices.map((e) => ({
        id: propOf(e, "id"),
        name: propOf(e, "name"),
        value: propOf(e, "value"),
        unit: propOf(e, "unit"),
        color: STATUS_COLOR[propOf(e, "status") || "normal"],
      })),
      emptyText: "这栋楼上没有装设备",
    });

    say(`${hit.name}（${hit.buildingId}）· ${devices.length} 台设备`);
    return devices;
  }

  /** 点到一台设备：飞到它上空 */
  function flyToDevice(row) {
    const entity = deviceLayer.list().find((e) => propOf(e, "id") === row.id);
    if (!entity) return say("找不到这台设备");

    cameraLayer.stopRoam(); // 飞行前先停漫游，别两个动画抢相机
    syncRoamUI();

    const pos = entity.position.getValue(Cesium.JulianDate.now());
    cameraLayer.flyToPoint(pos, { pitch: -45, range: 220, duration: 1.4 });
    card.setActive(row.id);
    say(`飞到 ${row.name}（${row.id}）`);
  }

  card.onSelect(flyToDevice); // 只挂一次

  /**
   * ★ 左键点击的总入口 —— 本课的核心。
   *
   * 三路分支，顺序有讲究：
   *   ① 先 `stopRoam()`：不管点中什么，先把漫游刹住（返回 true 说明确实打断了一段）
   *   ② 点空白（pickAt 返回 null）：复原，并把"是不是打断漫游"体现在文案里
   *   ③ 点建筑：选中；点设备：只报名字（选做里可以做成"也能弹设备卡"）
   */
  function onLeftClick(movement) {
    const hit = picker.pickAt(movement.position);
    const interrupted = cameraLayer.stopRoam();
    syncRoamUI();

    if (!hit) {
      clearSelection();
      return say(interrupted ? "已打断漫游" : "点空白 —— 已复原");
    }

    if (hit.kind === "building") {
      selectBuilding(hit);
      if (interrupted) say(`${hit.name}（${hit.buildingId}）· 已打断漫游`);
      return;
    }

    if (hit.kind === "entity") {
      say(`这是设备：${hit.name}（点建筑看设备列表）`);
    }
  }

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction(onLeftClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  /* ── 漫游 ─────────────────────────────────────────────────────────────────── */

  /**
   * ★ 状态的唯一同步入口。
   *
   * 为什么必须有这个函数：漫游状态现在住在**三个地方** ——
   *   `cameraLayer.isRoaming`（真值）、按钮文字、面板进度文字。
   * 只要有一条路径忘了同步（比如"点击打断漫游"那条），
   * 就会出现"相机明明停了、按钮还写着停止漫游"—— 又是调试信息骗人。
   * 所以：**任何改变漫游状态的地方，改完立刻调它一次**。
   */
  function syncRoamUI() {
    const on = cameraLayer.isRoaming;
    ui.btn.roam.textContent = on ? "■ 停止漫游" : "▶ 开始漫游（4 个机位）";
    if (!on) ui.roamState.textContent = "—";
  }

  function toggleRoam() {
    if (cameraLayer.isRoaming) {
      cameraLayer.stopRoam();
      syncRoamUI();
      return say("漫游已停止");
    }

    const ok = cameraLayer.startRoam((i, total, p) => {
      ui.roamState.textContent = `${i + 1}/${total} ${p.name}`;
    });
    if (!ok) return;
    syncRoamUI();
    say("漫游中 —— 点任意建筑会打断");
  }

  ui.btn.roam.addEventListener("click", toggleRoam);

  /* ── 功能清单自检 ─────────────────────────────────────────────────────────── */

  /**
   * 计划里第 2 次课的验收是「逐条过功能清单」。这里把它变成一个能点出来的检查。
   *
   * ⚠️ 诚实说明：能自动判的只有"配置到位 / 状态对"，看不出"好不好看"。
   *    打勾 ≠ 肉眼验收通过。
   */
  function runChecklist() {
    const items = [];
    const add = (name, pass, detail) => items.push({ name, pass: !!pass, detail });
    const ts = buildingLayer.tileset;
    const center = ts && ts.boundingSphere ? ts.boundingSphere.center : null;
    const carto = center ? Cesium.Cartographic.fromCartesian(center) : null;
    const distToSite = carto
      ? Cesium.Cartesian3.distance(
          Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height),
          Cesium.Cartesian3.fromDegrees(SITE.lng, SITE.lat, carto.height)
        )
      : null;

    add("地形", true, terrainLayer.state.已开启 ? `已开启（${terrainLayer.state.服务商}）` : "椭球面（可随时切换）");
    add("模型定位", !!ts, ts ? `包围球中心离 SITE ${distToSite.toFixed(1)} m` : "建筑还没加载");
    add("点击高亮", current != null, current ? `当前高亮 ${current}` : "还没点过建筑");
    add("弹窗", card.isOpen, card.isOpen ? "卡片已打开" : "还没点过建筑");
    add(
      "设备标注",
      deviceLayer.list().length > 0 && deviceLayer.list().filter((e) => e.label).length === deviceLayer.list().length,
      `${deviceLayer.list().length} 台 / ${deviceLayer.list().filter((e) => e.label).length} 个带标签`
    );
    add(
      "场景面板",
      !!(ui.btn.loadBuildings && ui.range.opacity && ui.chk.terrain),
      "控件齐全"
    );
    add("漫游", ROAM_PATH.length > 0, `${ROAM_PATH.length} 个机位（动画要肉眼验）`);

    const okCount = items.filter((i) => i.pass).length;
    console.log("%c[功能清单]", "color:#1a88ff;font-weight:600");
    items.forEach((i) => console.log(`  ${i.pass ? "✓" : "✗"} ${i.name} —— ${i.detail}`));
    say(`功能清单 ${okCount}/${items.length} 项就绪${okCount === items.length ? " ✓" : ""}`);
    return { ok: okCount === items.length, items };
  }

  ui.btn.checklist.addEventListener("click", runChecklist);

  /* ══════════════════════════════════════════════════════════════════════════════
   *  收尾
   * ══════════════════════════════════════════════════════════════════════════════ */

  function unloadAll() {
    cameraLayer.stopRoam();
    syncRoamUI();
    clearSelection();
    card.hide();
    deviceLayer.unload();
    buildingLayer.unload();
    tickerOn = false;

    ui.range.explode.value = "0";
    ui.lab.explode.textContent = "0 m";
    ui.range.opacity.value = "1";
    ui.lab.opacity.textContent = "1.00";
    ui.chk.show.checked = true;
    say("已全部卸载");
  }

  ui.btn.unload.addEventListener("click", unloadAll);

  /* ── 调试出口 ─────────────────────────────────────────────────────────────── */

  window.app = {
    ui,
    buildingLayer,
    deviceLayer,
    terrainLayer,
    cameraLayer,
    picker,
    card,
    loadBuildings,
    loadDevices,
    toggleTicker,
    toggleRoam,
    runAudit,
    runChecklist,
    unloadAll,
    devicesOfBuilding: (bid) => devicesOfBuilding(deviceLayer.list(), bid),
    get state() {
      return {
        地形: terrainLayer.state,
        建筑: buildingLayer.state,
        设备: deviceLayer.state,
        相机: cameraLayer.state,
        选中: current,
        定时器在跑: tickerOn,
      };
    },
  };

  say("① 加载建筑 → ② 加载设备 → ③ 点一栋楼");
  console.log(
    "%c[app2] window.app 可用：.state / .runAudit() / .runChecklist() / .toggleRoam()",
    "color:#1a88ff"
  );
}
