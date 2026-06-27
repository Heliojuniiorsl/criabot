import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LocalTelegramExperience } from "@/lib/telegram/local-polling";

export type LocalTelegramBot = {
  botId: string;
  token: string;
  experience: LocalTelegramExperience;
  updatedAt: string;
  enabled: boolean;
};

const storeDirectory = path.join(process.cwd(), ".criabot");
const storePath = path.join(storeDirectory, "local-bots.json");

async function readStore() {
  try {
    const content = await readFile(storePath, "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((item): LocalTelegramBot[] => {
      const isValid =
        Boolean(item) &&
        typeof item === "object" &&
        "botId" in item &&
        typeof item.botId === "string" &&
        "token" in item &&
        typeof item.token === "string" &&
        "experience" in item &&
        Boolean(item.experience);

      if (!isValid) return [];

      return [
        {
          botId: item.botId,
          token: item.token,
          experience: item.experience as LocalTelegramExperience,
          updatedAt:
            "updatedAt" in item && typeof item.updatedAt === "string"
              ? item.updatedAt
              : new Date(0).toISOString(),
          enabled:
            !("enabled" in item) ||
            typeof item.enabled !== "boolean" ||
            item.enabled,
        },
      ];
    });
  } catch {
    return [];
  }
}

export async function listLocalTelegramBots() {
  const bots = await readStore();
  return bots.filter((bot) => bot.enabled);
}

export async function findLocalTelegramBot(botId: string) {
  const bots = await readStore();
  return bots.find((bot) => bot.botId === botId) ?? null;
}

export async function saveLocalTelegramBot(input: {
  botId: string;
  token: string;
  experience: LocalTelegramExperience;
}) {
  const bots = await readStore();
  const next: LocalTelegramBot = {
    botId: input.botId,
    token: input.token,
    experience: input.experience,
    updatedAt: new Date().toISOString(),
    enabled: true,
  };
  const withoutCurrent = bots.filter((bot) => bot.botId !== input.botId);

  await mkdir(storeDirectory, { recursive: true });
  await writeFile(
    storePath,
    JSON.stringify([...withoutCurrent, next], null, 2),
    "utf8",
  );
}

export async function disableLocalTelegramBot(botId: string) {
  const bots = await readStore();
  const next = bots.map((bot) =>
    bot.botId === botId
      ? { ...bot, enabled: false, updatedAt: new Date().toISOString() }
      : bot,
  );

  await mkdir(storeDirectory, { recursive: true });
  await writeFile(storePath, JSON.stringify(next, null, 2), "utf8");
}

export async function removeLocalTelegramBot(botId: string) {
  const bots = await readStore();
  const next = bots.filter((bot) => bot.botId !== botId);

  await mkdir(storeDirectory, { recursive: true });
  await writeFile(storePath, JSON.stringify(next, null, 2), "utf8");
}
