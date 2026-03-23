import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DIST_DIR = join(__dirname, "dist");
const INDEX_FILE = join(DIST_DIR, "index.html");
const PORT = Number(process.env.PORT || 8080);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function safeFilePath(urlPathname) {
  const cleanedPath = decodeURIComponent(urlPathname.split("?")[0] || "/");
  const relativePath = cleanedPath === "/" ? "/index.html" : cleanedPath;
  const resolvedPath = normalize(join(DIST_DIR, relativePath));
  return resolvedPath.startsWith(DIST_DIR) ? resolvedPath : null;
}

function contentTypeFor(filePath) {
  return MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream";
}

function cacheControlFor(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized.includes("/assets/")) {
    return "public, max-age=31536000, immutable";
  }
  if (normalized.endsWith("/sw.js") || normalized.endsWith("/manifest.webmanifest")) {
    return "no-cache";
  }
  if (normalized.endsWith(".html")) {
    return "no-cache";
  }
  return "public, max-age=3600";
}

function sendFile(response, filePath) {
  const stream = createReadStream(filePath);
  response.writeHead(200, {
    "Cache-Control": cacheControlFor(filePath),
    "Content-Type": contentTypeFor(filePath),
    "X-Content-Type-Options": "nosniff",
  });
  stream.pipe(response);
  stream.on("error", () => {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Failed to stream file.");
  });
}

const server = createServer((request, response) => {
  const requestPath = safeFilePath(request.url || "/");
  if (!requestPath) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad request.");
    return;
  }

  if (existsSync(requestPath) && statSync(requestPath).isFile()) {
    sendFile(response, requestPath);
    return;
  }

  const hasExtension = extname(requestPath) !== "";
  if (!hasExtension && existsSync(INDEX_FILE)) {
    sendFile(response, INDEX_FILE);
    return;
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found.");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`CCTV Planner listening on ${PORT}`);
});
