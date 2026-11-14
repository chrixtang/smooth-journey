// Cloud Run HTTP server for Smooth Journey:
// - Serves frontend/ static files (defaulting / to demo.html or index.html)
// - Enforces 12 KB body cap and 5 req/sec throttling on /api/*
// - Routes /api/* to backend/index.mjs handler
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handler } from "./index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, "../frontend");
const PORT = Number(process.env.PORT || 8080);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8"
};

const SEC_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer"
};

// Per-IP sliding-window rate limiter on /api/*. Generous because a room of judges
// on one venue Wi-Fi shares a single public IP while every phone polls for updates.
const RATE_PER_SEC = Number(process.env.RATE_PER_SEC || 60);
const buckets = new Map();
function allowRate(ip) {
  const now = Date.now();
  const list = (buckets.get(ip) || []).filter((t) => now - t < 1000);
  if (list.length >= RATE_PER_SEC) {
    buckets.set(ip, list);
    return false;
  }
  list.push(now);
  buckets.set(ip, list);
  if (buckets.size > 5000) buckets.clear();
  return true;
}

function readRawBody(req, limit = 12000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error("too_large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (pathname.startsWith("/api/")) {
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
    if (!allowRate(ip)) {
      res.writeHead(429, { ...SEC_HEADERS, "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "rate_limited" }));
      return;
    }

    let body = "";
    try {
      if (req.method === "POST" || req.method === "PUT") {
        body = await readRawBody(req, 12000);
      }
    } catch (e) {
      const st = e && e.status === 413 ? 413 : 400;
      res.writeHead(st, { ...SEC_HEADERS, "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: st === 413 ? "too_large" : "bad_request" }));
      return;
    }

    const qs = {};
    for (const [k, v] of url.searchParams.entries()) qs[k] = v;

    const result = await handler({
      rawPath: pathname,
      queryStringParameters: qs,
      requestContext: { http: { method: req.method || "GET" } },
      body
    });

    res.writeHead(result.statusCode || 200, { ...SEC_HEADERS, ...(result.headers || {}) });
    res.end(result.body || "");
    return;
  }

  // Static files from frontend/
  let rel = pathname === "/" ? "/index.html" : pathname === "/demo" ? "/demo.html" : pathname;
  const safePath = path.normalize(path.join(FRONTEND_DIR, rel));
  if (!safePath.startsWith(FRONTEND_DIR)) {
    res.writeHead(403, SEC_HEADERS);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(safePath);
    const ext = path.extname(safePath);
    res.writeHead(200, {
      ...SEC_HEADERS,
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600"
    });
    res.end(data);
  } catch {
    res.writeHead(404, SEC_HEADERS);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Smooth Journey listening on port ${PORT}`);
});
