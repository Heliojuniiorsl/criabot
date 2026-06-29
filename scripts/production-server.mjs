import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const clientDir = resolve(rootDir, "dist/client");
const serverEntry = await import(new URL("../dist/server/server.js", import.meta.url));
const handler = serverEntry.default;
const salesWebhookUpdates = [
  "message",
  "channel_post",
  "callback_query",
  "my_chat_member",
  "chat_join_request",
];
const imageWebhookUpdates = ["message", "callback_query", "my_chat_member"];
const siteWebhookUpdates = ["message"];
const salesBotCommands = [
  { command: "start", description: "Abrir planos e ofertas" },
  { command: "planos", description: "Ver planos disponiveis" },
  { command: "ofertas", description: "Ver ofertas ativas" },
  { command: "meus_acessos", description: "Ver meus acessos VIP" },
  { command: "suporte", description: "Falar com suporte" },
];
const imageBotCommands = [
  { command: "start", description: "Abrir menu principal" },
  { command: "videos", description: "Receber videos" },
  { command: "favoritos", description: "Ver favoritos" },
  { command: "premium", description: "Ver planos premium" },
  { command: "idioma", description: "Trocar idioma" },
];
const siteBotCommands = [{ command: "start", description: "Vincular sua conta ao CriaBot" }];

if (!handler || typeof handler.fetch !== "function") {
  throw new Error("O bundle TanStack não exporta um handler fetch válido");
}

function resolveSalesDatabasePath() {
  const configuredPath = process.env.DATABASE_PATH?.trim();
  if (configuredPath) return resolve(configuredPath);

  const criabotPath = resolve("data/criabot.sqlite");
  const legacyPath = resolve("data/botvendassl.sqlite");
  if (existsSync(legacyPath) && !existsSync(criabotPath)) return legacyPath;

  return criabotPath;
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

async function setSalesWebhook(label, token, publicUrl) {
  if (!token || !publicUrl.startsWith("https://")) return;
  const secret = createHash("sha256").update(`telegram-webhook:${token}`).digest("base64url");
  await telegramPost(token, "setWebhook", label, {
    url: `${publicUrl}/api/public/telegram/webhook`,
    secret_token: secret,
    allowed_updates: salesWebhookUpdates,
    drop_pending_updates: false,
  });
  await setTelegramCommandsMenu(token, salesBotCommands, label);
  console.log(`[boot] Webhook de ${label} sincronizado.`);
}

async function setImageWebhook(label, token, publicUrl) {
  if (!token || !publicUrl.startsWith("https://")) return;
  const secret = createHash("sha256").update(`telegram-image-webhook:${token}`).digest("base64url");
  await telegramPost(token, "setWebhook", label, {
    url: `${publicUrl}/api/public/telegram/image-webhook`,
    secret_token: secret,
    allowed_updates: imageWebhookUpdates,
    drop_pending_updates: false,
  });
  await setTelegramCommandsMenu(token, imageBotCommands, label);
  console.log(`[boot] Webhook de ${label} sincronizado.`);
}

async function setSiteWebhook(label, token, publicUrl) {
  if (!token || !publicUrl.startsWith("https://")) return;
  const secret = createHash("sha256").update(`criabot-site-webhook:${token}`).digest("base64url");
  await telegramPost(token, "setWebhook", label, {
    url: `${publicUrl}/api/public/telegram/site-webhook`,
    secret_token: secret,
    allowed_updates: siteWebhookUpdates,
    drop_pending_updates: false,
  });
  await setTelegramCommandsMenu(token, siteBotCommands, label);
  console.log(`[boot] Webhook de ${label} sincronizado.`);
}

async function telegramPost(token, method, label, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    const detail = payload?.description ?? `HTTP ${response.status}`;
    throw new Error(`Telegram recusou ${method} de ${label}: ${detail}`);
  }
}

function getCriaBotToken() {
  return (
    process.env.CRIABOT_TOKEN?.trim() ||
    process.env.SITE_BOT_TOKEN?.trim() ||
    process.env.criabot_token?.trim() ||
    ""
  );
}

function resolveRegistryPath() {
  const primaryDatabasePath = resolveSalesDatabasePath();
  return resolve(
    process.env.BOT_REGISTRY_PATH ?? dirname(primaryDatabasePath),
    process.env.BOT_REGISTRY_PATH ? "" : "bot-registry.sqlite",
  );
}

function ensureRegistryTables(registry) {
  registry.exec(`
    CREATE TABLE IF NOT EXISTS bot_token_store (
      key TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS managed_sales_bots (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      telegram_id TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      database_path TEXT NOT NULL UNIQUE,
      owner_account_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function getStoredBotToken(key, envName) {
  const registryPath = resolveRegistryPath();
  mkdirSync(dirname(registryPath), { recursive: true });
  const registry = new Database(registryPath);
  try {
    ensureRegistryTables(registry);
    const existing = registry
      .prepare("SELECT token FROM bot_token_store WHERE key = ?")
      .get(key)?.token;
    if (existing) return String(existing).trim();

    const envToken = process.env[envName]?.trim();
    if (!envToken) return "";
    registry
      .prepare(
        `INSERT INTO bot_token_store (key, token, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           token = excluded.token,
           updated_at = excluded.updated_at`,
      )
      .run(key, envToken, new Date().toISOString());
    return envToken;
  } finally {
    registry.close();
  }
}

async function setTelegramCommandsMenu(token, commands, label) {
  await telegramPost(token, "setMyCommands", label, { commands });
  await telegramPost(token, "setChatMenuButton", label, { menu_button: { type: "commands" } });
}

function migrateDaniBotFromEnv(registry) {
  const token = process.env.DANI_MILLER_BOT_TOKEN?.trim();
  if (!token) return;
  const primaryDatabasePath = resolveSalesDatabasePath();
  const id = "danimiller-bot";
  const username = "danimiller_bot";
  const databasePath = resolve(dirname(primaryDatabasePath), "sales-bots", `${id}.sqlite`);
  ensureSalesCloneDatabase(databasePath);
  const now = new Date().toISOString();
  const existing = registry
    .prepare("SELECT id FROM managed_sales_bots WHERE id = ? OR username = ? COLLATE NOCASE")
    .get(id, username);
  if (existing?.id) {
    registry
      .prepare("UPDATE managed_sales_bots SET token = ?, updated_at = ? WHERE id = ?")
      .run(token, now, existing.id);
    return;
  }
  registry
    .prepare(
      `INSERT INTO managed_sales_bots
       (id, token, telegram_id, username, display_name, database_path, owner_account_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      token,
      "env:DANI_MILLER_BOT_TOKEN",
      username,
      "Dani Miller",
      databasePath,
      null,
      now,
      now,
    );
}

function listSalesClonesForWebhookSync() {
  const deprecatedUsernames = new Set(["bruninhabb_bot"]);
  const registryPath = resolveRegistryPath();
  mkdirSync(dirname(registryPath), { recursive: true });
  const registry = new Database(registryPath);
  try {
    ensureRegistryTables(registry);
    migrateDaniBotFromEnv(registry);
    const rows = [
      ...registry
        .prepare(
          "SELECT username, token FROM managed_sales_bots WHERE token IS NOT NULL AND token != ''",
        )
        .all(),
    ];
    const legacyTable = registry
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sales_bot_clones'")
      .get();
    if (legacyTable) {
      rows.push(
        ...registry
          .prepare(
            "SELECT username, token FROM sales_bot_clones WHERE token IS NOT NULL AND token != ''",
          )
          .all(),
      );
    }
    const seen = new Set();
    return rows
      .filter((clone) => !deprecatedUsernames.has(String(clone.username).toLowerCase()))
      .filter((clone) => {
        const username = String(clone.username).toLowerCase();
        if (seen.has(username)) return false;
        seen.add(username);
        return true;
      });
  } finally {
    registry.close();
  }
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function cloneDatabaseIsReady(databasePath) {
  if (!existsSync(databasePath)) return false;
  const database = new Database(databasePath);
  try {
    return Boolean(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'bot_settings'")
        .get(),
    );
  } finally {
    database.close();
  }
}

function ensureSalesCloneDatabase(databasePath) {
  if (cloneDatabaseIsReady(databasePath)) return;

  mkdirSync(dirname(databasePath), { recursive: true });
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });

  const primaryDatabasePath = resolveSalesDatabasePath();
  const primary = new Database(primaryDatabasePath);
  try {
    primary.pragma("wal_checkpoint(FULL)");
    primary.exec(`VACUUM INTO ${sqlString(databasePath)}`);
  } finally {
    primary.close();
  }

  const clone = new Database(databasePath);
  const operationalTables = [
    "telegram_access_grants",
    "customer_events",
    "bot_sessions",
    "bot_rate_limits",
    "payments",
    "subscriptions",
    "orders",
    "users",
    "group_broadcasts",
    "telegram_groups",
    "telegram_updates",
    "admin_sessions",
  ];
  try {
    clone.pragma("foreign_keys = OFF");
    const existingTables = new Set(
      clone
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    const clearOperationalData = clone.transaction(() => {
      for (const table of operationalTables) {
        if (existingTables.has(table)) clone.exec(`DELETE FROM ${table}`);
      }
      if (existingTables.has("broadcasts")) {
        clone.exec("UPDATE broadcasts SET last_sent_at = NULL, locked_at = NULL");
      }
    });
    clearOperationalData();
    clone.pragma("foreign_keys = ON");
  } finally {
    clone.close();
  }
}

function ensureProductionSalesCloneDatabases() {
  const registryPath = resolveRegistryPath();
  mkdirSync(dirname(registryPath), { recursive: true });
  const registry = new Database(registryPath);
  try {
    ensureRegistryTables(registry);
    migrateDaniBotFromEnv(registry);
    const rows = registry.prepare("SELECT database_path FROM managed_sales_bots").all();
    for (const row of rows) ensureSalesCloneDatabase(String(row.database_path));
  } finally {
    registry.close();
  }
}

async function syncSalesWebhooksOnBoot() {
  const publicUrl = String(process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  if (!publicUrl.startsWith("https://")) return;

  const tasks = [
    setSiteWebhook("CriaBot oficial", getCriaBotToken(), publicUrl),
    setSalesWebhook("Bruna", getStoredBotToken("sales", "TELEGRAM_BOT_TOKEN"), publicUrl),
    setImageWebhook("UpMidias", getStoredBotToken("images", "IMAGE_BOT_TOKEN"), publicUrl),
  ];
  for (const clone of listSalesClonesForWebhookSync()) {
    tasks.push(setSalesWebhook(`clone @${clone.username}`, clone.token, publicUrl));
  }

  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === "rejected") console.warn(`[boot] ${result.reason.message}`);
  }
}

const port = Number(process.env.PORT ?? 80);
const host = process.env.HOST ?? "0.0.0.0";
ensureProductionSalesCloneDatabases();
server.listen(port, host, () => {
  console.log(`Production server listening on http://${host}:${port}`);
  void syncSalesWebhooksOnBoot();
});
