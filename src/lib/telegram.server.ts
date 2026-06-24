// Server-only Telegram Bot API helpers. Bot tokens are never exposed to the client.

import {
  getActiveSalesBotPublicBaseUrl,
  getActiveSalesBotToken,
} from "@/lib/sales-bot-runtime.server";

const API_BASE = "https://api.telegram.org";
const TELEGRAM_API_TIMEOUT_MS = 12_000;
const TELEGRAM_RETRY_ATTEMPTS = 2;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function telegramRetryDelay(data: any) {
  if (Number(data?.error_code) !== 429) return 0;
  const retryAfter = Number(data?.parameters?.retry_after ?? 1);
  return Math.min(Math.max(retryAfter, 1), 5) * 1000 + 150;
}

function createTimeoutSignal(timeoutMs = TELEGRAM_API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

export function resolveTelegramFileReference(
  value: string,
  publicBaseUrl = getActiveSalesBotPublicBaseUrl(),
) {
  const baseUrl = publicBaseUrl?.replace(/\/$/, "");
  if (value.startsWith("/") && baseUrl) return `${baseUrl}${value}`;
  if (!baseUrl) return value;
  try {
    const url = new URL(value);
    if (url.pathname.startsWith("/api/public/media/")) {
      return `${baseUrl}${url.pathname}${url.search}`;
    }
  } catch {
    return value;
  }
  return value;
}

function getToken(): string {
  const token = getActiveSalesBotToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN não configurado");
  return token;
}

type InlineKeyboard = {
  text: string;
  style?: "danger" | "success" | "primary";
  callback_data?: string;
  url?: string;
  copy_text?: { text: string };
}[][];

type ReplyKeyboard = {
  keyboard: { text: string }[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  is_persistent?: boolean;
  input_field_placeholder?: string;
};

async function call(method: string, body: Record<string, unknown>) {
  for (let attempt = 0; attempt <= TELEGRAM_RETRY_ATTEMPTS; attempt++) {
    const timeout = createTimeoutSignal();
    try {
      const res = await fetch(`${API_BASE}/bot${getToken()}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: timeout.signal,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const retryDelay = telegramRetryDelay(data);
        if (retryDelay && attempt < TELEGRAM_RETRY_ATTEMPTS) {
          timeout.clear();
          await sleep(retryDelay);
          continue;
        }
        throw new Error(`[Telegram] ${method} falhou: ${JSON.stringify(data)}`);
      }
      return data;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`[Telegram] ${method} demorou demais para responder`);
      }
      throw error;
    } finally {
      timeout.clear();
    }
  }
  throw new Error(`[Telegram] ${method} falhou`);
}

async function callWithToken(
  token: string,
  method: string,
  body: Record<string, unknown>,
  timeoutMs = TELEGRAM_API_TIMEOUT_MS,
) {
  for (let attempt = 0; attempt <= TELEGRAM_RETRY_ATTEMPTS; attempt++) {
    const timeout = createTimeoutSignal(timeoutMs);
    try {
      const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: timeout.signal,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const retryDelay = telegramRetryDelay(data);
        if (retryDelay && attempt < TELEGRAM_RETRY_ATTEMPTS) {
          timeout.clear();
          await sleep(retryDelay);
          continue;
        }
        throw new Error(`[Telegram] ${method} falhou: ${JSON.stringify(data)}`);
      }
      return data;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`[Telegram] ${method} demorou demais para responder`);
      }
      throw error;
    } finally {
      timeout.clear();
    }
  }
  throw new Error(`[Telegram] ${method} falhou`);
}

async function callMultipart(method: string, body: FormData) {
  const res = await fetch(`${API_BASE}/bot${getToken()}/${method}`, {
    method: "POST",
    body,
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(`[Telegram] ${method} falhou: ${JSON.stringify(data)}`);
  }
  return data;
}

export function sendMessage(chatId: number | string, text: string, keyboard?: InlineKeyboard) {
  return call("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export function sendMessageWithToken(
  token: string,
  chatId: number | string,
  text: string,
  keyboard?: InlineKeyboard,
) {
  return callWithToken(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export function sendMessageWithTokenReplyKeyboard(
  token: string,
  chatId: number | string,
  text: string,
  keyboard: ReplyKeyboard,
) {
  return callWithToken(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: keyboard,
  });
}

export async function clearReplyKeyboardWithToken(token: string, chatId: number | string) {
  const response = await callWithToken(token, "sendMessage", {
    chat_id: chatId,
    text: "Teclado removido.",
    disable_notification: true,
    reply_markup: { remove_keyboard: true },
  });
  const messageId = response.result?.message_id;
  if (messageId) {
    await callWithToken(token, "deleteMessage", {
      chat_id: chatId,
      message_id: messageId,
    });
  }
}

export function sendPhoto(
  chatId: number | string,
  photo: string,
  caption: string,
  keyboard?: InlineKeyboard,
) {
  return call("sendPhoto", {
    chat_id: chatId,
    photo: resolveTelegramFileReference(photo),
    caption,
    parse_mode: "HTML",
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export function sendPhotoWithToken(
  token: string,
  chatId: number | string,
  photo: string,
  caption: string,
  keyboard?: InlineKeyboard,
) {
  return callWithToken(token, "sendPhoto", {
    chat_id: chatId,
    photo: resolveTelegramFileReference(photo),
    ...(caption ? { caption, parse_mode: "HTML" } : {}),
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export function sendPhotoWithTokenReplyKeyboard(
  token: string,
  chatId: number | string,
  photo: string,
  caption: string,
  keyboard: ReplyKeyboard,
) {
  return callWithToken(token, "sendPhoto", {
    chat_id: chatId,
    photo: resolveTelegramFileReference(photo),
    ...(caption ? { caption, parse_mode: "HTML" } : {}),
    reply_markup: keyboard,
  });
}

export function sendPhotoBuffer(
  chatId: number | string,
  bytes: Uint8Array,
  filename: string,
  caption: string,
  keyboard?: InlineKeyboard,
) {
  const body = new FormData();
  const imageBytes = Uint8Array.from(bytes);
  body.set("chat_id", String(chatId));
  body.set("photo", new Blob([imageBytes.buffer], { type: "image/png" }), filename);
  body.set("caption", caption);
  body.set("parse_mode", "HTML");
  if (keyboard) body.set("reply_markup", JSON.stringify({ inline_keyboard: keyboard }));
  return callMultipart("sendPhoto", body);
}

export function sendPhotoBufferWithToken(
  token: string,
  chatId: number | string,
  bytes: Uint8Array,
  filename: string,
  caption: string,
  keyboard?: InlineKeyboard,
) {
  const body = new FormData();
  const imageBytes = Uint8Array.from(bytes);
  body.set("chat_id", String(chatId));
  body.set("photo", new Blob([imageBytes.buffer], { type: "image/png" }), filename);
  body.set("caption", caption);
  body.set("parse_mode", "HTML");
  if (keyboard) body.set("reply_markup", JSON.stringify({ inline_keyboard: keyboard }));
  return fetch(`${API_BASE}/bot${token}/sendPhoto`, {
    method: "POST",
    body,
  }).then(async (res) => {
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(`[Telegram] sendPhoto falhou: ${JSON.stringify(data)}`);
    }
    return data;
  });
}

export function sendVideo(
  chatId: number | string,
  video: string,
  caption: string,
  keyboard?: InlineKeyboard,
) {
  return call("sendVideo", {
    chat_id: chatId,
    video: resolveTelegramFileReference(video),
    caption,
    parse_mode: "HTML",
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export function sendVideoWithToken(
  token: string,
  chatId: number | string,
  video: string,
  caption: string,
  keyboard?: InlineKeyboard,
) {
  return callWithToken(token, "sendVideo", {
    chat_id: chatId,
    video: resolveTelegramFileReference(video),
    ...(caption ? { caption, parse_mode: "HTML" } : {}),
    supports_streaming: true,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export function copyMessageWithToken(
  token: string,
  chatId: number | string,
  fromChatId: number | string,
  messageId: number,
  keyboard?: InlineKeyboard,
) {
  return callWithToken(token, "copyMessage", {
    chat_id: chatId,
    from_chat_id: fromChatId,
    message_id: messageId,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export function copyMessage(
  chatId: number | string,
  fromChatId: number | string,
  messageId: number,
  keyboard?: InlineKeyboard,
) {
  return call("copyMessage", {
    chat_id: chatId,
    from_chat_id: fromChatId,
    message_id: messageId,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export function editMessageReplyMarkup(
  chatId: number | string,
  messageId: number,
  keyboard: InlineKeyboard,
) {
  return call("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: keyboard },
  });
}

export function editMessageMediaWithToken(
  token: string,
  chatId: number | string,
  messageId: number,
  media: { type: "photo" | "video"; media: string },
  keyboard?: InlineKeyboard,
) {
  return callWithToken(token, "editMessageMedia", {
    chat_id: chatId,
    message_id: messageId,
    media: {
      type: media.type,
      media: resolveTelegramFileReference(media.media),
      ...(media.type === "video" ? { supports_streaming: true } : {}),
    },
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export function editMessageReplyMarkupWithToken(
  token: string,
  chatId: number | string,
  messageId: number,
  keyboard: InlineKeyboard,
) {
  return callWithToken(token, "editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: keyboard },
  });
}

export function deleteMessageWithToken(token: string, chatId: number | string, messageId: number) {
  return callWithToken(token, "deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  });
}

export function deleteMessage(chatId: number | string, messageId: number) {
  return call("deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  });
}

export function sendVideoWithTokenReplyKeyboard(
  token: string,
  chatId: number | string,
  video: string,
  caption: string,
  keyboard: ReplyKeyboard,
) {
  return callWithToken(token, "sendVideo", {
    chat_id: chatId,
    video: resolveTelegramFileReference(video),
    ...(caption ? { caption, parse_mode: "HTML" } : {}),
    supports_streaming: true,
    reply_markup: keyboard,
  });
}

export function sendDocument(
  chatId: number | string,
  document: string,
  caption: string,
  keyboard?: InlineKeyboard,
) {
  return call("sendDocument", {
    chat_id: chatId,
    document: resolveTelegramFileReference(document),
    caption,
    parse_mode: "HTML",
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export function editMessageText(
  chatId: number | string,
  messageId: number,
  text: string,
  keyboard?: InlineKeyboard,
) {
  return call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export function editMessageTextWithToken(
  token: string,
  chatId: number | string,
  messageId: number,
  text: string,
  keyboard?: InlineKeyboard,
) {
  return callWithToken(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export function editMessageCaption(
  chatId: number | string,
  messageId: number,
  caption: string,
  keyboard?: InlineKeyboard,
) {
  return call("editMessageCaption", {
    chat_id: chatId,
    message_id: messageId,
    caption,
    parse_mode: "HTML",
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export async function getChatMemberCount(chatId: number | string) {
  const response = await call("getChatMemberCount", { chat_id: chatId });
  return Number(response.result);
}

export async function getChatMemberCountWithToken(token: string, chatId: number | string) {
  const response = await callWithToken(token, "getChatMemberCount", { chat_id: chatId });
  return Number(response.result);
}

export function getChatMemberWithToken(
  token: string,
  chatId: number | string,
  userId: number | string,
) {
  return callWithToken(token, "getChatMember", {
    chat_id: chatId,
    user_id: userId,
  }).then(
    (response) =>
      response.result as {
        status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
      },
  );
}

export function leaveChatWithToken(token: string, chatId: number | string) {
  return callWithToken(token, "leaveChat", { chat_id: chatId });
}

export function answerCallbackQuery(callbackQueryId: string, text?: string, showAlert = false) {
  return call("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
    show_alert: showAlert,
  });
}

export function answerCallbackQueryWithToken(
  token: string,
  callbackQueryId: string,
  text?: string,
  showAlert = false,
) {
  return callWithToken(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
    show_alert: showAlert,
  });
}

export function createChatJoinRequestInvite(
  chatId: number | string,
  name: string,
  expiresAt: Date,
) {
  return call("createChatInviteLink", {
    chat_id: chatId,
    name: name.slice(0, 32),
    expire_date: Math.floor(expiresAt.getTime() / 1000),
    creates_join_request: true,
  }).then((response) => response.result as { invite_link: string; expire_date?: number });
}

export function approveChatJoinRequest(chatId: number | string, userId: number) {
  return call("approveChatJoinRequest", { chat_id: chatId, user_id: userId });
}

export function declineChatJoinRequest(chatId: number | string, userId: number) {
  return call("declineChatJoinRequest", { chat_id: chatId, user_id: userId });
}

export function revokeChatInviteLink(chatId: number | string, inviteLink: string) {
  return call("revokeChatInviteLink", { chat_id: chatId, invite_link: inviteLink });
}

export function getBotInfoWithToken(token: string) {
  return callWithToken(token, "getMe", {}).then((response) => response.result);
}

export function getWebhookInfoWithToken(token: string) {
  return callWithToken(token, "getWebhookInfo", {}).then((response) => response.result);
}

export function setWebhookWithToken(
  token: string,
  url: string,
  secretToken: string,
  allowedUpdates: string[],
) {
  return callWithToken(token, "setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: allowedUpdates,
    max_connections: 40,
    drop_pending_updates: false,
  });
}

export function deleteWebhookWithToken(token: string) {
  return callWithToken(token, "deleteWebhook", { drop_pending_updates: false });
}

export async function getBotPhotoDataUrlWithToken(
  token: string,
  userId: number,
  timeoutMs = TELEGRAM_API_TIMEOUT_MS,
) {
  const photos = await callWithToken(
    token,
    "getUserProfilePhotos",
    {
      user_id: userId,
      offset: 0,
      limit: 1,
    },
    timeoutMs,
  );
  const sizes = photos.result?.photos?.[0];
  if (!Array.isArray(sizes) || !sizes.length) return null;

  const largest = sizes[sizes.length - 1];
  const file = await callWithToken(token, "getFile", { file_id: largest.file_id }, timeoutMs);
  const filePath = file.result?.file_path;
  if (!filePath) return null;

  const timeout = createTimeoutSignal();
  try {
    const response = await fetch(`${API_BASE}/file/bot${token}/${filePath}`, {
      signal: timeout.signal,
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  } finally {
    timeout.clear();
  }
}

export async function fetchTelegramFileWithToken(
  token: string,
  fileId: string,
  range?: string | null,
) {
  const file = await callWithToken(token, "getFile", { file_id: fileId });
  const filePath = file.result?.file_path as string | undefined;
  if (!filePath) throw new Error("Arquivo do Telegram não encontrado");

  const response = await fetch(`${API_BASE}/file/bot${token}/${filePath}`, {
    headers: range ? { Range: range } : undefined,
  });
  if (!response.ok) throw new Error("Não foi possível baixar o arquivo do Telegram");
  return response;
}

export type { InlineKeyboard, ReplyKeyboard };
