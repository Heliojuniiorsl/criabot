import Database from "better-sqlite3";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { ensureSalesCloneDatabase } from "@/lib/database.server";
import { resolveSalesDatabasePath } from "@/lib/paths.server";
import { getBotInfoWithToken } from "@/lib/telegram.server";
import type { SalesBotRuntime } from "@/lib/sales-bot-runtime.server";

export type SalesBotClone = {
  id: string;
  key: string;
  token: string;
  telegram_id: string;
  username: string;
  display_name: string;
  database_path: string;
  owner_account_id: string | null;
  created_at: string;
  updated_at: string;
};

const primaryDatabasePath = resolveSalesDatabasePath();
const registryPath = resolve(
  process.env.BOT_REGISTRY_PATH ?? dirname(primaryDatabasePath),
  process.env.BOT_REGISTRY_PATH ? "" : "bot-registry.sqlite",
);
mkdirSync(dirname(registryPath), { recursive: true });

const registry = new Database(registryPath);
const ensuredCloneDatabasePaths = new Set<string>();
const deprecatedCloneUsernames = new Set(["bruninhabb_bot"]);
registry.pragma("journal_mode = WAL");
registry.pragma("busy_timeout = 15000");
registry.exec(`
  CREATE TABLE IF NOT EXISTS sales_bot_clones (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    telegram_id TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    database_path TEXT NOT NULL UNIQUE,
    owner_account_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

const cloneColumns = registry.prepare('PRAGMA table_info("sales_bot_clones")').all() as Array<{
  name: string;
}>;
if (!cloneColumns.some((column) => column.name === "owner_account_id")) {
  registry.exec('ALTER TABLE "sales_bot_clones" ADD COLUMN "owner_account_id" TEXT');
}

registry
  .prepare(
    `DELETE FROM sales_bot_clones
     WHERE lower(username) IN (${Array.from(deprecatedCloneUsernames)
       .map(() => "?")
       .join(", ")})`,
  )
  .run(...deprecatedCloneUsernames);

export function closeSalesBotRegistry() {
  if (registry.open) registry.close();
}

function defaultCloneDatabasePath(id: string) {
  return resolve(dirname(primaryDatabasePath), "sales-bots", `${id}.sqlite`);
}

function normalizeUsername(username: string) {
  return username.replace(/^@/, "").trim().toLowerCase();
}

function isWindowsAbsolutePath(value: string) {
  return /^[A-Za-z]:[\\/]/.test(value);
}

function resolveCloneDatabasePath(id: string, storedPath: string) {
  const fallbackPath = defaultCloneDatabasePath(id);
  const trimmedPath = storedPath.trim();
  if (!trimmedPath || isWindowsAbsolutePath(trimmedPath)) return fallbackPath;

  const resolvedPath = resolve(trimmedPath);
  if (existsSync(resolvedPath)) return resolvedPath;
  if (existsSync(fallbackPath)) return fallbackPath;

  return trimmedPath.endsWith(`${id}.sqlite`) ? fallbackPath : resolvedPath;
}

function ensureCloneDatabase(databasePath: string) {
  if (ensuredCloneDatabasePaths.has(databasePath)) return;
  ensureSalesCloneDatabase(databasePath);
  ensuredCloneDatabasePaths.add(databasePath);
}

function mapClone(row: Omit<SalesBotClone, "key">): SalesBotClone {
  const databasePath = resolveCloneDatabasePath(row.id, row.database_path);
  if (databasePath !== row.database_path) {
    try {
      registry
        .prepare("UPDATE sales_bot_clones SET database_path = ?, updated_at = ? WHERE id = ?")
        .run(databasePath, new Date().toISOString(), row.id);
    } catch (error) {
      console.warn(`[sales-bot-registry:${row.id}] falha ao atualizar caminho do banco`, error);
    }
  }
  ensureCloneDatabase(databasePath);
  return { ...row, database_path: databasePath, key: `sales-clone:${row.id}` };
}

function listEnvironmentSalesBotClones(): SalesBotClone[] {
  const token = process.env.DANI_MILLER_BOT_TOKEN?.trim();
  if (!token) return [];
  const id = "danimiller-bot";
  const databasePath = defaultCloneDatabasePath(id);
  ensureCloneDatabase(databasePath);
  const now = new Date().toISOString();
  return [
    {
      id,
      key: `sales-clone:${id}`,
      token,
      telegram_id: "env:DANI_MILLER_BOT_TOKEN",
      username: "danimiller_bot",
      display_name: "Dani Miller",
      database_path: databasePath,
      owner_account_id: null,
      created_at: now,
      updated_at: now,
    },
  ];
}

export function listSalesBotClones(
  options: { ownerAccountId?: string; includeEnv?: boolean } = {},
) {
  const envClones = options.ownerAccountId
    ? []
    : options.includeEnv === false
      ? []
      : listEnvironmentSalesBotClones();
  const envUsernames = new Set(envClones.map((clone) => normalizeUsername(clone.username)));
  const rows = (
    options.ownerAccountId
      ? registry
          .prepare(
            "SELECT * FROM sales_bot_clones WHERE owner_account_id = ? ORDER BY created_at ASC",
          )
          .all(options.ownerAccountId)
      : registry.prepare("SELECT * FROM sales_bot_clones ORDER BY created_at ASC").all()
  ) as Array<Omit<SalesBotClone, "key">>;
  const databaseClones = rows
    .filter((row) => !deprecatedCloneUsernames.has(normalizeUsername(row.username)))
    .filter((row) => !envUsernames.has(normalizeUsername(row.username)))
    .map(mapClone);
  return [...envClones, ...databaseClones];
}

export function findSalesBotCloneById(id: string) {
  const envClone = listEnvironmentSalesBotClones().find((clone) => clone.id === id);
  if (envClone) return envClone;
  const row = registry.prepare("SELECT * FROM sales_bot_clones WHERE id = ?").get(id) as
    | Omit<SalesBotClone, "key">
    | undefined;
  return row ? mapClone(row) : null;
}

export async function createSalesBotClone(input: { token: string; ownerAccountId: string }) {
  const token = input.token.trim();
  if (!token) throw new Error("Informe o token do bot");

  const info = await getBotInfoWithToken(token);
  const username = String(info.username ?? "").trim();
  if (!username) throw new Error("Esse bot nao possui username configurado no Telegram");

  const normalizedUsername = normalizeUsername(username);
  const existingByUsername = findSalesBotCloneByUsername(normalizedUsername);
  if (existingByUsername) throw new Error(`O bot @${normalizedUsername} ja esta cadastrado`);

  const telegramId = String(info.id);
  const existingByTelegramId = registry
    .prepare("SELECT id FROM sales_bot_clones WHERE telegram_id = ?")
    .get(telegramId);
  if (existingByTelegramId) throw new Error("Esse bot ja esta cadastrado");

  const id = randomUUID();
  const databasePath = defaultCloneDatabasePath(id);
  ensureCloneDatabase(databasePath);
  const now = new Date().toISOString();

  registry
    .prepare(
      `INSERT INTO sales_bot_clones
       (id, token, telegram_id, username, display_name, database_path, owner_account_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      token,
      telegramId,
      normalizedUsername,
      String(info.first_name || username),
      databasePath,
      input.ownerAccountId,
      now,
      now,
    );

  return findSalesBotCloneById(id)!;
}

export function findSalesBotCloneByKey(key: string) {
  if (!key.startsWith("sales-clone:")) return null;
  return findSalesBotCloneById(key.slice("sales-clone:".length));
}

export function findSalesBotCloneByUsername(username: string) {
  const normalized = normalizeUsername(username);
  const envClone = listEnvironmentSalesBotClones().find(
    (clone) => normalizeUsername(clone.username) === normalized,
  );
  if (envClone) return envClone;
  const row = registry
    .prepare("SELECT * FROM sales_bot_clones WHERE username = ? COLLATE NOCASE")
    .get(username.replace(/^@/, "")) as Omit<SalesBotClone, "key"> | undefined;
  return row ? mapClone(row) : null;
}

export function salesBotCloneRuntime(clone: SalesBotClone): SalesBotRuntime {
  return {
    id: clone.id,
    key: clone.key,
    token: clone.token,
    databasePath: clone.database_path,
    username: clone.username,
    isPrimary: false,
  };
}

function webhookSecret(token: string) {
  return createHash("sha256").update(`telegram-webhook:${token}`).digest("base64url");
}

function safeEqual(leftValue: string, rightValue: string) {
  const left = Buffer.from(leftValue);
  const right = Buffer.from(rightValue);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function resolveSalesBotRuntimeByWebhookSecret(receivedSecret: string) {
  const primaryToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (primaryToken && safeEqual(receivedSecret, webhookSecret(primaryToken))) {
    return {
      id: "primary",
      key: "sales",
      token: primaryToken,
      databasePath: resolveSalesDatabasePath(),
      username: "",
      isPrimary: true,
    } satisfies SalesBotRuntime;
  }

  for (const clone of listSalesBotClones()) {
    if (safeEqual(receivedSecret, webhookSecret(clone.token))) {
      return salesBotCloneRuntime(clone);
    }
  }
  return null;
}
