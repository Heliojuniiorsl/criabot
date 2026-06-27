import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import {
  answerCallbackQueryWithToken,
  sendMessageWithToken,
  sendPhotoWithToken,
  sendVideoWithToken,
  type TelegramInlineKeyboard,
} from "@/lib/telegram/api";

export const runtime = "nodejs";

const PLAN_CALLBACK_DATA = "criabot:first_plan";
const PAYMENT_NOT_CONFIGURED_MESSAGE = "pagamento ainda não configurado";

type TelegramChat = {
  id: number;
};

type TelegramUser = {
  first_name?: string;
};

type TelegramMessage = {
  chat?: TelegramChat;
  from?: TelegramUser;
  text?: string;
};

type TelegramCallbackQuery = {
  id: string;
  data?: string;
  from?: TelegramUser;
  message?: {
    chat?: TelegramChat;
  };
};

type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type BotExperience = {
  welcomeMessage: string;
  buyButtonLabel: string;
  firstPlan: {
    message: string;
    buttonLabel: string;
  };
  welcomeMedia: {
    type: "none" | "photo" | "video";
    url: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown) {
  return isRecord(value) ? value : {};
}

function getString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function getExperience(configuration: Json): BotExperience {
  const config = asRecord(configuration);
  const experience = asRecord(config.experience);
  const firstPlan = asRecord(experience.firstPlan);
  const welcomeMedia = asRecord(experience.welcomeMedia);
  const mediaType =
    welcomeMedia.type === "photo" || welcomeMedia.type === "video"
      ? welcomeMedia.type
      : "none";

  return {
    welcomeMessage: getString(
      experience.welcomeMessage,
      "Olá, {nome}! Seja bem-vindo. Toque no botão abaixo para ver as opções disponíveis.",
    ),
    buyButtonLabel: getString(experience.buyButtonLabel, "Ver ofertas"),
    firstPlan: {
      message: getString(firstPlan.message, "Escolha o plano para continuar."),
      buttonLabel: getString(
        firstPlan.buttonLabel,
        getString(experience.buyButtonLabel, "Ver ofertas"),
      ),
    },
    welcomeMedia: {
      type: mediaType,
      url: mediaType === "none" ? "" : getString(welcomeMedia.url),
    },
  };
}

function makeKeyboard(experience: BotExperience) {
  return [
    [
      {
        text:
          experience.firstPlan.buttonLabel ||
          experience.buyButtonLabel ||
          "Ver ofertas",
        callback_data: PLAN_CALLBACK_DATA,
      },
    ],
  ] satisfies TelegramInlineKeyboard;
}

function makeWelcomeText(experience: BotExperience, firstName?: string) {
  const name = firstName?.trim() || "cliente";
  return [
    experience.welcomeMessage.replaceAll("{nome}", name).trim(),
    experience.firstPlan.message.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function telegramWebhookMethod(method: string, payload: Record<string, unknown>) {
  return Response.json({
    method,
    ...payload,
  });
}

async function getBotRuntime(botId: string) {
  const supabase = createAdminClient();
  if (!supabase) return null;

  const { data: bot, error: botError } = await supabase
    .from("bots")
    .select("id, configuration")
    .eq("id", botId)
    .maybeSingle();

  if (botError || !bot) {
    console.error("[CriaBot Telegram webhook] bot not found", {
      botId,
      error: botError?.message,
    });
    return null;
  }

  const { data: integration } = await supabase
    .from("bot_integrations")
    .select("id")
    .eq("bot_id", botId)
    .eq("provider", "telegram")
    .maybeSingle();

  const { data: secret } = integration
    ? await supabase
        .from("bot_integration_secrets")
        .select("secret_token")
        .eq("integration_id", integration.id)
        .maybeSingle()
    : { data: null };

  return {
    experience: getExperience(bot.configuration),
    token: secret?.secret_token ?? null,
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ botId: string }> },
) {
  const { botId } = await context.params;
  return Response.json({ ok: true, provider: "telegram", botId });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ botId: string }> },
) {
  const { botId } = await context.params;
  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;

  console.info("[CriaBot Telegram webhook]", {
    botId,
    updateId: update?.update_id ?? null,
  });

  if (!update) return Response.json({ ok: true });

  const runtime = (await getBotRuntime(botId)) ?? {
    experience: getExperience({}),
    token: null,
  };

  const callback = update.callback_query;
  if (callback?.data === PLAN_CALLBACK_DATA) {
    const chatId = callback.message?.chat?.id;

    if (runtime.token) {
      await answerCallbackQueryWithToken(
        runtime.token,
        callback.id,
        "Pagamento ainda não configurado",
      ).catch((error) => {
        console.error("[CriaBot Telegram webhook] callback error", error);
      });

      if (chatId) {
        await sendMessageWithToken(
          runtime.token,
          chatId,
          PAYMENT_NOT_CONFIGURED_MESSAGE,
        ).catch((error) => {
          console.error("[CriaBot Telegram webhook] send message error", error);
        });
      }

      return Response.json({ ok: true });
    }

    if (chatId) {
      return telegramWebhookMethod("sendMessage", {
        chat_id: chatId,
        text: PAYMENT_NOT_CONFIGURED_MESSAGE,
      });
    }

    return Response.json({ ok: true });
  }

  const message = update.message;
  const chatId = message?.chat?.id;
  if (!chatId || !message?.text?.startsWith("/start")) {
    return Response.json({ ok: true });
  }

  const text = makeWelcomeText(runtime.experience, message.from?.first_name);
  const keyboard = makeKeyboard(runtime.experience);
  const media = runtime.experience.welcomeMedia;

  if (runtime.token) {
    if (media.type === "photo" && media.url) {
      await sendPhotoWithToken(
        runtime.token,
        chatId,
        media.url,
        text.slice(0, 1024),
        keyboard,
      );
      return Response.json({ ok: true });
    }

    if (media.type === "video" && media.url) {
      await sendVideoWithToken(
        runtime.token,
        chatId,
        media.url,
        text.slice(0, 1024),
        keyboard,
      );
      return Response.json({ ok: true });
    }

    await sendMessageWithToken(runtime.token, chatId, text, keyboard);
    return Response.json({ ok: true });
  }

  if (media.type === "photo" && media.url) {
    return telegramWebhookMethod("sendPhoto", {
      chat_id: chatId,
      photo: media.url,
      caption: text.slice(0, 1024),
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  if (media.type === "video" && media.url) {
    return telegramWebhookMethod("sendVideo", {
      chat_id: chatId,
      video: media.url,
      caption: text.slice(0, 1024),
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  return telegramWebhookMethod("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: { inline_keyboard: keyboard },
  });
}
