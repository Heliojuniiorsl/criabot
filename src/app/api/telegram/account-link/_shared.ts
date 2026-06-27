import "server-only";

import type { Json } from "@/lib/supabase/database.types";
import {
  deleteWebhookWithToken,
  formatTelegramError,
  getBotInfoWithToken,
  getUpdatesWithToken,
  getUserPhotoDataUrlWithToken,
  sendMessageWithToken,
  TelegramApiError,
  type TelegramUpdate,
} from "@/lib/telegram/api";

export type TelegramOfficialBot = {
  id: string;
  username: string;
  name: string;
};

export type TelegramLinkedUser = {
  id: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
  isPremium: boolean | null;
  avatarDataUrl: string | null;
  linkedAt: string | null;
};

type TelegramUpdateUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
};

type TelegramAccountUpdate = TelegramUpdate & {
  message?: {
    message_id: number;
    text?: string;
    chat: {
      id: number;
      type: string;
    };
    from?: TelegramUpdateUser;
  };
};

export function getOfficialBotToken() {
  return process.env.CRIABOT_OFFICIAL_TELEGRAM_BOT_TOKEN ?? null;
}

export function getTelegramWebhookSecret() {
  return process.env.CRIABOT_OFFICIAL_TELEGRAM_WEBHOOK_SECRET ?? null;
}

export function makePublicLinkCode() {
  return crypto.randomUUID().replaceAll("-", "");
}

export function getExpiresAt() {
  return new Date(Date.now() + 15 * 60 * 1000).toISOString();
}

export function mapTelegramUser(row: {
  telegram_user_id: number | null;
  telegram_first_name: string | null;
  telegram_last_name: string | null;
  telegram_username: string | null;
  telegram_language_code: string | null;
  telegram_is_premium: boolean | null;
  linked_at: string | null;
}): TelegramLinkedUser | null {
  if (!row.telegram_user_id || !row.telegram_first_name) return null;

  return {
    id: String(row.telegram_user_id),
    firstName: row.telegram_first_name,
    lastName: row.telegram_last_name,
    username: row.telegram_username,
    languageCode: row.telegram_language_code,
    isPremium: row.telegram_is_premium,
    avatarDataUrl: null,
    linkedAt: row.linked_at,
  };
}

export async function prepareOfficialBotPolling() {
  const token = getOfficialBotToken();
  if (!token) {
    throw new Error("O bot oficial ainda não foi configurado.");
  }

  await deleteWebhookWithToken(token, false).catch((error) => {
    throw new Error(
      formatTelegramError(
        error,
        "Não foi possível preparar o bot oficial para receber a vinculação.",
      ),
    );
  });
}

export async function findTelegramStartUser(linkCode: string) {
  const token = getOfficialBotToken();
  if (!token) return null;

  const updates = await getUpdatesWithToken<TelegramAccountUpdate>(token, {
    offset: -100,
    limit: 100,
    timeout: 0,
    allowedUpdates: ["message"],
  }).catch(async (error) => {
    if (
      error instanceof TelegramApiError &&
      error.description?.includes("webhook is active")
    ) {
      await prepareOfficialBotPolling();
      return null;
    }

    throw new Error(
      formatTelegramError(
        error,
        "Não foi possível verificar a confirmação no Telegram.",
      ),
    );
  });

  if (!updates) return null;

  for (const update of [...updates].reverse()) {
    const message = update.message;
    const telegramUser = message?.from;
    if (!message?.text || !telegramUser || telegramUser.is_bot) continue;

    const match = message.text
      .trim()
      .match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([A-Za-z0-9_-]+))?$/);
    if (match?.[1] !== linkCode) continue;

    return {
      telegramUser,
      chatId: message.chat.id,
    };
  }

  return null;
}

export async function getOfficialBot(): Promise<TelegramOfficialBot> {
  const token = getOfficialBotToken();
  if (!token) {
    throw new Error("O bot oficial ainda não foi configurado.");
  }

  const bot = await getBotInfoWithToken(token).catch((error) => {
    throw new Error(
      formatTelegramError(
        error,
        "Não foi possível identificar o bot oficial do CriaBot.",
      ),
    );
  });

  if (!bot.is_bot || !bot.username) {
    throw new Error("O token configurado não pertence a um bot válido.");
  }

  return {
    id: String(bot.id),
    username: bot.username,
    name: bot.first_name,
  };
}

export async function getTelegramAvatarDataUrl(userId: number) {
  const token = getOfficialBotToken();
  if (!token) return null;

  return getUserPhotoDataUrlWithToken(token, userId).catch(() => null);
}

export function makeRawTelegramUser(value: unknown): Json {
  if (!value || typeof value !== "object") return {};
  return JSON.parse(JSON.stringify(value)) as Json;
}

export async function sendTelegramMessage(chatId: number, text: string) {
  const token = getOfficialBotToken();
  if (!token) return;

  await sendMessageWithToken(token, chatId, text).catch(() => undefined);
}
