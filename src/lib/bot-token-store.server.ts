import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { resolveSalesDatabasePath } from "@/lib/paths.server";

const primaryDatabasePath = resolveSalesDatabasePath();
const registryPath = resolve(
  process.env.BOT_REGISTRY_PATH ?? dirname(primaryDatabasePath),
  process.env.BOT_REGISTRY_PATH ? "" : "bot-registry.sqlite",
);

mkdirSync(dirname(registryPath), { recursive: true });

const tokenStore = new Database(registryPath);

tokenStore.pragma("journal_mode = WAL");
tokenStore.pragma("busy_timeout = 15000");

tokenStore.exec(`
  CREATE TABLE IF NOT EXISTS bot_token_store (
    key TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

export function closeBotTokenStore() {
  if (tokenStore.open) tokenStore.close();
}

export function getStoredBotToken(key: string) {
  const row = tokenStore.prepare("SELECT token FROM bot_token_store WHERE key = ?").get(key) as
    | { token: string }
    | undefined;
  return row?.token?.trim() || null;
}

export function saveStoredBotToken(key: string, token: string) {
  const cleanToken = token.trim();
  if (!cleanToken) return null;
  tokenStore
    .prepare(
      `INSERT INTO bot_token_store (key, token, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         token = excluded.token,
         updated_at = excluded.updated_at`,
    )
    .run(key, cleanToken, new Date().toISOString());
  return cleanToken;
}

export function getBotTokenFromStoreOrEnv(key: string, envName: string) {
  const storedToken = getStoredBotToken(key);
  if (storedToken) return storedToken;

  const envToken = process.env[envName]?.trim();
  if (!envToken) return null;
  return saveStoredBotToken(key, envToken);
}
