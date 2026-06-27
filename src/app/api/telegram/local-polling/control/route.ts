import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import {
  disableLocalTelegramBot,
  findLocalTelegramBot,
  saveLocalTelegramBot,
} from "@/lib/telegram/local-bot-store";
import {
  restartLocalTelegramPolling,
  startLocalTelegramPolling,
  stopLocalTelegramPolling,
  type LocalTelegramExperience,
} from "@/lib/telegram/local-polling";

export const runtime = "nodejs";

const controlSchema = z.object({
  botId: z.string().uuid(),
  action: z.enum(["start", "restart", "stop"]),
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

async function getTokenFromSupabase(botId: string, ownerId: string) {
  const admin = createAdminClient();
  if (!admin) return null;

  const { data: integration } = await admin
    .from("bot_integrations")
    .select("id")
    .eq("bot_id", botId)
    .eq("provider", "telegram")
    .maybeSingle();

  if (!integration?.id) return null;

  const { data: secret } = await admin
    .from("bot_integration_secrets")
    .select("secret_token")
    .eq("integration_id", integration.id)
    .eq("owner_id", ownerId)
    .eq("provider", "telegram")
    .maybeSingle();

  return secret?.secret_token ?? null;
}

export async function POST(request: Request) {
  const parsed = controlSchema.safeParse(await request.json().catch(() => null));
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
      { error: "Entre na sua conta para controlar o bot." },
      { status: 401 },
    );
  }

  const { botId, action } = parsed.data;
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

  const configuration = asRecord(bot.configuration);
  const currentTelegram = asRecord(configuration.telegram);

  if (action === "stop") {
    stopLocalTelegramPolling(bot.id);
    await disableLocalTelegramBot(bot.id);

    await supabase
      .from("bots")
      .update({
        status: "paused",
        configuration: {
          ...configuration,
          telegram: {
            ...currentTelegram,
            status: "disabled",
            errorMessage: "Bot parado. Clique em iniciar para ligar novamente.",
            localPolling: false,
          },
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", bot.id)
      .eq("owner_id", user.id);

    return Response.json({
      ok: true,
      status: "paused",
      message: "Bot parado com sucesso.",
    });
  }

  const stored = await findLocalTelegramBot(bot.id);
  const token =
    stored?.token ?? (await getTokenFromSupabase(bot.id, user.id));

  if (!token) {
    return Response.json(
      {
        error:
          "Não encontrei o token salvo desse bot. Cole o token para iniciar novamente.",
      },
      { status: 400 },
    );
  }

  const experience = getLocalExperience(bot.configuration);
  if (action === "restart") {
    await restartLocalTelegramPolling({ botId: bot.id, token, experience });
  } else {
    await startLocalTelegramPolling({ botId: bot.id, token, experience });
  }

  await saveLocalTelegramBot({ botId: bot.id, token, experience });

  await supabase
    .from("bots")
    .update({
      status: "active",
      configuration: {
        ...configuration,
        telegram: {
          ...currentTelegram,
          status: "connected",
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
    status: "active",
    message:
      action === "restart"
        ? "Bot reiniciado com sucesso."
        : "Bot iniciado com sucesso.",
  });
}
