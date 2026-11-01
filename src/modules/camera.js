import * as Cesium from "cesium";

/* =====================================================================================
 *  modules/camera.js —— 相机这一层：漫游 + 飞到某个点
 * =====================================================================================
 *
 *  职责边界：
 *    · 知道"怎么飞"，**不知道飞过去看什么**（业务含义留在 app.js）
 *    · 不碰 DOM、不 say()
 *    · 不 import 任何别的模块
 *
 *  对外：
 *    flyToPoint(cartesian, opts)  飞到某个三维点（设备就是靠它）
 *    startRoam(onStep)            开始自动漫游（4 个机位绕园区一圈，循环）
 *    stopRoam()                   停止漫游（并立刻刹住当前这段飞行）
 *    state                        给面板看的只读状态
 *
 *  ── 第 2 次课的核心冲突：漫游进行中点击建筑，必须能打断 ──────────────────
 *
 *  两个动作缺一不可：
 *    ① `camera.cancelFlight()`  —— 刹住**当前这一段**飞行
 *    ② `playing = false`        —— 拦住**已经排进队列的下一段**
 *
 *  为什么两者都要（10-27 真机实测）：
 *    · `cancelFlight()` 之后相机立刻停住（1.8 秒内位移 0.000 m），
 *      并且 **不会触发** `complete` 回调（真实飞行被打断时 complete 计 0 次）
 *    · 但 `complete` 的临界点很难卡准：点击可能正好落在"这一段刚飞完、
 *      下一段已经发起"的那一帧。这时 cancel 刹的是新的那段，
 *      而 `playing` 守卫能让"下一个点"根本不发起
 *    · 边界实测：如果 `duration` 期间目标≈当前位置（零距离飞行），
 *      flyTo 会**瞬间完成**、complete 立刻计 1 次 —— 所以别用 complete 次数
 *      去判断"飞行有没有真的发生"
 * ===================================================================================== */

/** 4 个漫游机位：绕园区顺时针一圈（east / north 是相对园区原点的米数） */
export const ROAM_PATH = [
  { name: "南侧平视", east: 0, north: -820, height: 430, heading: 0, pitch: -30 },
  { name: "东侧高位", east: 820, north: 0, height: 520, heading: -90, pitch: -35 },
  { name: "北侧俯瞰", east: 0, north: 820, height: 430, heading: 180, pitch: -32 },
  { name: "西侧高位", east: -820, north: 0, height: 520, heading: 90, pitch: -35 },
];

export function createCameraLayer(viewer, site) {
  const camera = viewer.camera;

  /** 园区原点的 ENU 矩阵：把「东 N 米 / 北 N 米 / 高 N 米」换成世界坐标 */
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromDegrees(site.lng, site.lat, site.height || 0)
  );

  let playing = false;
  let stepIndex = 0;
  let onStep = null;

  const state = { 漫游中: false, 第几个: 0, 总共: ROAM_PATH.length, 当前机位: "—" };

  /** 把"东/北/高 + 朝向"换算成 flyTo 要的 destination */
  function toWorld(p) {
    return Cesium.Matrix4.multiplyByPoint(
      enu,
      new Cesium.Cartesian3(p.east, p.north, p.height),
      new Cesium.Cartesian3()
    );
  }

  /* ------------------------------------------------------------------ 飞到一个点 */

  /**
   * 飞到一个三维点并斜着俯视它（设备行点击用的就是它）。
   *
   * 为什么用 `flyToBoundingSphere` 而不是 `flyTo`：
   *   手上已经有一个现成的 Cartesian3（`entity.position.getValue()` 给的），
   *   用它包一个半径 1 米的球当目标，就不用自己反算经纬度和高度
   *   —— 也就不用纠结"这个高度是按椭球算还是按地形算"。
   *
   * @param {Cesium.Cartesian3} target
   * @param {{pitch?:number, range?:number, heading?:number, duration?:number}} opts
   * @returns {boolean} false = 给的坐标是空的
   */
  function flyToPoint(target, opts = {}) {
    if (!target || !Cesium.defined(target)) return false;
    camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 1), {
      offset: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(opts.heading ?? 0),
        Cesium.Math.toRadians(opts.pitch ?? -40),
        opts.range ?? 220 // 注意：这是"相机到目标的距离"，不是高度
      ),
      duration: opts.duration ?? 1.2,
    });
    return true;
  }

  /* ------------------------------------------------------------------ 漫游 */

  function next() {
    if (!playing) return; // ★ 守卫：队列里残留的下一段在这里被拦住

    const p = ROAM_PATH[stepIndex];
    state.第几个 = stepIndex + 1;
    state.当前机位 = p.name;
    if (onStep) onStep(stepIndex, ROAM_PATH.length, p);

    camera.flyTo({
      destination: toWorld(p),
      orientation: {
        heading: Cesium.Math.toRadians(p.heading),
        pitch: Cesium.Math.toRadians(p.pitch),
        roll: 0,
      },
      duration: 2.4,
      complete: () => {
        if (!playing) return; // ★ 停在哪一段都算停
        stepIndex = (stepIndex + 1) % ROAM_PATH.length;
        next();
      },
    });
  }

  /**
   * 开始漫游。已经在漫游时返回 false（幂等）。
   * @param {(i:number,total:number,p:object)=>void} [onStep] 每次换机位通知一次（面板显示用）
   */
  function startRoam(onStepCb) {
    if (playing) return false;
    playing = true;
    onStep = onStepCb || null;
    stepIndex = 0;
    state.漫游中 = true;
    state.总共 = ROAM_PATH.length;
    next();
    return true;
  }

  /**
   * 停止漫游：先清标志，再刹住当前这段。
   * @returns {boolean} false = 本来就没在漫游
   */
  function stopRoam() {
    if (!playing) return false;
    playing = false;
    camera.cancelFlight(); // 实测：调用后相机立刻停住（1.8 s 内位移 0.000 m）
    state.漫游中 = false;
    state.当前机位 = "—";
    return true;
  }

  return {
    flyToPoint,
    startRoam,
    stopRoam,
    toWorld,
    state,
    get isRoaming() {
      return playing;
    },
  };
}
