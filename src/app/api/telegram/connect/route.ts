import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  startLocalTelegramPolling,
  type LocalTelegramExperience,
} from "@/lib/telegram/local-polling";
import { saveLocalTelegramBot } from "@/lib/telegram/local-bot-store";
import {
  formatTelegramError,
  getBotInfoWithToken,
  setWebhookWithToken,
  type TelegramBotInfo,
} from "@/lib/telegram/api";
import type {
  BotConnectionStatus,
  BotItem,
  BotStatus,
  TelegramFirstPlan,
  TelegramPlanInterval,
  TelegramVipCommunity,
  TelegramWelcomeMedia,
} from "@/lib/bot-repository";
import type { Database, Json } from "@/lib/supabase/database.types";

export const runtime = "nodejs";

type BotRow = Database["public"]["Tables"]["bots"]["Row"];
type BotIntegrationInsert =
  Database["public"]["Tables"]["bot_integrations"]["Insert"];
type BotIntegrationUpdate =
  Database["public"]["Tables"]["bot_integrations"]["Update"];

const setupSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^\d{6,}:[A-Za-z0-9_-]{20,}$/, "Token do Telegram inválido."),
  description: z.string().trim().max(800).optional().default(""),
  personality: z.string().trim().max(1200).optional().default(""),
  tone: z.string().trim().max(40).optional().default("Casual"),
  welcomeMessage: z.string().trim().max(600).optional().default(""),
  buyButtonLabel: z.string().trim().max(40).optional().default("Ver ofertas"),
  language: z.enum(["pt-BR", "en"]).optional().default("pt-BR"),
  moderationEnabled: z.boolean().optional().default(true),
  spamProtection: z.boolean().optional().default(true),
  watermark: z.boolean().optional().default(true),
  vipCommunity: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    type: z.enum(["group", "supergroup", "channel"]),
    username: z.string().nullable(),
    botStatus: z.string().min(1),
    botIsAdmin: z.boolean(),
    verifiedAt: z.string().min(1),
    inviteLink: z.string().nullable().optional(),
    missingPermissions: z.array(z.string()).optional(),
  }),
  firstPlan: z.object({
    interval: z.enum([
      "weekly",
      "biweekly",
      "monthly",
      "quarterly",
      "yearly",
      "lifetime",
    ]),
    label: z.string().trim().min(2).max(80),
    durationDays: z.number().int().positive().nullable(),
    message: z.string().trim().min(8).max(600),
    buttonLabel: z.string().trim().min(2).max(40),
    paymentEnabled: z.boolean().optional().default(false),
  }),
  welcomeMedia: z
    .object({
      type: z.enum(["none", "photo", "video"]),
      url: z.string().trim().max(2000).optional().default(""),
    })
    .optional()
    .default({ type: "none", url: "" }),
}).superRefine((data, context) => {
  if (data.welcomeMedia.type === "none") return;

  try {
    const url = new URL(data.welcomeMedia.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("invalid protocol");
    }
  } catch {
    context.addIssue({
      code: "custom",
      path: ["welcomeMedia", "url"],
      message: "Informe uma URL pública válida para a mídia.",
    });
  }
});

function normalizeTelegramUsername(username: string) {
  return `@${username.replace(/^@+/, "").trim()}`;
}

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
    .format(new Date(value))
    .replace(".", "");
}

function getWebhookBaseUrl(request: Request) {
  const configured =
    process.env.CRIABOT_WEBHOOK_BASE_URL ??
    process.env.CRIA_BOT_WEBHOOK_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL;
  const candidate = (configured || new URL(request.url).origin).replace(
    /\/+$/,
    "",
  );

  return candidate.startsWith("https://") ? candidate : null;
}

function getSecretHint(token: string) {
  return `••••${token.slice(-6)}`;
}

function makeExperienceConfig(input: {
  welcomeMessage: string;
  buyButtonLabel: string;
  language: "pt-BR" | "en";
  firstPlan: TelegramFirstPlan;
  welcomeMedia: TelegramWelcomeMedia;
}) {
  return {
    welcomeMessage:
      input.welcomeMessage ||
      "Olá, {nome}! Seja bem-vindo. Toque no botão abaixo para ver as opções disponíveis.",
    buyButtonLabel: input.buyButtonLabel || "Ver ofertas",
    language: input.language,
    firstPlan: {
      interval: input.firstPlan.interval,
      label: input.firstPlan.label,
      durationDays: input.firstPlan.durationDays,
      message: input.firstPlan.message,
      buttonLabel: input.firstPlan.buttonLabel,
      paymentEnabled: false,
    },
    welcomeMedia: {
      type: input.welcomeMedia.type,
      url: input.welcomeMedia.type === "none" ? "" : input.welcomeMedia.url,
    },
  } satisfies Json;
}

function makeLocalPollingExperience(input: {
  welcomeMessage: string;
  buyButtonLabel: string;
  firstPlan: TelegramFirstPlan;
  welcomeMedia: TelegramWelcomeMedia;
}): LocalTelegramExperience {
  return {
    welcomeMessage:
      input.welcomeMessage ||
      "Olá, {nome}! Seja bem-vindo. Toque no botão abaixo para ver as opções disponíveis.",
    buyButtonLabel: input.buyButtonLabel || "Ver ofertas",
    firstPlan: {
      message: input.firstPlan.message,
      buttonLabel: input.firstPlan.buttonLabel,
    },
    welcomeMedia: {
      type: input.welcomeMedia.type,
      url: input.welcomeMedia.type === "none" ? "" : input.welcomeMedia.url,
    },
  };
}

function makeTelegramConfig(input: {
  telegramBot: TelegramBotInfo;
  username: string;
  status: "pending" | "connected" | "error";
  connectedAt: string;
  errorMessage?: string;
  webhookRegistered: boolean;
  webhookUrl?: string;
}) {
  return {
    botId: String(input.telegramBot.id),
    username: input.username,
    firstName: input.telegramBot.first_name,
    status: input.status,
    connectedAt: input.connectedAt,
    errorMessage: input.errorMessage,
    canJoinGroups: input.telegramBot.can_join_groups ?? null,
    canReadAllGroupMessages: input.telegramBot.can_read_all_group_messages ?? null,
    supportsInlineQueries: input.telegramBot.supports_inline_queries ?? null,
    webhook: {
      registered: input.webhookRegistered,
      url: input.webhookUrl,
    },
  } satisfies Json;
}

function makeVipCommunityConfig(input: TelegramVipCommunity) {
  return {
    id: input.id,
    title: input.title,
    type: input.type,
    username: input.username,
    botStatus: input.botStatus,
    botIsAdmin: input.botIsAdmin,
    verifiedAt: input.verifiedAt,
    inviteLink: input.inviteLink ?? null,
    missingPermissions: input.missingPermissions ?? [],
  } satisfies Json;
}

function makeBotItem(row: BotRow): BotItem {
  const configuration =
    row.configuration && typeof row.configuration === "object"
      ? row.configuration
      : {};
  const metrics =
    "metrics" in configuration &&
    configuration.metrics &&
    typeof configuration.metrics === "object"
      ? configuration.metrics
      : {};
  const safeguards =
    "safeguards" in configuration &&
    configuration.safeguards &&
    typeof configuration.safeguards === "object"
      ? configuration.safeguards
      : {};
  const telegram =
    "telegram" in configuration &&
    configuration.telegram &&
    typeof configuration.telegram === "object"
      ? configuration.telegram
      : null;
  const experience =
    "experience" in configuration &&
    configuration.experience &&
    typeof configuration.experience === "object"
      ? configuration.experience
      : {};
  const vipCommunity =
    "vipCommunity" in configuration &&
    configuration.vipCommunity &&
    typeof configuration.vipCommunity === "object"
      ? configuration.vipCommunity
      : null;
  const firstPlan =
    "firstPlan" in experience &&
    experience.firstPlan &&
    typeof experience.firstPlan === "object"
      ? experience.firstPlan
      : null;
  const welcomeMedia =
    "welcomeMedia" in experience &&
    experience.welcomeMedia &&
    typeof experience.welcomeMedia === "object"
      ? experience.welcomeMedia
      : null;
  const webhook =
    telegram &&
    "webhook" in telegram &&
    telegram.webhook &&
    typeof telegram.webhook === "object"
      ? telegram.webhook
      : null;

  return {
    id: row.id,
    name: row.name,
    handle: row.handle,
    description: row.description,
    personality: row.personality,
    tone: row.tone,
    welcomeMessage:
      "welcomeMessage" in experience &&
      typeof experience.welcomeMessage === "string"
        ? experience.welcomeMessage
        : "Olá, {nome}! Seja bem-vindo. Toque no botão abaixo para ver as opções disponíveis.",
    buyButtonLabel:
      "buyButtonLabel" in experience &&
      typeof experience.buyButtonLabel === "string"
        ? experience.buyButtonLabel
        : "Ver ofertas",
    language:
      "language" in experience && experience.language === "en"
        ? "en"
        : "pt-BR",
    platform: row.platform,
    status: row.status === "archived" ? "paused" : (row.status as BotStatus),
    messages:
      "messages" in metrics && typeof metrics.messages === "number"
        ? metrics.messages
        : 0,
    audience:
      "audience" in metrics && typeof metrics.audience === "number"
        ? metrics.audience
        : 0,
    createdAt: formatCreatedAt(row.created_at),
    moderationEnabled:
      "moderation" in safeguards && typeof safeguards.moderation === "boolean"
        ? safeguards.moderation
        : true,
    spamProtection:
      "antiSpam" in safeguards && typeof safeguards.antiSpam === "boolean"
        ? safeguards.antiSpam
        : true,
    watermark: row.watermark_enabled,
    telegram: telegram
      ? {
          botId:
            "botId" in telegram && typeof telegram.botId === "string"
              ? telegram.botId
              : "",
          username:
            "username" in telegram && typeof telegram.username === "string"
              ? telegram.username
              : row.handle,
          firstName:
            "firstName" in telegram && typeof telegram.firstName === "string"
              ? telegram.firstName
              : row.name,
          status:
            "status" in telegram &&
            typeof telegram.status === "string" &&
            ["pending", "connected", "error", "disabled"].includes(
              telegram.status,
            )
              ? (telegram.status as BotConnectionStatus)
              : "connected",
          webhookRegistered:
            webhook &&
            "registered" in webhook &&
            typeof webhook.registered === "boolean"
              ? webhook.registered
              : false,
          webhookUrl:
            webhook && "url" in webhook && typeof webhook.url === "string"
              ? webhook.url
              : undefined,
          errorMessage:
            "errorMessage" in telegram &&
            typeof telegram.errorMessage === "string"
              ? telegram.errorMessage
              : undefined,
          connectedAt:
            "connectedAt" in telegram &&
            typeof telegram.connectedAt === "string"
              ? telegram.connectedAt
              : undefined,
        }
      : undefined,
    vipCommunity:
      vipCommunity &&
      "id" in vipCommunity &&
      typeof vipCommunity.id === "string" &&
      "title" in vipCommunity &&
      typeof vipCommunity.title === "string"
        ? {
            id: vipCommunity.id,
            title: vipCommunity.title,
            type:
              "type" in vipCommunity &&
              (vipCommunity.type === "group" ||
                vipCommunity.type === "supergroup" ||
                vipCommunity.type === "channel")
                ? vipCommunity.type
                : "group",
            username:
              "username" in vipCommunity &&
              typeof vipCommunity.username === "string"
                ? vipCommunity.username
                : null,
            botStatus:
              "botStatus" in vipCommunity &&
              typeof vipCommunity.botStatus === "string"
                ? vipCommunity.botStatus
                : "",
            botIsAdmin:
              "botIsAdmin" in vipCommunity &&
              typeof vipCommunity.botIsAdmin === "boolean"
                ? vipCommunity.botIsAdmin
                : false,
            verifiedAt:
              "verifiedAt" in vipCommunity &&
              typeof vipCommunity.verifiedAt === "string"
                ? vipCommunity.verifiedAt
                : "",
            inviteLink:
              "inviteLink" in vipCommunity &&
              typeof vipCommunity.inviteLink === "string"
                ? vipCommunity.inviteLink
                : null,
            missingPermissions:
              "missingPermissions" in vipCommunity &&
              Array.isArray(vipCommunity.missingPermissions)
                ? vipCommunity.missingPermissions.filter(
                    (item): item is string => typeof item === "string",
                  )
                : undefined,
          }
        : undefined,
    firstPlan:
      firstPlan &&
      "interval" in firstPlan &&
      typeof firstPlan.interval === "string" &&
      "label" in firstPlan &&
      typeof firstPlan.label === "string" &&
      "message" in firstPlan &&
      typeof firstPlan.message === "string" &&
      "buttonLabel" in firstPlan &&
      typeof firstPlan.buttonLabel === "string"
        ? {
            interval: [
              "weekly",
              "biweekly",
              "monthly",
              "quarterly",
              "yearly",
              "lifetime",
            ].includes(firstPlan.interval)
              ? (firstPlan.interval as TelegramPlanInterval)
              : "monthly",
            label: firstPlan.label,
            durationDays:
              "durationDays" in firstPlan &&
              typeof firstPlan.durationDays === "number"
                ? firstPlan.durationDays
                : null,
            message: firstPlan.message,
            buttonLabel: firstPlan.buttonLabel,
            paymentEnabled:
              "paymentEnabled" in firstPlan &&
              typeof firstPlan.paymentEnabled === "boolean"
                ? firstPlan.paymentEnabled
                : false,
          }
        : undefined,
    welcomeMedia:
      welcomeMedia &&
      "type" in welcomeMedia &&
      typeof welcomeMedia.type === "string" &&
      ["none", "photo", "video"].includes(welcomeMedia.type)
        ? {
            type: welcomeMedia.type as TelegramWelcomeMedia["type"],
            url:
              "url" in welcomeMedia && typeof welcomeMedia.url === "string"
                ? welcomeMedia.url
                : "",
          }
        : { type: "none", url: "" },
  };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = setupSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      {
        error:
          parsed.error.issues[0]?.message ??
          "Informe o token do Telegram.",
      },
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
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return Response.json(
      { error: "Entre na sua conta para conectar o bot." },
      { status: 401 },
    );
  }

  const telegramAccountLink = user.user_metadata?.telegram_account_link;
  const telegramAccountLinked =
    telegramAccountLink &&
    typeof telegramAccountLink === "object" &&
    !Array.isArray(telegramAccountLink) &&
    "status" in telegramAccountLink &&
    telegramAccountLink.status === "linked";
  if (!telegramAccountLinked) {
    return Response.json(
      {
        error:
          "Vincule sua conta do Telegram ao CriaBot antes de criar um bot.",
      },
      { status: 403 },
    );
  }

  const input = parsed.data;
  const telegramBot = await getBotInfoWithToken(input.token).catch((error) => {
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

  if (!telegramBot.is_bot) {
    return Response.json(
      {
        error:
          "Token inválido. Copie novamente o token enviado pelo BotFather.",
      },
      { status: 400 },
    );
  }

  if (!telegramBot.username) {
    return Response.json(
      {
        error:
          "Este token não retornou um usuário público do bot. Confira o bot no BotFather.",
      },
      { status: 400 },
    );
  }

  const telegramUsername = normalizeTelegramUsername(telegramBot.username);
  const expectedUsername = telegramUsername;
  const now = new Date().toISOString();
  const initialTelegramConfig = makeTelegramConfig({
    telegramBot,
    username: telegramUsername,
    status: "pending",
    connectedAt: now,
    webhookRegistered: false,
  });
  const configuration = {
    metrics: { messages: 0, audience: 0 },
    safeguards: {
      moderation: input.moderationEnabled,
      antiSpam: input.spamProtection,
    },
    experience: makeExperienceConfig({
      welcomeMessage: input.welcomeMessage,
      buyButtonLabel: input.buyButtonLabel,
      language: input.language,
      firstPlan: input.firstPlan,
      welcomeMedia: input.welcomeMedia,
    }),
    vipCommunity: makeVipCommunityConfig(input.vipCommunity),
    telegram: initialTelegramConfig,
  } satisfies Json;

  const { data: insertedBot, error: botError } = await supabase
    .from("bots")
    .insert({
      owner_id: user.id,
      name: telegramBot.first_name,
      handle: telegramUsername,
      description:
        input.description || "Bot conectado ao Telegram pelo CriaBot.",
      personality:
        input.personality || "Atendimento claro, direto e acolhedor.",
      tone: input.tone,
      platform: "Telegram",
      status: "draft",
      watermark_enabled: input.watermark,
      configuration,
    })
    .select()
    .single();

  let createdBot = insertedBot;
  let reusedExistingBot = false;

  if (botError || !createdBot) {
    const duplicate = botError?.code === "23505";

    if (duplicate) {
      const { data: existingBot, error: existingBotError } = await supabase
        .from("bots")
        .select()
        .eq("owner_id", user.id)
        .eq("handle", telegramUsername)
        .maybeSingle();

      if (existingBotError || !existingBot) {
        return Response.json(
          {
            error:
              "Encontrei um bot com esse usuário, mas não consegui carregar para atualizar. Tente novamente.",
          },
          { status: 400 },
        );
      }

      const { data: updatedBot, error: updateBotError } = await supabase
        .from("bots")
        .update({
          name: telegramBot.first_name,
          description:
            input.description || "Bot conectado ao Telegram pelo CriaBot.",
          personality:
            input.personality || "Atendimento claro, direto e acolhedor.",
          tone: input.tone,
          platform: "Telegram",
          status: "draft",
          watermark_enabled: input.watermark,
          configuration,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingBot.id)
        .eq("owner_id", user.id)
        .select()
        .single();

      if (updateBotError || !updatedBot) {
        return Response.json(
          {
            error:
              "O bot já existia, mas não foi possível atualizar a configuração dele.",
          },
          { status: 400 },
        );
      }

      createdBot = updatedBot;
      reusedExistingBot = true;
    } else {
      return Response.json(
        {
          error:
            "Não foi possível concluir a configuração do bot. Tente novamente.",
        },
        { status: 400 },
      );
    }
  }

  const integrationPayload = {
    bot_id: createdBot.id,
    provider: "telegram",
    status: "pending",
    external_id: String(telegramBot.id),
    external_name: telegramBot.first_name,
    external_username: telegramUsername,
    credentials_reference: `telegram:${createdBot.id}:${getSecretHint(input.token)}`,
    last_checked_at: now,
    metadata: {
      expectedUsername,
      usernameAdjusted: expectedUsername !== telegramUsername,
      canJoinGroups: telegramBot.can_join_groups ?? null,
      canReadAllGroupMessages:
        telegramBot.can_read_all_group_messages ?? null,
      supportsInlineQueries:
        telegramBot.supports_inline_queries ?? null,
    },
  } satisfies BotIntegrationInsert;

  const {
    data: extendedIntegration,
    error: extendedIntegrationError,
  } = await supabase
    .from("bot_integrations")
    .insert(integrationPayload)
    .select("id")
    .single();

  let integration = extendedIntegration;
  let integrationError = extendedIntegrationError;
  let basicIntegrationMode = false;

  if (integrationError || !integration) {
    const { data: existingIntegration, error: existingIntegrationError } =
      await supabase
        .from("bot_integrations")
        .select("id")
        .eq("bot_id", createdBot.id)
        .eq("provider", "telegram")
        .maybeSingle();

    if (existingIntegration && !existingIntegrationError) {
      integration = existingIntegration;
      integrationError = null;
    } else {
      const { data: basicIntegration, error: basicIntegrationError } =
        await supabase
          .from("bot_integrations")
          .insert({
            bot_id: createdBot.id,
            provider: "telegram",
            status: "pending",
          })
          .select("id")
          .single();

      integration = basicIntegration;
      integrationError = basicIntegrationError;
      basicIntegrationMode = Boolean(basicIntegration && !basicIntegrationError);
    }
  }

  if (integrationError || !integration) {
    console.warn("[CriaBot Telegram connect] integração auxiliar ignorada", {
      botId: createdBot.id,
      error: integrationError?.message,
      code: integrationError?.code,
    });
  }

  const database = supabase;
  const integrationId = integration?.id ?? null;

  if (integrationId && !basicIntegrationMode) {
    const { error: secretError } = await database
      .from("bot_integration_secrets")
      .insert({
        integration_id: integrationId,
        owner_id: user.id,
        provider: "telegram",
        secret_token: input.token,
        secret_hint: getSecretHint(input.token),
      });

    if (secretError?.code === "23505") {
      const { error: updateSecretError } = await database
        .from("bot_integration_secrets")
        .update({
          secret_token: input.token,
          secret_hint: getSecretHint(input.token),
          updated_at: new Date().toISOString(),
        })
        .eq("integration_id", integrationId);

      if (updateSecretError) {
        console.warn("[CriaBot Telegram connect] segredo auxiliar ignorado", {
          botId: createdBot.id,
          error: updateSecretError.message,
          code: updateSecretError.code,
        });
      }
    } else if (secretError) {
      console.warn("[CriaBot Telegram connect] segredo auxiliar ignorado", {
        botId: createdBot.id,
        error: secretError.message,
        code: secretError.code,
      });
    }
  }

  async function updateIntegration(
    extendedUpdate: BotIntegrationUpdate,
    status: "pending" | "connected" | "error",
  ) {
    if (!integrationId) return;

    if (!basicIntegrationMode) {
      const { error } = await database
        .from("bot_integrations")
        .update(extendedUpdate)
        .eq("id", integrationId);

      if (!error) return;
    }

    await database
      .from("bot_integrations")
      .update({ status })
      .eq("id", integrationId);
  }

  const webhookBaseUrl = getWebhookBaseUrl(request);
  let webhookRegistered = false;
  let webhookUrl: string | undefined;
  let webhookMessage =
    "Token validado. A conexão do canal será ativada quando estiver disponível.";
  let connectionStatus: "pending" | "connected" | "error" = "pending";
  let errorMessage: string | undefined;

  if (webhookBaseUrl) {
    webhookUrl = `${webhookBaseUrl}/api/webhooks/telegram/${createdBot.id}`;
    const webhookSecret = crypto.randomUUID();
    const webhookResult = await setWebhookWithToken(input.token, {
      url: webhookUrl,
      secretToken: webhookSecret,
      dropPendingUpdates: true,
      allowedUpdates: ["message", "callback_query", "my_chat_member"],
    }).catch((error) => error);

    webhookRegistered = webhookResult === true;
    if (webhookRegistered) {
      webhookMessage = "Token validado e webhook registrado no Telegram.";
      connectionStatus = "connected";
    } else {
      errorMessage = formatTelegramError(
        webhookResult,
        "O Telegram recusou o registro do webhook.",
      );
      webhookMessage = `Token validado, mas o webhook não foi registrado: ${errorMessage}`;
      connectionStatus = "error";
    }

    await updateIntegration(
      {
        status: connectionStatus,
        webhook_url: webhookUrl,
        webhook_registered_at: webhookRegistered ? new Date().toISOString() : null,
        error_message: errorMessage ?? null,
        metadata: {
          expectedUsername,
          usernameAdjusted: expectedUsername !== telegramUsername,
          webhookSecretHint: webhookSecret.slice(0, 8),
        },
        last_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      connectionStatus,
    );
  } else {
    const localExperience = makeLocalPollingExperience({
      welcomeMessage: input.welcomeMessage,
      buyButtonLabel: input.buyButtonLabel,
      firstPlan: input.firstPlan,
      welcomeMedia: input.welcomeMedia,
    });

    await startLocalTelegramPolling({
      token: input.token,
      botId: createdBot.id,
      experience: localExperience,
    });
    await saveLocalTelegramBot({
      token: input.token,
      botId: createdBot.id,
      experience: localExperience,
    });

    webhookMessage =
      "Bot online em modo local. Ele responderá enquanto o npm run dev estiver aberto.";
    connectionStatus = "connected";
    await updateIntegration(
      {
        status: "connected",
        error_message: null,
        metadata: {
          expectedUsername,
          usernameAdjusted: expectedUsername !== telegramUsername,
          localPolling: true,
        },
        last_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      "connected",
    );
  }

  const finalTelegramConfig = makeTelegramConfig({
    telegramBot,
    username: telegramUsername,
    status: connectionStatus,
    connectedAt: now,
    errorMessage,
    webhookRegistered,
    webhookUrl,
  });
  const finalConfiguration = {
    metrics: { messages: 0, audience: 0 },
    safeguards: {
      moderation: input.moderationEnabled,
      antiSpam: input.spamProtection,
    },
    experience: makeExperienceConfig({
      welcomeMessage: input.welcomeMessage,
      buyButtonLabel: input.buyButtonLabel,
      language: input.language,
      firstPlan: input.firstPlan,
      welcomeMedia: input.welcomeMedia,
    }),
    vipCommunity: makeVipCommunityConfig(input.vipCommunity),
    telegram: finalTelegramConfig,
  } satisfies Json;

  const { data: finalBot } = await supabase
    .from("bots")
    .update({
      status: connectionStatus === "connected" ? "active" : "draft",
      configuration: finalConfiguration,
      updated_at: new Date().toISOString(),
    })
    .eq("id", createdBot.id)
    .select()
    .single();

  const reusedBotMessage = reusedExistingBot
    ? " O bot já existia, então atualizei a configuração dele."
    : "";

  return Response.json({
    bot: makeBotItem(finalBot ?? createdBot),
    message:
      expectedUsername !== telegramUsername
        ? `${webhookMessage} O token pertence ao ${telegramUsername}, então ajustei o usuário automaticamente.${reusedBotMessage}`
        : `${webhookMessage}${reusedBotMessage}`,
  });
}
