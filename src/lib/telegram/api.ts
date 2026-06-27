import "server-only";

const API_BASE = "https://api.telegram.org";
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRY_ATTEMPTS = 2;

export const TELEGRAM_TOKEN_PATTERN = /^\d{6,}:[A-Za-z0-9_-]{20,}$/;

type TelegramRetryParameters = {
  retry_after?: number;
  migrate_to_chat_id?: number;
};

type TelegramApiPayload<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: TelegramRetryParameters;
};

export type TelegramInlineKeyboardButton = {
  text: string;
  callback_data?: string;
  url?: string;
  copy_text?: { text: string };
};

export type TelegramInlineKeyboard = TelegramInlineKeyboardButton[][];

export type TelegramReplyKeyboard = {
  keyboard: { text: string }[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  is_persistent?: boolean;
  input_field_placeholder?: string;
};

export type TelegramBotInfo = {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
};

export type TelegramChat = {
  id: number;
  title?: string;
  username?: string;
  type: "private" | "group" | "supergroup" | "channel";
  invite_link?: string;
};

export type TelegramChatMember = {
  status:
    | "creator"
    | "administrator"
    | "member"
    | "restricted"
    | "left"
    | "kicked";
  user: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
  };
  can_invite_users?: boolean;
  can_restrict_members?: boolean;
  can_delete_messages?: boolean;
  can_manage_chat?: boolean;
};

export type TelegramUpdate = {
  update_id: number;
  [key: string]: unknown;
};

export type TelegramWebhookInfo = {
  url?: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  last_synchronization_error_date?: number;
  max_connections?: number;
  allowed_updates?: string[];
};

export class TelegramApiError extends Error {
  readonly method: string;
  readonly statusCode?: number;
  readonly errorCode?: number;
  readonly description?: string;
  readonly payload?: unknown;
  readonly userMessage: string;

  constructor(
    method: string,
    options: {
      statusCode?: number;
      errorCode?: number;
      description?: string;
      payload?: unknown;
      cause?: unknown;
      userMessage?: string;
    },
  ) {
    const description = options.description || "Falha ao chamar a API do Telegram.";
    super(`[Telegram] ${method}: ${description}`, { cause: options.cause });
    this.name = "TelegramApiError";
    this.method = method;
    this.statusCode = options.statusCode;
    this.errorCode = options.errorCode;
    this.description = options.description;
    this.payload = options.payload;
    this.userMessage =
      options.userMessage ?? getTelegramErrorMessage(options.description);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTimeoutSignal(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

function retryDelay(payload: TelegramApiPayload<unknown> | null) {
  if (Number(payload?.error_code) !== 429) return 0;
  const retryAfter = Number(payload?.parameters?.retry_after ?? 1);
  return Math.min(Math.max(retryAfter, 1), 5) * 1000 + 150;
}

function endpoint(token: string, method: string) {
  return `${API_BASE}/bot${token}/${method}`;
}

export function getTelegramErrorMessage(description?: string, fallback?: string) {
  const text = description?.toLowerCase() ?? "";

  if (text.includes("unauthorized") || text.includes("not found")) {
    return "Token inválido. Copie novamente o token enviado pelo BotFather.";
  }

  if (text.includes("kicked")) {
    return "O bot foi removido do grupo/canal. Adicione o bot novamente e promova como administrador.";
  }

  if (text.includes("not enough rights") || text.includes("have no rights")) {
    return "O bot ainda não tem permissão suficiente. Promova o bot a administrador e tente novamente.";
  }

  if (
    text.includes("not a member") ||
    text.includes("user not found") ||
    text.includes("participant_id_invalid")
  ) {
    return "O bot ainda não está no grupo/canal. Adicione o bot e tente verificar novamente.";
  }

  if (text.includes("chat not found")) {
    return "Não encontrei o grupo/canal. Adicione o bot e tente verificar novamente.";
  }

  if (text.includes("webhook is active")) {
    return "O webhook do bot está ativo. Removi a conexão anterior; tente verificar novamente.";
  }

  return (
    fallback ??
    "Não foi possível falar com o Telegram agora. Confira os dados e tente novamente."
  );
}

export function normalizeTelegramUsername(username: string) {
  return `@${username.replace(/^@+/, "").trim()}`;
}

export function formatTelegramError(error: unknown, fallback?: string) {
  if (error instanceof TelegramApiError) {
    return error.userMessage;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return "O Telegram demorou demais para responder. Tente novamente.";
  }

  return fallback ?? "Não foi possível completar a ação no Telegram.";
}

export async function callTelegram<T = unknown>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
  options: { timeoutMs?: number; retryAttempts?: number } = {},
) {
  const retryAttempts = options.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS;

  for (let attempt = 0; attempt <= retryAttempts; attempt++) {
    const timeout = createTimeoutSignal(options.timeoutMs);
    try {
      const response = await fetch(endpoint(token, method), {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
        signal: timeout.signal,
      });
      const payload = (await response.json().catch(() => null)) as
        | TelegramApiPayload<T>
        | null;

      if (!response.ok || !payload?.ok) {
        const delay = retryDelay(payload);
        if (delay && attempt < retryAttempts) {
          timeout.clear();
          await sleep(delay);
          continue;
        }

        throw new TelegramApiError(method, {
          statusCode: response.status,
          errorCode: payload?.error_code,
          description: payload?.description,
          payload,
        });
      }

      return payload.result as T;
    } catch (error) {
      if (error instanceof TelegramApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new TelegramApiError(method, {
          cause: error,
          userMessage: "O Telegram demorou demais para responder. Tente novamente.",
          description: "Tempo limite excedido.",
        });
      }
      throw new TelegramApiError(method, {
        cause: error,
        description:
          error instanceof Error ? error.message : "Falha de rede no Telegram.",
      });
    } finally {
      timeout.clear();
    }
  }

  throw new TelegramApiError(method, {
    description: "Falha ao chamar a API do Telegram.",
  });
}

export async function tryTelegram<T = unknown>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
  options?: { timeoutMs?: number; retryAttempts?: number },
) {
  try {
    return {
      ok: true as const,
      result: await callTelegram<T>(token, method, body, options),
    };
  } catch (error) {
    return {
      ok: false as const,
      error,
      message: formatTelegramError(error),
    };
  }
}

export function getBotInfoWithToken(token: string) {
  return callTelegram<TelegramBotInfo>(token, "getMe");
}

export function getWebhookInfoWithToken(token: string) {
  return callTelegram<TelegramWebhookInfo>(token, "getWebhookInfo");
}

export function deleteWebhookWithToken(
  token: string,
  dropPendingUpdates = false,
) {
  return callTelegram<boolean>(token, "deleteWebhook", {
    drop_pending_updates: dropPendingUpdates,
  });
}

export function setWebhookWithToken(
  token: string,
  input: {
    url: string;
    secretToken?: string;
    allowedUpdates?: string[];
    dropPendingUpdates?: boolean;
    maxConnections?: number;
  },
) {
  return callTelegram<boolean>(token, "setWebhook", {
    url: input.url,
    ...(input.secretToken ? { secret_token: input.secretToken } : {}),
    ...(input.allowedUpdates ? { allowed_updates: input.allowedUpdates } : {}),
    drop_pending_updates: input.dropPendingUpdates ?? false,
    max_connections: input.maxConnections ?? 40,
  });
}

export async function setBotCommandsMenuWithToken(
  token: string,
  commands: { command: string; description: string }[],
) {
  await callTelegram<boolean>(token, "setMyCommands", { commands });
  await callTelegram<boolean>(token, "setChatMenuButton", {
    menu_button: { type: "commands" },
  });
}

export function sendMessageWithToken(
  token: string,
  chatId: number | string,
  text: string,
  keyboard?: TelegramInlineKeyboard,
) {
  return callTelegram(token, "sendMessage", {
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
  keyboard: TelegramReplyKeyboard,
) {
  return callTelegram(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: keyboard,
  });
}

export async function clearReplyKeyboardWithToken(
  token: string,
  chatId: number | string,
) {
  const response = (await callTelegram<{ message_id?: number }>(
    token,
    "sendMessage",
    {
      chat_id: chatId,
      text: "Teclado removido.",
      disable_notification: true,
      reply_markup: { remove_keyboard: true },
    },
  )) as { message_id?: number };

  if (response.message_id) {
    await callTelegram<boolean>(token, "deleteMessage", {
      chat_id: chatId,
      message_id: response.message_id,
    }).catch(() => undefined);
  }
}

export function sendPhotoWithToken(
  token: string,
  chatId: number | string,
  photo: string,
  caption?: string,
  keyboard?: TelegramInlineKeyboard,
) {
  return callTelegram(token, "sendPhoto", {
    chat_id: chatId,
    photo,
    ...(caption ? { caption, parse_mode: "HTML" } : {}),
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export function sendVideoWithToken(
  token: string,
  chatId: number | string,
  video: string,
  caption?: string,
  keyboard?: TelegramInlineKeyboard,
) {
  return callTelegram(token, "sendVideo", {
    chat_id: chatId,
    video,
    ...(caption ? { caption, parse_mode: "HTML" } : {}),
    supports_streaming: true,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export function answerCallbackQueryWithToken(
  token: string,
  callbackQueryId: string,
  text?: string,
  showAlert = false,
) {
  return callTelegram<boolean>(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
    show_alert: showAlert,
  });
}

export function getUpdatesWithToken<T extends TelegramUpdate = TelegramUpdate>(
  token: string,
  input: {
    offset?: number;
    limit?: number;
    timeout?: number;
    allowedUpdates?: string[];
  } = {},
) {
  return callTelegram<T[]>(token, "getUpdates", {
    ...(input.offset !== undefined ? { offset: input.offset } : {}),
    limit: input.limit ?? 100,
    timeout: input.timeout ?? 0,
    ...(input.allowedUpdates
      ? { allowed_updates: input.allowedUpdates }
      : {}),
  });
}

export function getChatWithToken(token: string, chatId: number | string) {
  return callTelegram<TelegramChat>(token, "getChat", { chat_id: chatId });
}

export function getChatMemberWithToken(
  token: string,
  chatId: number | string,
  userId: number | string,
) {
  return callTelegram<TelegramChatMember>(token, "getChatMember", {
    chat_id: chatId,
    user_id: userId,
  });
}

export function getChatMemberCountWithToken(
  token: string,
  chatId: number | string,
) {
  return callTelegram<number>(token, "getChatMemberCount", { chat_id: chatId });
}

export function createChatJoinRequestInviteWithToken(
  token: string,
  chatId: number | string,
  name: string,
  expiresAt: Date,
) {
  return callTelegram<{ invite_link: string; expire_date?: number }>(
    token,
    "createChatInviteLink",
    {
      chat_id: chatId,
      name: name.slice(0, 32),
      expire_date: Math.floor(expiresAt.getTime() / 1000),
      creates_join_request: true,
    },
  );
}

export function approveChatJoinRequestWithToken(
  token: string,
  chatId: number | string,
  userId: number,
) {
  return callTelegram<boolean>(token, "approveChatJoinRequest", {
    chat_id: chatId,
    user_id: userId,
  });
}

export function declineChatJoinRequestWithToken(
  token: string,
  chatId: number | string,
  userId: number,
) {
  return callTelegram<boolean>(token, "declineChatJoinRequest", {
    chat_id: chatId,
    user_id: userId,
  });
}

export function revokeChatInviteLinkWithToken(
  token: string,
  chatId: number | string,
  inviteLink: string,
) {
  return callTelegram<boolean>(token, "revokeChatInviteLink", {
    chat_id: chatId,
    invite_link: inviteLink,
  });
}

async function getFilePathWithToken(token: string, fileId: string) {
  const file = await callTelegram<{ file_path?: string }>(token, "getFile", {
    file_id: fileId,
  });
  return file.file_path ?? null;
}

async function downloadFileAsDataUrl(
  token: string,
  filePath: string,
  maxBytes: number,
) {
  const timeout = createTimeoutSignal();
  try {
    const response = await fetch(`${API_BASE}/file/bot${token}/${filePath}`, {
      cache: "no-store",
      signal: timeout.signal,
    });
    if (!response.ok) return null;

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > maxBytes) return null;

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
  } finally {
    timeout.clear();
  }
}

export async function getUserPhotoDataUrlWithToken(
  token: string,
  userId: number,
  maxBytes = 2_000_000,
) {
  const photos = await callTelegram<{
    photos: Array<
      Array<{
        file_id: string;
        width: number;
        height: number;
        file_size?: number;
      }>
    >;
  }>(token, "getUserProfilePhotos", {
    user_id: userId,
    offset: 0,
    limit: 1,
  });
  const sizes = photos.photos?.[0];
  if (!Array.isArray(sizes) || !sizes.length) return null;

  const largest = [...sizes].sort(
    (left, right) =>
      (right.file_size ?? right.width * right.height) -
      (left.file_size ?? left.width * left.height),
  )[0];

  const filePath = await getFilePathWithToken(token, largest.file_id);
  if (!filePath) return null;
  return downloadFileAsDataUrl(token, filePath, maxBytes);
}

export const getBotPhotoDataUrlWithToken = getUserPhotoDataUrlWithToken;
