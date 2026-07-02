import Database from "better-sqlite3";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { ensureSalesCloneDatabase } from "@/lib/database.server";
import { closeBotTokenStore, getBotTokenFromStoreOrEnv } from "@/lib/bot-token-store.server";
import { resolveSalesDatabasePath } from "@/lib/paths.server";
import type { SalesBotRuntime } from "@/lib/sales-bot-runtime.server";
import { getBotInfoWithToken } from "@/lib/telegram.server";

export type ManagedSalesBot = {
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
const ensuredManagedDatabasePaths = new Set<string>();
const deprecatedManagedUsernames = new Set(["bruninhabb_bot"]);
const managedTable = "managed_sales_bots";
const legacyCloneTable = "sales_bot_clones";

registry.pragma("journal_mode = WAL");
registry.pragma("busy_timeout = 15000");

function createRegistryTable(tableName: string) {
  registry.exec(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
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
}

function ensureOwnerColumn(tableName: string) {
  const columns = registry.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === "owner_account_id")) {
    registry.exec(`ALTER TABLE "${tableName}" ADD COLUMN "owner_account_id" TEXT`);
  }
}

createRegistryTable(legacyCloneTable);
createRegistryTable(managedTable);
ensureOwnerColumn(legacyCloneTable);
ensureOwnerColumn(managedTable);

registry.exec(`
  INSERT OR IGNORE INTO ${managedTable}
    (id, token, telegram_id, username, display_name, database_path, owner_account_id, created_at, updated_at)
  SELECT id, token, telegram_id, username, display_name, database_path, owner_account_id, created_at, updated_at
  FROM ${legacyCloneTable}
`);

for (const tableName of [legacyCloneTable, managedTable]) {
  registry
    .prepare(
      `DELETE FROM ${tableName}
       WHERE lower(username) IN (${Array.from(deprecatedManagedUsernames)
         .map(() => "?")
         .join(", ")})`,
    )
    .run(...deprecatedManagedUsernames);
}

function migrateLegacyEnvManagedSalesBots() {
  const token = process.env.DANI_MILLER_BOT_TOKEN?.trim();
  if (!token) return;

  const id = "danimiller-bot";
  const username = "danimiller_bot";
  const databasePath = defaultManagedBotDatabasePath(id);
  ensureManagedBotDatabase(databasePath);
  const now = new Date().toISOString();
  const existing = registry
    .prepare(`SELECT id FROM ${managedTable} WHERE id = ? OR username = ? COLLATE NOCASE`)
    .get(id, username) as { id: string } | undefined;

  if (existing) {
    registry
      .prepare(`UPDATE ${managedTable} SET token = ?, updated_at = ? WHERE id = ?`)
      .run(token, now, existing.id);
    return;
  }

  registry
    .prepare(
      `INSERT INTO ${managedTable}
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

migrateLegacyEnvManagedSalesBots();

export function closeSalesBotRegistry() {
  if (registry.open) registry.close();
  closeBotTokenStore();
}

function defaultManagedBotDatabasePath(id: string) {
  return resolve(dirname(primaryDatabasePath), "sales-bots", `${id}.sqlite`);
}

function normalizeUsername(username: string) {
  return username.replace(/^@/, "").trim().toLowerCase();
}

function isWindowsAbsolutePath(value: string) {
  return /^[A-Za-z]:[\\/]/.test(value);
}

function resolveManagedBotDatabasePath(id: string, storedPath: string) {
  const fallbackPath = defaultManagedBotDatabasePath(id);
  const trimmedPath = storedPath.trim();
  if (!trimmedPath || isWindowsAbsolutePath(trimmedPath)) return fallbackPath;

  const resolvedPath = resolve(trimmedPath);
  if (existsSync(resolvedPath)) return resolvedPath;
  if (existsSync(fallbackPath)) return fallbackPath;

  return trimmedPath.endsWith(`${id}.sqlite`) ? fallbackPath : resolvedPath;
}

function ensureManagedBotDatabase(databasePath: string) {
  if (ensuredManagedDatabasePaths.has(databasePath)) return;
  ensureSalesCloneDatabase(databasePath);
  ensuredManagedDatabasePaths.add(databasePath);
}

function mapManagedBot(row: Omit<ManagedSalesBot, "key">): ManagedSalesBot {
  const databasePath = resolveManagedBotDatabasePath(row.id, row.database_path);
  if (databasePath !== row.database_path) {
    try {
      registry
        .prepare(`UPDATE ${managedTable} SET database_path = ?, updated_at = ? WHERE id = ?`)
        .run(databasePath, new Date().toISOString(), row.id);
    } catch (error) {
      console.warn(`[managed-sales-bot:${row.id}] falha ao atualizar caminho do banco`, error);
    }
  }
  ensureManagedBotDatabase(databasePath);
  return { ...row, database_path: databasePath, key: `sales-bot:${row.id}` };
}

export function listManagedSalesBots(
  options: { ownerAccountId?: string; includeEnv?: boolean } = {},
) {
  migrateLegacyEnvManagedSalesBots();
  const rows = (
    options.ownerAccountId
      ? registry
          .prepare(
            `SELECT * FROM ${managedTable} WHERE owner_account_id = ? ORDER BY created_at ASC`,
          )
          .all(options.ownerAccountId)
      : registry.prepare(`SELECT * FROM ${managedTable} ORDER BY created_at ASC`).all()
  ) as Array<Omit<ManagedSalesBot, "key">>;
  const databaseBots = rows
    .filter((row) => !deprecatedManagedUsernames.has(normalizeUsername(row.username)))
    .map(mapManagedBot);
  return databaseBots;
}

export function findManagedSalesBotById(id: string) {
  migrateLegacyEnvManagedSalesBots();
  const row = registry.prepare(`SELECT * FROM ${managedTable} WHERE id = ?`).get(id) as
    | Omit<ManagedSalesBot, "key">
    | undefined;
  return row ? mapManagedBot(row) : null;
}

export async function createManagedSalesBotRecord(input: {
  token: string;
  ownerAccountId: string;
}) {
  const token = input.token.trim();
  if (!token) throw new Error("Informe o token do bot");

  const info = await getBotInfoWithToken(token);
  const username = String(info.username ?? "").trim();
  if (!username) throw new Error("Esse bot nao possui username configurado no Telegram");

  const normalizedUsername = normalizeUsername(username);
  const existingByUsername = findManagedSalesBotByUsername(normalizedUsername);
  if (existingByUsername) throw new Error(`O bot @${normalizedUsername} ja esta cadastrado`);

  const telegramId = String(info.id);
  const existingByTelegramId = registry
    .prepare(`SELECT id FROM ${managedTable} WHERE telegram_id = ?`)
    .get(telegramId);
  if (existingByTelegramId) throw new Error("Esse bot ja esta cadastrado");

  const id = randomUUID();
  const databasePath = defaultManagedBotDatabasePath(id);
  ensureManagedBotDatabase(databasePath);
  const now = new Date().toISOString();

  registry
    .prepare(
      `INSERT INTO ${managedTable}
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

  return findManagedSalesBotById(id)!;
}

export function findManagedSalesBotByKey(key: string) {
  if (key.startsWith("sales-bot:")) return findManagedSalesBotById(key.slice("sales-bot:".length));
  if (key.startsWith("sales-clone:")) {
    return findManagedSalesBotById(key.slice("sales-clone:".length));
  }
  return null;
}

export function deleteManagedSalesBotRecord(id: string) {
  const bot = findManagedSalesBotById(id);
  if (!bot) return null;

  const remove = registry.transaction(() => {
    registry.prepare(`DELETE FROM ${legacyCloneTable} WHERE id = ?`).run(id);
    registry.prepare(`DELETE FROM ${managedTable} WHERE id = ?`).run(id);
  });
  remove();

  return bot;
}

export function findManagedSalesBotByUsername(username: string) {
  const normalized = normalizeUsername(username);
  migrateLegacyEnvManagedSalesBots();
  const row = registry
    .prepare(`SELECT * FROM ${managedTable} WHERE username = ? COLLATE NOCASE`)
    .get(username.replace(/^@/, "")) as Omit<ManagedSalesBot, "key"> | undefined;
  return row ? mapManagedBot(row) : null;
}

export function managedSalesBotRuntime(bot: ManagedSalesBot): SalesBotRuntime {
  return {
    id: bot.id,
    key: bot.key,
    token: bot.token,
    databasePath: bot.database_path,
    username: bot.username,
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
  const primaryToken = getBotTokenFromStoreOrEnv("sales", "TELEGRAM_BOT_TOKEN");
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

  for (const bot of listManagedSalesBots()) {
    if (safeEqual(receivedSecret, webhookSecret(bot.token))) {
      return managedSalesBotRuntime(bot);
    }
  }
  return null;
}

// Compatibilidade com pedidos, webhooks e bancos antigos que ainda guardam a palavra "clone".
export type SalesBotClone = ManagedSalesBot;
export const listSalesBotClones = listManagedSalesBots;
export const findSalesBotCloneById = findManagedSalesBotById;
export const createSalesBotClone = createManagedSalesBotRecord;
export const findSalesBotCloneByKey = findManagedSalesBotByKey;
export const findSalesBotCloneByUsername = findManagedSalesBotByUsername;
export const salesBotCloneRuntime = managedSalesBotRuntime;
