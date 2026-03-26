import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";
import { VitePWA } from "vite-plugin-pwa";

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

export default defineConfig({
  define: {
    __APP_BUILD_ID__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    deviceIconManifestPlugin(),
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
