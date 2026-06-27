import { createAdminClient } from "@/lib/supabase/admin";
import {
  listLocalTelegramBots,
  saveLocalTelegramBot,
} from "@/lib/telegram/local-bot-store";
import {
  startLocalTelegramPolling,
  type LocalTelegramExperience,
} from "@/lib/telegram/local-polling";
import type { Json } from "@/lib/supabase/database.types";

export const runtime = "nodejs";

type StartableTelegramBot = {
  botId: string;
  token: string;
  experience: LocalTelegramExperience;
  source: "local" | "supabase";
};

function isLocalRequest(request: Request) {
  const url = new URL(request.url);
  return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
}

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

async function listSupabaseTelegramBots() {
  const admin = createAdminClient();
  if (!admin) {
    return {
      bots: [] as StartableTelegramBot[],
      message:
        "SUPABASE_SERVICE_ROLE_KEY não está configurada; usei apenas os bots salvos localmente.",
    };
  }

  const { data: integrations, error: integrationsError } = await admin
    .from("bot_integrations")
    .select("id, bot_id")
    .eq("provider", "telegram");

  if (integrationsError || !integrations?.length) {
    return {
      bots: [] as StartableTelegramBot[],
      message: integrationsError
        ? "Não consegui consultar integrações no Supabase."
        : "Nenhum bot Telegram encontrado no Supabase.",
    };
  }

  const integrationIds = integrations.map((item) => item.id);
  const botIds = [...new Set(integrations.map((item) => item.bot_id))];

  const [{ data: secrets }, { data: bots }] = await Promise.all([
    admin
      .from("bot_integration_secrets")
      .select("integration_id, secret_token")
      .eq("provider", "telegram")
      .in("integration_id", integrationIds),
    admin
      .from("bots")
      .select("id, status, configuration")
      .in("id", botIds),
  ]);

  const secretByIntegration = new Map(
    (secrets ?? []).map((secret) => [
      secret.integration_id,
      secret.secret_token,
    ]),
  );
  const botById = new Map((bots ?? []).map((bot) => [bot.id, bot]));

  const startable: StartableTelegramBot[] = [];
  for (const integration of integrations) {
    const token = secretByIntegration.get(integration.id);
    const bot = botById.get(integration.bot_id);
    if (!token || !bot) continue;

    const status = String(bot.status);
    if (status === "paused" || status === "archived") continue;

    startable.push({
      botId: bot.id,
      token,
      experience: getLocalExperience(bot.configuration),
      source: "supabase",
    });
  }

  return {
    bots: startable,
    message:
      startable.length > 0
        ? `${startable.length} bot(s) carregado(s) do Supabase.`
        : "Nenhum bot Telegram ativo com token salvo foi encontrado no Supabase.",
  };
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && !isLocalRequest(request)) {
    return Response.json(
      { error: "Disponível apenas localmente." },
      { status: 403 },
    );
  }

  const localBots = await listLocalTelegramBots();
  const supabaseResult = await listSupabaseTelegramBots();
  const botsById = new Map<string, StartableTelegramBot>();

  for (const bot of localBots) {
    botsById.set(bot.botId, {
      botId: bot.botId,
      token: bot.token,
      experience: bot.experience,
      source: "local",
    });
  }

  for (const bot of supabaseResult.bots) {
    botsById.set(bot.botId, bot);
  }

  let started = 0;
  let failed = 0;

  for (const bot of botsById.values()) {
    try {
      await startLocalTelegramPolling({
        botId: bot.botId,
        token: bot.token,
        experience: bot.experience,
      });
      await saveLocalTelegramBot({
        botId: bot.botId,
        token: bot.token,
        experience: bot.experience,
      });
      started += 1;
    } catch (error) {
      failed += 1;
      console.warn("[CriaBot local polling] não foi possível iniciar bot", {
        botId: bot.botId,
        source: bot.source,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  const message =
    started > 0
      ? `${started} bot(s) local(is) ativado(s).`
      : "Nenhum bot local foi ativado. Crie um bot pelo painel ou configure a SUPABASE_SERVICE_ROLE_KEY para carregar bots salvos no Supabase.";

  return Response.json({
    ok: true,
    started,
    failed,
    message,
    detail: supabaseResult.message,
  });
}
