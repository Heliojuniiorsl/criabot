import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const publicUrl = String(process.argv[2] ?? "").replace(/\/$/, "");
if (!publicUrl.startsWith("https://")) process.exit(0);

const clones = [];
const deprecatedUsernames = new Set(["bruninhabb_bot"]);
const salesBotCommands = [
  { command: "start", description: "Abrir planos e ofertas" },
  { command: "planos", description: "Ver planos disponiveis" },
  { command: "ofertas", description: "Ver ofertas ativas" },
  { command: "meus_acessos", description: "Ver meus acessos VIP" },
  { command: "suporte", description: "Falar com suporte" },
];

function resolveSalesDatabasePath() {
  const configuredPath = process.env.DATABASE_PATH?.trim();
  if (configuredPath) return resolve(configuredPath);

  const criabotPath = resolve("data/criabot.sqlite");
  const legacyPath = resolve("data/botvendassl.sqlite");
  if (existsSync(legacyPath) && !existsSync(criabotPath)) return legacyPath;

  return criabotPath;
}

async function telegramPost(token, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(`Telegram recusou ${method}`);
  }
}

const primaryDatabasePath = resolveSalesDatabasePath();
const registryPath = resolve(
  process.env.BOT_REGISTRY_PATH ?? dirname(primaryDatabasePath),
  process.env.BOT_REGISTRY_PATH ? "" : "bot-registry.sqlite",
);
if (existsSync(registryPath)) {
  const registry = new Database(registryPath, { readonly: true });
  const managedTable = registry
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'managed_sales_bots'")
    .get();
  if (managedTable) {
    clones.push(
      ...registry
        .prepare("SELECT username, token FROM managed_sales_bots")
        .all()
        .filter((clone) => !deprecatedUsernames.has(String(clone.username).toLowerCase())),
    );
  }
  const legacyTable = registry
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sales_bot_clones'")
    .get();
  if (legacyTable) {
    const seen = new Set(clones.map((clone) => String(clone.username).toLowerCase()));
    clones.push(
      ...registry
        .prepare("SELECT username, token FROM sales_bot_clones")
        .all()
        .filter((clone) => !deprecatedUsernames.has(String(clone.username).toLowerCase()))
        .filter((clone) => {
          const username = String(clone.username).toLowerCase();
          if (seen.has(username)) return false;
          seen.add(username);
          return true;
        }),
    );
  }
  registry.close();
}

if (!clones.length) {
  process.exit(0);
}

for (const clone of clones) {
  const secret = createHash("sha256").update(`telegram-webhook:${clone.token}`).digest("base64url");
  await telegramPost(clone.token, "setWebhook", {
    url: `${publicUrl}/api/public/telegram/webhook`,
    secret_token: secret,
    allowed_updates: [
      "message",
      "channel_post",
      "callback_query",
      "my_chat_member",
      "chat_join_request",
    ],
    drop_pending_updates: false,
  });
  await telegramPost(clone.token, "setMyCommands", { commands: salesBotCommands });
  await telegramPost(clone.token, "setChatMenuButton", { menu_button: { type: "commands" } });
  console.log(`[local] Clone @${clone.username} conectado.`);
}
