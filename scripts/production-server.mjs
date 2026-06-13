import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const clientDir = resolve(rootDir, "dist/client");
const serverEntry = await import(new URL("../dist/server/server.js", import.meta.url));
const handler = serverEntry.default;

if (!handler || typeof handler.fetch !== "function") {
  throw new Error("O bundle TanStack não exporta um handler fetch válido");
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function serveStatic(request, response, pathname) {
  const relativePath = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (!relativePath || relativePath.includes("\0")) return false;

  const filePath = resolve(clientDir, relativePath);
  if (filePath !== clientDir && !filePath.startsWith(`${clientDir}${sep}`)) return false;

  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) return false;

  response.statusCode = 200;
  response.setHeader("Content-Type", mimeTypes[extname(filePath)] ?? "application/octet-stream");
  response.setHeader("Content-Length", fileStat.size);
  if (relativePath.startsWith("assets/")) {
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
  if (request.method === "HEAD") {
    response.end();
    return true;
  }
  createReadStream(filePath).pipe(response);
  return true;
}

async function toWebRequest(request) {
  const host = request.headers.host ?? "localhost";
  const protocol = request.headers["x-forwarded-proto"] ?? "http";
  const url = new URL(request.url ?? "/", `${protocol}://${host}`);
  const method = request.method ?? "GET";
  const init = {
    method,
    headers: request.headers,
  };
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(request);
    init.duplex = "half";
  }
  return new Request(url, init);
}

async function sendWebResponse(webResponse, response) {
  response.statusCode = webResponse.status;
  response.statusMessage = webResponse.statusText;
  for (const [name, value] of webResponse.headers) response.setHeader(name, value);
  const cookies = webResponse.headers.getSetCookie?.() ?? [];
  if (cookies.length) response.setHeader("Set-Cookie", cookies);

  if (!webResponse.body) {
    response.end();
    return;
  }
  Readable.fromWeb(webResponse.body).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if ((request.method === "GET" || request.method === "HEAD") && pathname.includes(".")) {
      if (await serveStatic(request, response, pathname)) return;
    }

    const webRequest = await toWebRequest(request);
    const webResponse = await handler.fetch(webRequest, process.env, {});
    await sendWebResponse(webResponse, response);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      response.statusCode = 500;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
    }
    response.end("Internal Server Error");
  }
});

const port = Number(process.env.PORT ?? 80);
const host = process.env.HOST ?? "0.0.0.0";
server.listen(port, host, () => {
  console.log(`Production server listening on http://${host}:${port}`);
});
