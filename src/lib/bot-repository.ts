import type { User as SupabaseUser } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

export type BotStatus = "active" | "draft" | "paused";

export type BotConnectionStatus = "pending" | "connected" | "error" | "disabled";

export type TelegramConnection = {
  botId: string;
  username: string;
  firstName: string;
  status: BotConnectionStatus;
  webhookRegistered: boolean;
  webhookUrl?: string;
  errorMessage?: string;
  connectedAt?: string;
};

export type TelegramVipCommunity = {
  id: string;
  title: string;
  type: "group" | "supergroup" | "channel";
  username: string | null;
  botStatus: string;
  botIsAdmin: boolean;
  verifiedAt: string;
  inviteLink?: string | null;
  missingPermissions?: string[];
};

export type TelegramPlanInterval =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "yearly"
  | "lifetime";

export type TelegramFirstPlan = {
  interval: TelegramPlanInterval;
  label: string;
  durationDays: number | null;
  message: string;
  buttonLabel: string;
  paymentEnabled: boolean;
};

export type TelegramWelcomeMedia = {
  type: "none" | "photo" | "video";
  url: string;
};

export type BotItem = {
  id: string;
  name: string;
  handle: string;
  description: string;
  personality: string;
  tone: string;
  welcomeMessage: string;
  buyButtonLabel: string;
  language: "pt-BR" | "en";
  platform: string;
  status: BotStatus;
  messages: number;
  audience: number;
  createdAt: string;
  moderationEnabled: boolean;
  spamProtection: boolean;
  watermark: boolean;
  telegram?: TelegramConnection;
  vipCommunity?: TelegramVipCommunity;
  firstPlan?: TelegramFirstPlan;
  welcomeMedia?: TelegramWelcomeMedia;
};

export type AppUser = {
  id: string;
  name: string;
  email: string;
  phone: string;
};

type BotRow = Database["public"]["Tables"]["bots"]["Row"];

export type TelegramBotSetupInput = {
  token: string;
  description: string;
  personality: string;
  tone: string;
  welcomeMessage: string;
  buyButtonLabel: string;
  language: "pt-BR" | "en";
  moderationEnabled: boolean;
  spamProtection: boolean;
  watermark: boolean;
  vipCommunity: TelegramVipCommunity;
  firstPlan: TelegramFirstPlan;
  welcomeMedia: TelegramWelcomeMedia;
};

export type TelegramBotPreview = {
  id: string;
  name: string;
  username: string;
  avatarDataUrl: string | null;
};

export type TelegramUserPreview = {
  id: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
  isPremium: boolean | null;
  avatarDataUrl: string | null;
  linkedAt: string | null;
};

export type TelegramAccountLinkState = {
  status: "not_started" | "pending" | "linked" | "expired" | "revoked";
  url?: string;
  botUsername?: string;
  expiresAt?: string;
  user: TelegramUserPreview | null;
};

export type TelegramBotPrepareState = {
  ready: boolean;
  message: string;
};

export type TelegramVipCommunityVerification = {
  ready: boolean;
  status: "not_found" | "member" | "admin";
  message: string;
  community: TelegramVipCommunity | null;
};

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
    .format(new Date(value))
    .replace(".", "");
}

function mapBot(row: BotRow): BotItem {
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
    status: row.status === "archived" ? "paused" : row.status,
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

function botPayload(bot: BotItem) {
  return {
    name: bot.name,
    handle: bot.handle,
    description: bot.description,
    personality: bot.personality,
    tone: bot.tone,
    platform: bot.platform,
    status: bot.status,
    watermark_enabled: bot.watermark,
    configuration: {
      metrics: { messages: bot.messages, audience: bot.audience },
      safeguards: {
        moderation: bot.moderationEnabled,
        antiSpam: bot.spamProtection,
      },
      experience: {
        welcomeMessage: bot.welcomeMessage,
        buyButtonLabel: bot.buyButtonLabel,
        language: bot.language,
        ...(bot.firstPlan ? { firstPlan: bot.firstPlan } : {}),
        welcomeMedia: bot.welcomeMedia ?? { type: "none", url: "" },
      },
      ...(bot.vipCommunity
        ? {
            vipCommunity: {
              id: bot.vipCommunity.id,
              title: bot.vipCommunity.title,
              type: bot.vipCommunity.type,
              username: bot.vipCommunity.username,
              botStatus: bot.vipCommunity.botStatus,
              botIsAdmin: bot.vipCommunity.botIsAdmin,
              verifiedAt: bot.vipCommunity.verifiedAt,
              inviteLink: bot.vipCommunity.inviteLink,
              missingPermissions: bot.vipCommunity.missingPermissions,
            },
          }
        : {}),
      ...(bot.telegram
        ? {
            telegram: {
              botId: bot.telegram.botId,
              username: bot.telegram.username,
              firstName: bot.telegram.firstName,
              status: bot.telegram.status,
              connectedAt: bot.telegram.connectedAt,
              errorMessage: bot.telegram.errorMessage,
              webhook: {
                registered: bot.telegram.webhookRegistered,
                url: bot.telegram.webhookUrl,
              },
            },
          }
        : {}),
    },
    updated_at: new Date().toISOString(),
  } satisfies Database["public"]["Tables"]["bots"]["Update"];
}

export async function getCurrentUser(): Promise<AppUser | null> {
  const supabase = createClient();
  if (!supabase) return null;

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, phone")
    .eq("id", user.id)
    .maybeSingle();

  return mapUser(user, profile);
}

export async function checkDatabaseReady() {
  const supabase = createClient();
  if (!supabase) return false;

  const { error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, phone")
    .limit(1);
  return profileError === null;
}

function mapUser(
  user: SupabaseUser,
  profile: { display_name: string; phone: string | null } | null,
): AppUser {
  return {
    id: user.id,
    name:
      profile?.display_name ??
      String(user.user_metadata.display_name ?? user.email?.split("@")[0] ?? "Criador"),
    email: user.email ?? "",
    phone: profile?.phone ?? String(user.user_metadata.phone ?? ""),
  };
}

export async function signIn(email: string, password: string) {
  const supabase = createClient();
  if (!supabase) throw new Error("O ambiente ainda não está configurado.");

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return getCurrentUser();
}

export async function signUp(input: {
  name: string;
  email: string;
  phone: string;
  password: string;
}) {
  const supabase = createClient();
  if (!supabase) throw new Error("O ambiente ainda não está configurado.");

  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: `${window.location.origin}/auth/callback`,
      data: {
        display_name: input.name,
        phone: input.phone,
      },
    },
  });
  if (error) throw error;
  if (!data.user) {
    throw new Error("Não foi possível criar a conta. Tente novamente.");
  }
  if (!data.session) return null;
  return getCurrentUser();
}

export async function signOut() {
  const supabase = createClient();
  if (supabase) await supabase.auth.signOut();
}

export async function listBots(userId: string) {
  const supabase = createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("bots")
    .select("*")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(mapBot);
}

export async function createBot(userId: string, bot: BotItem) {
  const supabase = createClient();
  if (!supabase) return bot;

  const { data, error } = await supabase
    .from("bots")
    .insert({ owner_id: userId, ...botPayload(bot) })
    .select()
    .single();
  if (error) throw error;
  return mapBot(data);
}

export async function updateBot(bot: BotItem) {
  const supabase = createClient();
  if (!supabase) return bot;

  const { data, error } = await supabase
    .from("bots")
    .update(botPayload(bot))
    .eq("id", bot.id)
    .select()
    .single();
  if (error) throw error;
  return mapBot(data);
}

export async function connectTelegramBot(input: TelegramBotSetupInput) {
  const response = await fetch("/api/telegram/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => null)) as
    | { bot?: BotItem; message?: string; error?: string }
    | null;

  if (!response.ok || !payload?.bot) {
    throw new Error(
      payload?.error ??
        "Não foi possível validar o token do Telegram. Confira e tente novamente.",
    );
  }

  return {
    bot: payload.bot,
    message: payload.message ?? "Bot Telegram conectado.",
  };
}

export async function previewTelegramBot(
  token: string,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/telegram/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    signal,
  });
  const payload = (await response.json().catch(() => null)) as
    | { bot?: TelegramBotPreview; error?: string }
    | null;

  if (!response.ok || !payload?.bot) {
    throw new Error(
      payload?.error ??
        "Não foi possível identificar o bot. Confira o token.",
    );
  }

  return payload.bot;
}

export async function prepareTelegramBotForVip(
  token: string,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/telegram/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    signal,
  });
  const payload = (await response.json().catch(() => null)) as
    | (TelegramBotPrepareState & { error?: string })
    | null;

  if (!response.ok || !payload?.ready) {
    throw new Error(
      payload?.error ??
        "Não foi possível deixar o bot pronto para verificar o grupo.",
    );
  }

  return payload;
}

export async function verifyTelegramVipCommunity(input: {
  token: string;
  lookup?: string;
  signal?: AbortSignal;
}) {
  const response = await fetch("/api/telegram/community/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: input.token,
      lookup: input.lookup,
    }),
    signal: input.signal,
  });
  const payload = (await response.json().catch(() => null)) as
    | (TelegramVipCommunityVerification & { error?: string })
    | null;

  if (!response.ok || !payload) {
    throw new Error(
      payload?.error ??
        "Não foi possível verificar o grupo ou canal no Telegram.",
    );
  }

  return payload;
}

export async function registerLocalTelegramBot(input: {
  botId: string;
  token?: string;
}) {
  const response = await fetch("/api/telegram/local-polling/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; message?: string; error?: string }
    | null;

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error ?? "Não foi possível religar o bot local.");
  }

  return payload;
}

export async function controlLocalTelegramBot(input: {
  botId: string;
  action: "start" | "restart" | "stop";
}) {
  const response = await fetch("/api/telegram/local-polling/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; message?: string; error?: string; status?: BotStatus }
    | null;

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error ?? "Não foi possível controlar o bot.");
  }

  return payload;
}

export async function deleteBot(botId: string) {
  const response = await fetch(`/api/bots/${botId}`, {
    method: "DELETE",
  });
  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; message?: string; error?: string }
    | null;

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error ?? "Não foi possível excluir o bot.");
  }

  return payload;
}

export async function startTelegramAccountLink(signal?: AbortSignal) {
  const response = await fetch("/api/telegram/account-link/start", {
    method: "POST",
    signal,
  });
  const payload = (await response.json().catch(() => null)) as
    | (TelegramAccountLinkState & { error?: string })
    | null;

  if (!response.ok || !payload) {
    throw new Error(
      payload?.error ??
        "Não foi possível iniciar o vínculo com Telegram.",
    );
  }

  return payload;
}

export async function getTelegramAccountLinkStatus(signal?: AbortSignal) {
  const response = await fetch("/api/telegram/account-link/status", {
    method: "GET",
    signal,
  });
  const payload = (await response.json().catch(() => null)) as
    | (TelegramAccountLinkState & { error?: string })
    | null;

  if (!response.ok || !payload) {
    throw new Error(
      payload?.error ??
        "Não foi possível consultar o vínculo com Telegram.",
    );
  }

  return payload;
}

export async function updateProfile(userId: string, displayName: string) {
  const supabase = createClient();
  if (!supabase) return;

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: displayName, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw error;
}
