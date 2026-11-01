import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ==========================================================================================
 * Cesium 的静态资源为什么要单独处理？
 * ------------------------------------------------------------------------------------------
 * Worker / Assets / Widgets / ThirdParty 这些文件【不参与】JS 打包流程，
 * Cesium 是在运行时靠全局变量 CESIUM_BASE_URL 去"拼路径"取它们的：
 *     new Worker(`${CESIUM_BASE_URL}/Workers/xxx.js`)
 *     fetch(`${CESIUM_BASE_URL}/Assets/xxx.json`)
 * 所以必须同时做两件事：
 *   ① 让这个路径在 dev 和 build 下都能取到真文件；
 *   ② 用 define 把 CESIUM_BASE_URL 告诉 Cesium。
 * —— 第 2 月第 2 周第 1 次课"地球是黑的 / Worker 加载失败"，根因就在这里。
 *
 * 为什么不把 Build/Cesium 整个拷进 public/ ？
 *   那是 ~35MB 的第三方产物，会永久躺在 git 仓库里。
 *   下面这个插件 dev 直接从 node_modules 读，build 时才拷进 dist，仓库保持干净。
 * ========================================================================================== */
const CESIUM_SRC = path.resolve(__dirname, "node_modules/cesium/Build/Cesium");
/* GitHub Pages 部署在 /fuzhou-3d-city/ 子路径下，所有绝对路径都得带上它 ——
 * 否则 Worker 会去请求 <域名>/cesiumStatic/...，404，地球全黑。
 * dev 也用同一个 base：本地和线上路径完全一致，避免"本地好、线上坏"。 */
const BASE = "/fuzhou-3d-city/";
const CESIUM_STATIC_DIR = "cesiumStatic";
const CESIUM_BASE_URL = `${BASE}${CESIUM_STATIC_DIR}`;
const CESIUM_DIRS = ["Workers", "Assets", "Widgets", "ThirdParty"];

/* ⚠️ 浏览器对 <script type="module"> 做 MIME 严格校验：
 *    如果把 text/html（比如 SPA 回退页）当成 JS 返回，会被直接拒绝执行，
 *    报 "Failed to load module script / non-JavaScript MIME type"。
 *    所以 Content-Type 必须给对 —— 这正是"静态资源没被真正服务"时那串报错的直接原因。 */
const MIME = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".html": "text/html",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ktx2": "image/ktx2",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
};

const mimeOf = (file) => MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";

/**
 * 把 Cesium 静态资源挂到 /cesiumStatic/*
 *   · dev   → 中间件直接从 node_modules 读取（不复制，启动快）
 *   · build → closeBundle 阶段整体拷进 dist/cesiumStatic
 */
function cesiumStaticPlugin() {
  // dev 中间件拿到的 url 可能带 base、也可能已经被 strip 掉，两种都兼容
  const PREFIXES = [`${BASE}${CESIUM_STATIC_DIR}/`, `/${CESIUM_STATIC_DIR}/`];

  return {
    name: "cesium-static",

    configureServer(server) {
      // configureServer 里 use() 的中间件会排在 Vite 内部中间件【之前】，
      // 因此轮不到"SPA 回退"（那条会把任何未知路径都返回 index.html）。
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        const hit = PREFIXES.find((p) => url.startsWith(p));
        if (!hit) return next();

        const file = path.resolve(CESIUM_SRC, decodeURIComponent(url.slice(hit.length)));
        if (!file.startsWith(CESIUM_SRC + path.sep)) return next(); // 防目录穿越

        let stat;
        try {
          stat = fs.statSync(file);
        } catch {
          return next(); // 文件不存在 → 交给后面的中间件
        }
        if (!stat.isFile()) return next();

        res.setHeader("Content-Type", mimeOf(file));
        res.setHeader("Content-Length", stat.size);
        fs.createReadStream(file).pipe(res);
      });
    },

    closeBundle() {
      const outDir = path.resolve(__dirname, "dist", CESIUM_STATIC_DIR);
      for (const dir of CESIUM_DIRS) {
        fs.cpSync(path.join(CESIUM_SRC, dir), path.join(outDir, dir), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  /* build 出来的资源路径前缀（GitHub Pages 子路径） */
  base: BASE,
  define: {
    /* 告诉 Cesium 运行时去哪拼 Worker / Assets 的地址 */
    CESIUM_BASE_URL: JSON.stringify(CESIUM_BASE_URL),
  },
  plugins: [cesiumStaticPlugin()],
  server: {
    port: 5174,
    open: BASE,   // 本地也带子路径打开，和线上一致
  },
});
