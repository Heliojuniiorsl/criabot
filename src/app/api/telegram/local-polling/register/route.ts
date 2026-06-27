import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { saveLocalTelegramBot } from "@/lib/telegram/local-bot-store";
import {
  startLocalTelegramPolling,
  type LocalTelegramExperience,
} from "@/lib/telegram/local-polling";
import {
  formatTelegramError,
  getBotInfoWithToken,
  normalizeTelegramUsername,
} from "@/lib/telegram/api";
import type { Json } from "@/lib/supabase/database.types";

export const runtime = "nodejs";

const registerSchema = z.object({
  botId: z.string().uuid(),
  token: z
    .string()
    .trim()
    .regex(/^\d{6,}:[A-Za-z0-9_-]{20,}$/, "Token do Telegram inválido.")
    .optional(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown) {
  return isRecord(value) ? value : {};
}

function getString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function getLocalExperience(configuration: Json): LocalTelegramExperience {
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

export async function POST(request: Request) {
  const parsed = registerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  if (!supabase) {
    return Response.json(
      { error: "O ambiente ainda não está configurado." },
      { status: 500 },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json(
      { error: "Entre na sua conta para religar o bot." },
      { status: 401 },
    );
  }

  const { botId } = parsed.data;
  const { data: bot, error: botError } = await supabase
    .from("bots")
    .select()
    .eq("id", botId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (botError || !bot) {
    return Response.json(
      { error: "Não encontrei esse bot na sua conta." },
      { status: 404 },
    );
  }

  let token = parsed.data.token;
  if (!token) {
    const { data: integration } = await supabase
      .from("bot_integrations")
      .select("id")
      .eq("bot_id", bot.id)
      .eq("provider", "telegram")
      .maybeSingle();

    if (integration?.id) {
      const { data: secret } = await supabase
        .from("bot_integration_secrets")
        .select("secret_token")
        .eq("integration_id", integration.id)
        .eq("owner_id", user.id)
        .eq("provider", "telegram")
        .maybeSingle();

      token = secret?.secret_token;
    }
  }

  if (!token) {
    return Response.json(
      {
        error:
          "Não encontrei o token salvo desse bot. Edite o bot ou cole o token novamente para religar.",
      },
      { status: 400 },
    );
  }

  const telegramBot = await getBotInfoWithToken(token).catch((error) => {
    return Response.json(
      {
        error: formatTelegramError(
          error,
          "Token inválido. Copie novamente o token enviado pelo BotFather.",
        ),
      },
      { status: 400 },
    );
  });

  if (telegramBot instanceof Response) return telegramBot;

  if (!telegramBot.is_bot || !telegramBot.username) {
    return Response.json(
      {
        error: "Token inválido. Copie novamente o token enviado pelo BotFather.",
      },
      { status: 400 },
    );
  }

  const tokenUsername = normalizeTelegramUsername(telegramBot.username);
  if (tokenUsername.toLowerCase() !== bot.handle.toLowerCase()) {
    return Response.json(
      {
        error: `Esse token pertence ao ${tokenUsername}, mas este card é do ${bot.handle}.`,
      },
      { status: 400 },
    );
  }

  const experience = getLocalExperience(bot.configuration);
  await startLocalTelegramPolling({ botId: bot.id, token, experience });
  await saveLocalTelegramBot({ botId: bot.id, token, experience });

  const configuration = asRecord(bot.configuration);
  const currentTelegram = asRecord(configuration.telegram);
  await supabase
    .from("bots")
    .update({
      status: "active",
      configuration: {
        ...configuration,
        telegram: {
          ...currentTelegram,
          botId: String(telegramBot.id),
          username: tokenUsername,
          firstName: telegramBot.first_name,
          status: "connected",
          webhookRegistered: false,
          errorMessage:
            "Bot online em modo local. Ele responderá enquanto o npm run on estiver ligado.",
          localPolling: true,
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", bot.id)
    .eq("owner_id", user.id);

  return Response.json({
    ok: true,
    message: `Bot ${tokenUsername} religado em modo local.`,
  });
}
