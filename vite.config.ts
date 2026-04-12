import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";
import { VitePWA } from "vite-plugin-pwa";
import { createOperationalProgressMiddleware } from "./operational-progress-server.mjs";
import { createProjectLibraryMiddleware } from "./project-library-server.mjs";

const REPORTS_ROUTE_PREFIX = "/reporte";
const REPORT_MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function posixRelative(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}

function toPublicUrl(relativePath: string): string {
  return `/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function scanDeviceIconTree(rootDir: string, rootLabel: string) {
  const icons: Array<{ path: string; url: string }> = [];
  const aliases: Array<{ alias: string; path: string }> = [];

  function visit(currentDir: string) {
    if (!fs.existsSync(currentDir)) {
      return;
    }

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    entries.forEach((entry) => {
      if (entry.name.startsWith(".") || entry.name === "__MACOSX") {
        return;
      }

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        return;
      }

      const relativePath = posixRelative(rootDir, fullPath);
      const manifestPath = `${rootLabel}/${relativePath}`;
      if (/\.(png|svg)$/i.test(entry.name)) {
        icons.push({
          path: manifestPath,
          url: toPublicUrl(`device-icons/${manifestPath}`),
        });
        return;
      }

      if (/\.(txt)$/i.test(entry.name)) {
        aliases.push({
          alias: fs.readFileSync(fullPath, "utf8"),
          path: manifestPath,
        });
      }
    });
  }

  visit(rootDir);
  return { aliases, icons };
}

function syncDeviceIconManifest(root: string) {
  const publicDir = path.resolve(root, "public");
  const deviceIconsDir = path.resolve(publicDir, "device-icons");
  const libraryRoot = path.resolve(deviceIconsDir, "Camera Symbols");
  const manifestPath = path.resolve(deviceIconsDir, "index.json");

  fs.mkdirSync(deviceIconsDir, { recursive: true });

  const { aliases, icons } = scanDeviceIconTree(libraryRoot, "Camera Symbols");
  const manifest = {
    aliases,
    generatedAt: new Date().toISOString(),
    iconCount: icons.length,
    icons,
    root: "Camera Symbols",
  };

  const nextJson = `${JSON.stringify(manifest, null, 2)}\n`;
  const currentJson = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, "utf8") : "";
  if (currentJson !== nextJson) {
    fs.writeFileSync(manifestPath, nextJson, "utf8");
  }
}

function deviceIconManifestPlugin() {
  let projectRoot = process.cwd();

  return {
    buildStart() {
      syncDeviceIconManifest(projectRoot);
    },
    configResolved(config: { root: string }) {
      projectRoot = config.root;
      syncDeviceIconManifest(projectRoot);
    },
    name: "device-icon-manifest",
  };
}

function reportContentType(filePath: string): string {
  return REPORT_MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function resolveReportFile(sourceDir: string, urlPath: string): string | null {
  const relativePath = urlPath.startsWith(REPORTS_ROUTE_PREFIX)
    ? urlPath.slice(REPORTS_ROUTE_PREFIX.length)
    : urlPath;
  const normalizedRelative = path.posix
    .normalize(relativePath === "" || relativePath === "/" ? "/index.html" : relativePath)
    .replace(/^\/+/, "");

  if (normalizedRelative.startsWith("..")) {
    return null;
  }

  const absolutePath = path.resolve(sourceDir, normalizedRelative);
  const relativeCheck = path.relative(sourceDir, absolutePath);
  if (relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) {
    return null;
  }

  if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory()) {
    const indexPath = path.join(absolutePath, "index.html");
    return fs.existsSync(indexPath) ? indexPath : null;
  }

  return absolutePath;
}

function createReportMiddleware(sourceDir: string) {
  return (request: { url?: string }, response: NodeJS.WritableStream & {
    end: (chunk?: unknown) => void;
    setHeader: (name: string, value: string) => void;
    statusCode: number;
  }, next: () => void) => {
    if (!request.url) {
      next();
      return;
    }

    const requestPath = request.url.split("?")[0] || "/";
    if (!requestPath.startsWith(REPORTS_ROUTE_PREFIX)) {
      next();
      return;
    }

    let filePath: string | null = null;
    try {
      filePath = resolveReportFile(sourceDir, decodeURIComponent(requestPath));
    } catch {
      next();
      return;
    }

    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      next();
      return;
    }

    response.statusCode = 200;
    response.setHeader("Content-Type", reportContentType(filePath));
    response.setHeader("Cache-Control", filePath.endsWith(".html") ? "no-cache" : "public, max-age=3600");

    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      response.statusCode = 500;
      response.end("Failed to read report file.");
    });
    stream.pipe(response);
  };
}

function copyReportsDirectory(sourceDir: string, outDir: string) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  const targetDir = path.resolve(outDir, "reporte");
  fs.rmSync(targetDir, { force: true, recursive: true });
  fs.cpSync(sourceDir, targetDir, {
    filter: (sourcePath) => !path.basename(sourcePath).startsWith("."),
    recursive: true,
  });
}

function reportStaticPlugin() {
  let projectRoot = process.cwd();
  let buildOutDir = path.resolve(projectRoot, "dist");

  return {
    configureServer(server: { middlewares: { use: (middleware: ReturnType<typeof createReportMiddleware>) => void } }) {
      server.middlewares.use(createReportMiddleware(path.resolve(projectRoot, "reporte")));
    },
    configurePreviewServer(server: { middlewares: { use: (middleware: ReturnType<typeof createReportMiddleware>) => void } }) {
      server.middlewares.use(createReportMiddleware(path.resolve(buildOutDir, "reporte")));
    },
    configResolved(config: { build: { outDir: string }; root: string }) {
      projectRoot = config.root;
      buildOutDir = path.resolve(projectRoot, config.build.outDir);
    },
    name: "report-static-plugin",
  };
}

function reportBuildCopyPlugin() {
  let projectRoot = process.cwd();
  let buildOutDir = path.resolve(projectRoot, "dist");

  return {
    closeBundle() {
      copyReportsDirectory(path.resolve(projectRoot, "reporte"), buildOutDir);
    },
    configResolved(config: { build: { outDir: string }; root: string }) {
      projectRoot = config.root;
      buildOutDir = path.resolve(projectRoot, config.build.outDir);
    },
    name: "report-build-copy-plugin",
  };
}

function operationalProgressApiPlugin() {
  const middleware = createOperationalProgressMiddleware();

  return {
    configurePreviewServer(server: { middlewares: { use: (middleware: typeof createOperationalProgressMiddleware extends (...args: never[]) => infer R ? R : never) => void } }) {
      server.middlewares.use(middleware);
    },
    configureServer(server: { middlewares: { use: (middleware: typeof createOperationalProgressMiddleware extends (...args: never[]) => infer R ? R : never) => void } }) {
      server.middlewares.use(middleware);
    },
    name: "operational-progress-api-plugin",
  };
}

function projectLibraryApiPlugin() {
  const middleware = createProjectLibraryMiddleware();

  return {
    configurePreviewServer(server: { middlewares: { use: (middleware: typeof createProjectLibraryMiddleware extends (...args: never[]) => infer R ? R : never) => void } }) {
      server.middlewares.use(middleware);
    },
    configureServer(server: { middlewares: { use: (middleware: typeof createProjectLibraryMiddleware extends (...args: never[]) => infer R ? R : never) => void } }) {
      server.middlewares.use(middleware);
    },
    name: "project-library-api-plugin",
  };
}

export default defineConfig({
  define: {
    __APP_BUILD_ID__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    deviceIconManifestPlugin(),
    reportStaticPlugin(),
    reportBuildCopyPlugin(),
    projectLibraryApiPlugin(),
    operationalProgressApiPlugin(),
    legacy({
      targets: ["defaults", "iOS >= 12", "Safari >= 12"],
      modernPolyfills: [
        "es.array.at",
        "es.array.flat",
        "es.array.flat-map",
        "es.array.find-last",
        "es.array.find-last-index",
        "es.string.replace-all",
        "es.object.from-entries",
        "es.promise.finally",
        "web.structured-clone",
      ],
    }),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "device-icons/index.json", "device-icons/**/*"],
      manifest: {
        name: "CCTV Field Planner",
        short_name: "CCTV Planner",
        description: "Visor tactil de planos CCTV para tecnicos de campo.",
        theme_color: "#14213d",
        background_color: "#f7f4ee",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          {
            src: "/pwa-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any"
          },
          {
            src: "/pwa-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable"
          }
        ]
      }
    })
  ]
});
