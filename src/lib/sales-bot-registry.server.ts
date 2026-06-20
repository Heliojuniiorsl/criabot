import Database from "better-sqlite3";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { clonePrimarySalesDatabase } from "@/lib/database.server";
import type { SalesBotRuntime } from "@/lib/sales-bot-runtime.server";
import { getBotInfoWithToken } from "@/lib/telegram.server";

export type SalesBotClone = {
  id: string;
  key: string;
  token: string;
  telegram_id: string;
  username: string;
  display_name: string;
  database_path: string;
  created_at: string;
  updated_at: string;
};

const primaryDatabasePath = resolve(process.env.DATABASE_PATH ?? "data/botvendassl.sqlite");
const registryPath = resolve(
  process.env.BOT_REGISTRY_PATH ?? dirname(primaryDatabasePath),
  process.env.BOT_REGISTRY_PATH ? "" : "bot-registry.sqlite",
);
mkdirSync(dirname(registryPath), { recursive: true });

const registry = new Database(registryPath);
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
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

export function closeSalesBotRegistry() {
  if (registry.open) registry.close();
}

function defaultCloneDatabasePath(id: string) {
  return resolve(dirname(primaryDatabasePath), "sales-bots", `${id}.sqlite`);
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
  return { ...row, database_path: databasePath, key: `sales-clone:${row.id}` };
}

export function listSalesBotClones() {
  const rows = registry
    .prepare("SELECT * FROM sales_bot_clones ORDER BY created_at ASC")
    .all() as Array<Omit<SalesBotClone, "key">>;
  return rows.map(mapClone);
}

export function findSalesBotCloneById(id: string) {
  const row = registry.prepare("SELECT * FROM sales_bot_clones WHERE id = ?").get(id) as
    | Omit<SalesBotClone, "key">
    | undefined;
  return row ? mapClone(row) : null;
}

export function findSalesBotCloneByKey(key: string) {
  if (!key.startsWith("sales-clone:")) return null;
  return findSalesBotCloneById(key.slice("sales-clone:".length));
}

export function findSalesBotCloneByUsername(username: string) {
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
      databasePath: resolve(process.env.DATABASE_PATH ?? "data/botvendassl.sqlite"),
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

export async function createSalesBotClone(tokenInput: string) {
  const token = tokenInput.trim();
  if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token)) {
    throw new Error("Token do Telegram invalido");
  }
  if (token === process.env.TELEGRAM_BOT_TOKEN?.trim()) {
    throw new Error("Este token ja pertence ao bot Bruna original");
  }

  const info = await getBotInfoWithToken(token);
  const username = String(info.username ?? "").trim();
  if (!username) throw new Error("O Telegram nao retornou o usuario deste bot");

  const duplicate = registry
    .prepare(
      "SELECT username FROM sales_bot_clones WHERE token = ? OR telegram_id = ? OR username = ? COLLATE NOCASE",
    )
    .get(token, String(info.id), username) as { username: string } | undefined;
  if (duplicate) throw new Error(`O bot @${duplicate.username} ja foi adicionado`);

  const id = randomUUID();
  const databasePath = defaultCloneDatabasePath(id);
  await clonePrimarySalesDatabase(databasePath);

  const now = new Date().toISOString();
  registry
    .prepare(
      `INSERT INTO sales_bot_clones
       (id, token, telegram_id, username, display_name, database_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      token,
      String(info.id),
      username,
      String(info.first_name || username),
      databasePath,
      now,
      now,
    );

  return findSalesBotCloneById(id)!;
}
