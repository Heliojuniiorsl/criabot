// Server-only Telegram Bot API helpers. The bot token is read from the
// TELEGRAM_BOT_TOKEN secret and never exposed to the client.

const API_BASE = "https://api.telegram.org";

function getToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN não configurado");
  return token;
}

type InlineKeyboard = { text: string; callback_data?: string; url?: string }[][];

async function call(method: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}/bot${getToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

export function sendPhoto(
  chatId: number | string,
  photo: string,
  caption: string,
  keyboard?: InlineKeyboard,
) {
  return call("sendPhoto", {
    chat_id: chatId,
    photo,
    caption,
    parse_mode: "HTML",
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
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
    video,
    caption,
    parse_mode: "HTML",
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
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
    document,
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

export function answerCallbackQuery(callbackQueryId: string, text?: string) {
  return call("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

export type { InlineKeyboard };
