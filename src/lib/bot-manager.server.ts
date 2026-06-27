import { createHash } from "node:crypto";

import {
  findSalesBotCloneByKey,
  listSalesBotClones,
  type SalesBotClone,
} from "@/lib/sales-bot-registry.server";
import {
  deleteWebhookWithToken,
  getBotInfoWithToken,
  getBotPhotoDataUrlWithToken,
  getWebhookInfoWithToken,
  setBotCommandsMenuWithToken,
  setWebhookWithToken,
} from "@/lib/telegram.server";

export type ManagedBotKey = string;
export type ManagedBotKind = "sales" | "images";
export type ManagedBotAction = "start" | "stop" | "restart";

type ManagedBotConfig = {
  key: ManagedBotKey;
  kind: ManagedBotKind;
  token: string | null;
  tokenLabel: string;
  fallbackName: string;
  webhookPath: string;
  allowedUpdates: string[];
  commands: { command: string; description: string }[];
  isClone: boolean;
};

const salesUpdates = [
  "message",
  "channel_post",
  "callback_query",
  "my_chat_member",
  "chat_join_request",
];
const imageUpdates = ["message", "callback_query", "my_chat_member"];
const botActionLocks = new Map<ManagedBotKey, Promise<unknown>>();
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

function staticConfigs(): ManagedBotConfig[] {
  return [
    {
      key: "sales",
      kind: "sales",
      token: process.env.TELEGRAM_BOT_TOKEN?.trim() || null,
      tokenLabel: "TELEGRAM_BOT_TOKEN",
      fallbackName: "Bot de vendas",
      webhookPath: "/api/public/telegram/webhook",
      allowedUpdates: salesUpdates,
      commands: salesBotCommands,
      isClone: false,
    },
    {
      key: "images",
      kind: "images",
      token: process.env.IMAGE_BOT_TOKEN?.trim() || null,
      tokenLabel: "IMAGE_BOT_TOKEN",
      fallbackName: "Bot de imagens",
      webhookPath: "/api/public/telegram/image-webhook",
      allowedUpdates: imageUpdates,
      commands: imageBotCommands,
      isClone: false,
    },
  ];
}

function cloneConfig(clone: SalesBotClone): ManagedBotConfig {
  return {
    key: clone.key,
    kind: "sales",
    token: clone.token,
    tokenLabel: `token de @${clone.username}`,
    fallbackName: clone.display_name,
    webhookPath: "/api/public/telegram/webhook",
    allowedUpdates: salesUpdates,
    commands: salesBotCommands,
    isClone: true,
  };
}

function allConfigs(options: { ownerAccountId?: string; includeStatic?: boolean } = {}) {
  return [
    ...(options.includeStatic === false ? [] : staticConfigs()),
    ...listSalesBotClones({ ownerAccountId: options.ownerAccountId }).map(cloneConfig),
  ];
}

function resolveConfig(key: ManagedBotKey) {
  const staticConfig = staticConfigs().find((config) => config.key === key);
  if (staticConfig) return staticConfig;
  const clone = findSalesBotCloneByKey(key);
  return clone ? cloneConfig(clone) : null;
}

function getPublicBaseUrl() {
  const baseUrl = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  return baseUrl.startsWith("https://") ? baseUrl : null;
}

async function assertPublicBaseUrlReachable(baseUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    await fetch(baseUrl, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "falha de rede";
    throw new Error(
      `PUBLIC_BASE_URL nao esta acessivel pelo Telegram: ${baseUrl}. ` +
        `Atualize a URL publica atual do tunel Cloudflare. Detalhe: ${reason}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function deriveManagedBotWebhookSecret(kind: ManagedBotKind, token: string) {
  const namespace = kind === "sales" ? "telegram-webhook" : "telegram-image-webhook";
  return createHash("sha256").update(`${namespace}:${token}`).digest("base64url");
}

export function getManagedBotToken(key: ManagedBotKey) {
  return resolveConfig(key)?.token ?? null;
}

export async function listManagedBots(
  options: { ownerAccountId?: string; includeStatic?: boolean } = {},
) {
  const baseUrl = getPublicBaseUrl();

  return Promise.all(
    allConfigs(options).map(async (config) => {
      const token = config.token;
      const expectedWebhookUrl = baseUrl ? `${baseUrl}${config.webhookPath}` : null;
      const base = {
        key: config.key,
        kind: config.kind,
        is_clone: config.isClone,
        display_name: config.fallbackName,
        panel_path: null as string | null,
        configured: Boolean(token),
        telegram_name: null as string | null,
        username: null as string | null,
        photo_data_url: null as string | null,
        webhook_url: null as string | null,
        pending_updates: 0,
        status: "not_configured" as "online" | "stopped" | "error" | "not_configured",
        status_message: token ? null : `Configure ${config.tokenLabel}`,
      };
      if (!token) return base;

      try {
        const [info, webhook] = await Promise.all([
          getBotInfoWithToken(token),
          getWebhookInfoWithToken(token),
        ]);
        const photo = await getBotPhotoDataUrlWithToken(token, Number(info.id), 3_000).catch(
          () => null,
        );
        const online = Boolean(expectedWebhookUrl && webhook?.url === expectedWebhookUrl);
        const lastError = webhook?.last_error_message as string | undefined;
        const pendingUpdates = Number(webhook?.pending_update_count ?? 0);
        const lastErrorDate = Number(webhook?.last_error_date ?? 0) * 1000;
        const lastErrorIsFresh =
          Boolean(lastError) && (!lastErrorDate || Date.now() - lastErrorDate < 5 * 60_000);
        const deliveryLooksStuck = Boolean(
          lastError && (!online || (pendingUpdates > 0 && lastErrorIsFresh)),
        );
        return {
          ...base,
          display_name: info.first_name || info.username || config.fallbackName,
          panel_path: info.username ? `/${info.username}/dashboard` : null,
          telegram_name: info.first_name ?? null,
          username: info.username ?? null,
          photo_data_url: photo,
          webhook_url: webhook?.url ?? null,
          pending_updates: pendingUpdates,
          status: deliveryLooksStuck
            ? ("error" as const)
            : online
              ? ("online" as const)
              : ("stopped" as const),
          status_message:
            deliveryLooksStuck && lastError
              ? lastError
              : baseUrl
                ? online
                  ? lastError
                    ? `Webhook conectado. Ultimo erro antigo do Telegram: ${lastError}`
                    : "Webhook conectado"
                  : "Webhook desconectado"
                : "PUBLIC_BASE_URL precisa ser uma URL HTTPS",
        };
      } catch (error) {
        return {
          ...base,
          status: "error" as const,
          status_message: error instanceof Error ? error.message : "Falha ao consultar o Telegram",
        };
      }
    }),
  );
}

export async function controlManagedBot(key: ManagedBotKey, action: ManagedBotAction) {
  const activeAction = botActionLocks.get(key);
  if (activeAction) await activeAction.catch(() => undefined);

  const actionPromise = controlManagedBotUnlocked(key, action);
  const lock = actionPromise.finally(() => {
    if (botActionLocks.get(key) === lock) botActionLocks.delete(key);
  });
  botActionLocks.set(key, lock);
  return actionPromise;
}

async function controlManagedBotUnlocked(key: ManagedBotKey, action: ManagedBotAction) {
  const config = resolveConfig(key);
  if (!config) throw new Error("Bot nao encontrado");
  const token = config.token;
  if (!token) throw new Error(`Configure ${config.tokenLabel}`);

  const baseUrl = getPublicBaseUrl();
  const expectedWebhookUrl = baseUrl ? `${baseUrl}${config.webhookPath}` : null;

  if (action === "stop" || action === "restart") {
    await deleteWebhookWithToken(token);
  }
  if (action === "start" || action === "restart") {
    if (!baseUrl) throw new Error("PUBLIC_BASE_URL precisa ser uma URL publica HTTPS");
    await assertPublicBaseUrlReachable(baseUrl);
    await setWebhookWithToken(
      token,
      expectedWebhookUrl!,
      deriveManagedBotWebhookSecret(config.kind, token),
      config.allowedUpdates,
    );
    await setBotCommandsMenuWithToken(token, config.commands);
  }

  const webhook = await getWebhookInfoWithToken(token);
  if ((action === "start" || action === "restart") && webhook?.url !== expectedWebhookUrl) {
    throw new Error(
      `Telegram nao confirmou o webhook. Esperado: ${expectedWebhookUrl}. Atual: ${
        webhook?.url || "vazio"
      }`,
    );
  }
  if (action === "stop" && webhook?.url) {
    throw new Error(`Telegram ainda mostra webhook ativo: ${webhook.url}`);
  }

  return {
    ok: true,
    status: action === "stop" ? "stopped" : "online",
    status_message:
      action === "stop" ? "Webhook removido" : `Webhook conectado em ${expectedWebhookUrl}`,
    webhook_url: webhook?.url ?? null,
    pending_updates: Number(webhook?.pending_update_count ?? 0),
  };
}
