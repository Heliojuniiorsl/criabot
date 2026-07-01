import { createHash, randomBytes, randomUUID } from "node:crypto";

import { primarySqlite as sqlite } from "@/lib/database.server";
import {
  getBotInfoWithToken,
  getBotPhotoDataUrlWithToken,
  sendMessageWithToken,
} from "@/lib/telegram.server";

type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
};

type LinkedUserRow = {
  account_id: string;
  telegram_user_id: number;
  telegram_chat_id: number;
  is_bot: number;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  language_code: string | null;
  is_premium: number;
  photo_data_url: string | null;
  raw_profile_json: string | null;
  vip_chat_id: number | null;
  vip_chat_title: string | null;
  vip_chat_username: string | null;
  vip_chat_type: string | null;
  vip_chat_message_id: number | null;
  vip_chat_detected_at: string | null;
  linked_at: string;
  updated_at: string;
};

type ForwardedVipChat = {
  id: number;
  title?: string | null;
  username?: string | null;
  type?: string | null;
};

type LinkTokenRow = {
  id: string;
  account_id: string;
  code: string;
  expires_at: string;
  used_at: string | null;
};

type CachedSiteBotInfo = {
  token: string;
  checkedAt: number;
  info: {
    id: string;
    username: string;
    display_name: string;
    photo_data_url: string | null;
  };
};

let cachedSiteBotInfo: CachedSiteBotInfo | null = null;

function nowIso() {
  return new Date().toISOString();
}

function addMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function normalizeUsername(value: unknown) {
  return String(value ?? "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase();
}

function mapLinkedUser(row: LinkedUserRow | undefined | null) {
  if (!row) return null;
  return {
    telegram_user_id: row.telegram_user_id,
    telegram_chat_id: row.telegram_chat_id,
    is_bot: Boolean(row.is_bot),
    first_name: row.first_name,
    last_name: row.last_name,
    username: row.username,
    language_code: row.language_code,
    is_premium: Boolean(row.is_premium),
    photo_data_url: row.photo_data_url,
    linked_at: row.linked_at,
    updated_at: row.updated_at,
  };
}

function mapForwardedVipChat(row: LinkedUserRow | undefined | null) {
  if (!row?.vip_chat_id) return null;
  return {
    chat_id: row.vip_chat_id,
    title: row.vip_chat_title,
    username: row.vip_chat_username,
    type: row.vip_chat_type,
    message_id: row.vip_chat_message_id,
    detected_at: row.vip_chat_detected_at,
  };
}

export function getCriaBotToken() {
  return (
    process.env.CRIABOT_TOKEN?.trim() ||
    process.env.SITE_BOT_TOKEN?.trim() ||
    process.env.criabot_token?.trim() ||
    ""
  );
}

export function getCriaBotWebhookSecret(token = getCriaBotToken()) {
  return createHash("sha256").update(`criabot-site-webhook:${token}`).digest("base64url");
}

export function isDuplicateCriaBotUpdate(updateId: number) {
  if (!Number.isFinite(updateId)) return false;
  try {
    sqlite.prepare("INSERT INTO site_bot_updates (update_id) VALUES (?)").run(updateId);
    return false;
  } catch (error) {
    const code = (error as { code?: string })?.code ?? "";
    if (code.startsWith("SQLITE_CONSTRAINT")) return true;
    throw error;
  }
}

export function getLinkedCriaBotUser(accountId: string) {
  const row = sqlite
    .prepare("SELECT * FROM site_bot_user_links WHERE account_id = ?")
    .get(accountId) as LinkedUserRow | undefined;
  return mapLinkedUser(row);
}

export function getForwardedCriaBotVipChat(accountId: string) {
  const row = sqlite
    .prepare("SELECT * FROM site_bot_user_links WHERE account_id = ?")
    .get(accountId) as LinkedUserRow | undefined;
  return mapForwardedVipChat(row);
}

function ensureFreshLinkToken(accountId: string) {
  const now = nowIso();
  const existing = sqlite
    .prepare(
      `SELECT id, account_id, code, expires_at, used_at
       FROM site_bot_link_tokens
       WHERE account_id = ? AND used_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(accountId, now) as LinkTokenRow | undefined;

  if (existing) return existing;

  const token = {
    id: randomUUID(),
    account_id: accountId,
    code: randomBytes(18).toString("base64url"),
    expires_at: addMinutes(30),
    used_at: null,
  } satisfies LinkTokenRow;

  sqlite
    .prepare(
      `INSERT INTO site_bot_link_tokens
       (id, account_id, code, expires_at, used_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(token.id, token.account_id, token.code, token.expires_at, now, now);

  return token;
}

async function getSiteBotInfo(token: string) {
  if (cachedSiteBotInfo?.token === token && Date.now() - cachedSiteBotInfo.checkedAt < 60_000) {
    return cachedSiteBotInfo.info;
  }

  const info = await getBotInfoWithToken(token);
  const username = normalizeUsername(info.username);
  if (!username) throw new Error("O bot oficial do CriaBot precisa ter @username no Telegram.");

  const photo = await getBotPhotoDataUrlWithToken(token, Number(info.id), 3_000).catch(() => null);
  cachedSiteBotInfo = {
    token,
    checkedAt: Date.now(),
    info: {
      id: String(info.id),
      username,
      display_name: String(info.first_name || username),
      photo_data_url: photo,
    },
  };

  return cachedSiteBotInfo.info;
}

export async function getCriaBotLinkStatus(accountId: string) {
  const token = getCriaBotToken();
  const linkedUser = getLinkedCriaBotUser(accountId);
  const vipChat = getForwardedCriaBotVipChat(accountId);

  if (!token) {
    return {
      configured: false,
      error: "Configure CRIABOT_TOKEN nas variáveis de ambiente.",
      bot: null,
      link_url: null,
      expires_at: null,
      linked_user: linkedUser,
      vip_chat: vipChat,
    };
  }

  try {
    const bot = await getSiteBotInfo(token);
    const linkToken = ensureFreshLinkToken(accountId);
    return {
      configured: true,
      error: null,
      bot,
      link_url: `https://t.me/${bot.username}?start=${linkToken.code}`,
      expires_at: linkToken.expires_at,
      linked_user: linkedUser,
      vip_chat: vipChat,
    };
  } catch (error) {
    return {
      configured: true,
      error: error instanceof Error ? error.message : "Não foi possível consultar o bot oficial.",
      bot: null,
      link_url: null,
      expires_at: null,
      linked_user: linkedUser,
      vip_chat: vipChat,
    };
  }
}

export async function linkCriaBotUserByCode(input: {
  code: string;
  chatId: number;
  user: TelegramUser;
}) {
  const code = input.code.trim();
  if (!code) return { ok: false as const, reason: "missing_code" as const };

  const now = nowIso();
  const linkToken = sqlite
    .prepare(
      `SELECT id, account_id, code, expires_at, used_at
       FROM site_bot_link_tokens
       WHERE code = ? AND used_at IS NULL AND expires_at > ?
       LIMIT 1`,
    )
    .get(code, now) as LinkTokenRow | undefined;

  if (!linkToken) return { ok: false as const, reason: "expired_or_invalid" as const };

  const token = getCriaBotToken();
  const photo = token
    ? await getBotPhotoDataUrlWithToken(token, Number(input.user.id), 3_000).catch(() => null)
    : null;

  sqlite
    .prepare(
      `INSERT INTO site_bot_user_links
       (account_id, telegram_user_id, telegram_chat_id, is_bot, first_name, last_name,
        username, language_code, is_premium, photo_data_url, raw_profile_json, linked_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         telegram_user_id = excluded.telegram_user_id,
         telegram_chat_id = excluded.telegram_chat_id,
         is_bot = excluded.is_bot,
         first_name = excluded.first_name,
         last_name = excluded.last_name,
         username = excluded.username,
         language_code = excluded.language_code,
         is_premium = excluded.is_premium,
         photo_data_url = excluded.photo_data_url,
         raw_profile_json = excluded.raw_profile_json,
         linked_at = excluded.linked_at,
         updated_at = excluded.updated_at`,
    )
    .run(
      linkToken.account_id,
      input.user.id,
      input.chatId,
      input.user.is_bot ? 1 : 0,
      input.user.first_name ?? null,
      input.user.last_name ?? null,
      normalizeUsername(input.user.username) || null,
      input.user.language_code ?? null,
      input.user.is_premium ? 1 : 0,
      photo,
      JSON.stringify(input.user),
      now,
      now,
    );

  sqlite
    .prepare("UPDATE site_bot_link_tokens SET used_at = ?, updated_at = ? WHERE id = ?")
    .run(now, now, linkToken.id);

  return {
    ok: true as const,
    linked_user: getLinkedCriaBotUser(linkToken.account_id),
  };
}

export function saveCriaBotForwardedVipChat(input: {
  telegramUserId: number;
  telegramChatId: number;
  chat: ForwardedVipChat;
  messageId?: number | null;
}) {
  const chatId = Number(input.chat.id);
  if (!Number.isFinite(chatId)) {
    return { ok: false as const, reason: "invalid_chat" as const, updated: 0 };
  }

  const now = nowIso();
  const result = sqlite
    .prepare(
      `UPDATE site_bot_user_links
       SET vip_chat_id = ?,
           vip_chat_title = ?,
           vip_chat_username = ?,
           vip_chat_type = ?,
           vip_chat_message_id = ?,
           vip_chat_detected_at = ?,
           updated_at = ?
       WHERE telegram_user_id = ? AND telegram_chat_id = ?`,
    )
    .run(
      chatId,
      input.chat.title || input.chat.username || null,
      normalizeUsername(input.chat.username) || null,
      input.chat.type || null,
      input.messageId ?? null,
      now,
      now,
      input.telegramUserId,
      input.telegramChatId,
    );

  return {
    ok: result.changes > 0,
    reason: result.changes > 0 ? null : ("not_linked" as const),
    updated: result.changes,
    vip_chat: {
      chat_id: chatId,
      title: input.chat.title || input.chat.username || null,
      username: normalizeUsername(input.chat.username) || null,
      type: input.chat.type || null,
      message_id: input.messageId ?? null,
      detected_at: now,
    },
  };
}

export async function sendCriaBotMessage(
  chatId: number | string,
  text: string,
  keyboard?: Parameters<typeof sendMessageWithToken>[3],
) {
  const token = getCriaBotToken();
  if (!token) throw new Error("CRIABOT_TOKEN não configurado");
  return sendMessageWithToken(token, chatId, text, keyboard);
}
