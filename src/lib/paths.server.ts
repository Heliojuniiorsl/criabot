import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function resolveSalesDatabasePath() {
  const configuredPath = process.env.DATABASE_PATH?.trim();
  if (configuredPath) return resolve(configuredPath);

  const criabotPath = resolve("data/criabot.sqlite");
  const legacyPath = resolve("data/botvendassl.sqlite");
  if (existsSync(legacyPath) && !existsSync(criabotPath)) return legacyPath;

  return criabotPath;
}
