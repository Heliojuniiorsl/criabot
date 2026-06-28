import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequest } from "@tanstack/react-start/server";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import Database from "better-sqlite3";

import { requireAccountSession, requireAdminSession } from "@/lib/auth.server";
import { controlManagedBot, getManagedBotToken, listManagedBots } from "@/lib/bot-manager.server";
import { getTelegramGroups, localDb, sqlite, upsertTelegramGroup } from "@/lib/database.server";
import { getEnvSettingsForPanel, saveEnvSettingsFromPanel } from "@/lib/env-settings.server";
import {
  createManagedSalesBotRecord,
  findManagedSalesBotByKey,
  findManagedSalesBotByUsername,
  managedSalesBotRuntime,
} from "@/lib/sales-bot-registry.server";
import {
  enterSalesBotRuntime,
  getActiveSalesBotToken,
  runWithSalesBotRuntime,
} from "@/lib/sales-bot-runtime.server";
import {
  deleteImageBotMediaMany,
  deleteImageBotMedia,
  deleteImageBotPremiumPlan,
  getImageBotPremiumPlans,
  getImageBotAdminPermissions,
  getImageBotAdminStats,
  getImageBotAuditLogs,
  getImageBotDashboardStats,
  getImageBotDatabasePath,
  getImageBotDeletedMedia,
  getImageBotGroupAutomations,
  getImageBotGroups,
  getImageBotMedia,
  getImageBotMediaById,
  getImageBotPaymentHistory,
  getImageBotSettings as readImageBotSettings,
  getImageBotUserDetails,
  getImageBotUsers,
  imageBotSqlite,
  recordImageBotAuditLog,
  grantImageBotPremiumAccess,
  removeImageBotAdminPermission,
  revokeAllImageBotPremiumAccess,
  restoreImageBotMedia,
  setImageBotUserBlocked,
  setImageBotMediaActive,
  saveImageBotPremiumPlan,
  deleteImageBotGroupAutomation as removeImageBotGroupAutomationFromDb,
  upsertImageBotAdminPermission,
  upsertImageBotGroupAutomation,
  upsertImageBotGroup,
  updateImageBotSettings,
} from "@/lib/image-bot-database.server";
import { recordCustomerEvent } from "@/lib/sales.server";
import {
  getBotInfoWithToken,
  getBotPhotoDataUrlWithToken,
  getChatMemberCountWithToken,
  getChatMemberWithToken,
  leaveChatWithToken,
  sendMessageWithToken,
} from "@/lib/telegram.server";

async function admin() {
  enterSalesBotRuntime(null);
  const session = requireAccountSession();
  const request = getRequest();
  const sourceUrl = request.headers.get("referer") || request.url;
  try {
    const routeUsername = new URL(sourceUrl).pathname.split("/").filter(Boolean)[0];
    if (routeUsername) {
      const bot = findManagedSalesBotByUsername(routeUsername);
      if (bot) {
        if (session.role !== "admin" && bot.owner_account_id !== session.id) {
          throw new Error("Esse bot nao pertence a sua conta");
        }
        enterSalesBotRuntime(managedSalesBotRuntime(bot));
        return localDb;
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("pertence")) throw error;
    // Server functions without a panel referrer keep using the primary database for admins.
  }
  if (session.role !== "admin") throw new Error("Crie ou abra um bot da sua conta");
  return localDb;
}

const uuid = z.string().uuid();

/* ------------------------------- Uploads --------------------------------- */

const uploadSchema = z.object({
  filename: z.string().min(1).max(200),
  contentType: z
    .string()
    .regex(
      /^(image\/(jpeg|jpg|png|webp|gif)|video\/(mp4|quicktime|webm))$/,
      "Tipo de midia invalido",
    ),
  // base64 (sem o prefixo data:) do arquivo
  dataBase64: z.string().min(1).max(90_000_000),
  visibility: z.enum(["public", "private"]).default("public"),
});

export const uploadMedia = createServerFn({ method: "POST" })
  .validator(uploadSchema)
  .handler(async ({ data }) => {
    const sb = await admin();

    const bytes = Buffer.from(data.dataBase64, "base64");
    if (bytes.length > 60 * 1024 * 1024) {
      throw new Error("Midia muito grande (max. 60MB)");
    }

    const ext = (data.filename.split(".").pop() || "jpg")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 5);
    const key = `${data.visibility}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext || "jpg"}`;

    const { error } = await sb.storage
      .from("bot-media")
      .upload(key, bytes, { contentType: data.contentType, upsert: false });
    if (error) throw new Error(error.message);

    if (data.visibility === "private") return { url: `private://${key}` };

    // O caminho relativo continua válido quando a URL temporária do túnel mudar.
    return { url: `/api/public/media/${key}` };
  });

/* ------------------------------- Dashboard ------------------------------- */

export const getDashboard = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const nowIso = new Date().toISOString();

  const [dayOrders, monthOrders, activeSubs, expiredSubs, pendingPayments] = await Promise.all([
    sb
      .from("orders")
      .select("amount")
      .eq("status", "paid")
      .gte("created_at", startOfDay.toISOString()),
    sb
      .from("orders")
      .select("amount")
      .eq("status", "paid")
      .gte("created_at", startOfMonth.toISOString()),
    sb
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .gt("end_date", nowIso),
    sb
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .or(`status.eq.expired,end_date.lte.${nowIso}`),
    sb.from("orders").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);

  const sum = (rows: { amount: number }[] | null) =>
    (rows ?? []).reduce((acc, r) => acc + Number(r.amount), 0);

  return {
    salesToday: sum(dayOrders.data),
    salesMonth: sum(monthOrders.data),
    activeSubscribers: activeSubs.count ?? 0,
    expiredSubscriptions: expiredSubs.count ?? 0,
    pendingPayments: pendingPayments.count ?? 0,
  };
});

/* ---------------------------------- Bots --------------------------------- */

const managedBotKey = z.string().min(1).max(100);
const telegramBotToken = z
  .string()
  .trim()
  .min(20)
  .max(200)
  .regex(/^\d{6,14}:[A-Za-z0-9_-]{30,}$/, "Token do Telegram em formato invalido");
const optionalTrimmedText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((value) => value || null);

const initialBotSetupSchema = z.object({
  vip_chat_id: z.coerce
    .number()
    .int()
    .negative("Informe o ID negativo do grupo ou canal VIP")
    .optional()
    .nullable(),
  welcome_message: optionalTrimmedText(4000),
  plan_name: optionalTrimmedText(120),
  plan_button_label: optionalTrimmedText(80),
  plan_detail_message: optionalTrimmedText(4000),
  plan_price: z.coerce.number().min(0).max(1000000).optional().nullable(),
  plan_access_type: z.enum(["days", "lifetime"]).default("days"),
  plan_duration_days: z.coerce.number().int().min(1).max(3650).default(30),
});

type InitialBotSetup = z.infer<typeof initialBotSetupSchema>;

function setupNewSalesBotDatabase(
  botRuntime: ReturnType<typeof managedSalesBotRuntime>,
  setup: InitialBotSetup,
) {
  return runWithSalesBotRuntime(botRuntime, () => {
    const now = new Date().toISOString();
    const welcomeMessage = setup.welcome_message?.trim();
    if (welcomeMessage) {
      sqlite
        .prepare("UPDATE bot_settings SET welcome_message = ?, updated_at = ? WHERE id = ?")
        .run(welcomeMessage, now, "00000000-0000-4000-8000-000000000001");
    }

    if (!setup.plan_name || setup.plan_price == null || setup.vip_chat_id == null) return null;

    const planId = randomUUID();
    const planName = setup.plan_name.trim();
    const accessType = setup.plan_access_type ?? "days";
    const durationDays = accessType === "lifetime" ? 1 : setup.plan_duration_days;
    const detailMessage =
      setup.plan_detail_message?.trim() || `{{nome}}\n\nAcesso: {{validade}}\nValor: {{preco}}`;

    sqlite
      .prepare(
        `INSERT INTO plans
          (id, name, description, button_label, button_color, detail_message, sort_order,
           description_mode, access_chat_id, access_type, price, duration_days,
           renewal_enabled, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        planId,
        planName,
        detailMessage,
        setup.plan_button_label?.trim() || null,
        "default",
        detailMessage,
        10,
        "custom",
        setup.vip_chat_id,
        accessType,
        setup.plan_price,
        durationDays,
        accessType === "lifetime" ? 0 : 1,
        1,
        now,
        now,
      );

    return { plan_id: planId };
  });
}

export const getManagedBots = createServerFn({ method: "GET" }).handler(async () => {
  const session = requireAccountSession();
  return listManagedBots(
    session.role === "admin"
      ? {}
      : {
          ownerAccountId: session.id,
          includeStatic: false,
        },
  );
});

export const runManagedBotAction = createServerFn({ method: "POST" })
  .validator(
    z.object({
      key: managedBotKey,
      action: z.enum(["start", "stop", "restart"]),
    }),
  )
  .handler(async ({ data }) => {
    const session = requireAccountSession();
    if (session.role !== "admin") {
      const bot = findManagedSalesBotByKey(data.key);
      if (!bot || bot.owner_account_id !== session.id) {
        throw new Error("Esse bot nao pertence a sua conta");
      }
    }
    return controlManagedBot(data.key, data.action);
  });

export const validateManagedSalesBotToken = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: telegramBotToken,
    }),
  )
  .handler(async ({ data }) => {
    requireAccountSession();
    const token = data.token.trim();

    try {
      const info = await getBotInfoWithToken(token);
      const username = String(info.username ?? "").trim();
      if (!username) {
        throw new Error("Esse bot nao possui @username. Configure o username no BotFather.");
      }

      const existing = findManagedSalesBotByUsername(username);
      if (existing) {
        throw new Error(`O bot @${username.replace(/^@/, "").toLowerCase()} ja esta cadastrado.`);
      }

      const photo = await getBotPhotoDataUrlWithToken(token, Number(info.id), 3_000).catch(
        () => null,
      );

      return {
        ok: true,
        bot: {
          telegram_id: String(info.id),
          username: username.replace(/^@/, "").toLowerCase(),
          display_name: String(info.first_name || username),
          photo_data_url: photo,
        },
      };
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Falha ao consultar o Telegram";
      const invalidToken = /unauthorized|token|401/i.test(rawMessage);
      throw new Error(
        invalidToken
          ? "Token invalido. Copie novamente o token completo enviado pelo BotFather."
          : rawMessage,
      );
    }
  });

export const verifyManagedSalesBotVipChat = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: telegramBotToken,
      vip_chat_id: z.coerce.number().int().negative("Informe o ID negativo do grupo ou canal VIP"),
    }),
  )
  .handler(async ({ data }) => {
    requireAccountSession();
    const token = data.token.trim();
    const info = await getBotInfoWithToken(token);
    const member = await getChatMemberWithToken(token, data.vip_chat_id, Number(info.id)).catch(
      (error) => {
        const message = error instanceof Error ? error.message : "Falha ao verificar o grupo VIP";
        throw new Error(
          message.includes("chat not found") || message.includes("member not found")
            ? "Nao encontrei esse grupo/canal para este bot. Confira se o bot foi adicionado e se o ID esta correto."
            : message,
        );
      },
    );
    const botIsAdmin = member.status === "administrator" || member.status === "creator";
    if (!botIsAdmin) {
      throw new Error("O bot foi encontrado, mas precisa ser administrador do grupo/canal VIP.");
    }
    const memberCount = await getChatMemberCountWithToken(token, data.vip_chat_id).catch(
      () => null,
    );

    return {
      ok: true,
      chat_id: data.vip_chat_id,
      bot_status: member.status,
      member_count: memberCount,
    };
  });

export const createManagedSalesBot = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        token: telegramBotToken,
      })
      .merge(initialBotSetupSchema),
  )
  .handler(async ({ data }) => {
    const session = requireAccountSession();
    const bot = await createManagedSalesBotRecord({
      token: data.token,
      ownerAccountId: session.id,
    });
    const setupResult = setupNewSalesBotDatabase(managedSalesBotRuntime(bot), data);
    return {
      ok: true,
      setup: setupResult,
      bot: {
        key: bot.key,
        username: bot.username,
        display_name: bot.display_name,
      },
    };
  });

/* ----------------------------- Environment ------------------------------- */

const envPanelBotKey = z.enum(["sales", "images"]);

export const getEnvironmentSettings = createServerFn({ method: "GET" })
  .validator(z.object({ bot_key: envPanelBotKey }))
  .handler(async ({ data }) => {
    await admin();
    return getEnvSettingsForPanel(data.bot_key);
  });

export const saveEnvironmentSettings = createServerFn({ method: "POST" })
  .validator(
    z.object({
      bot_key: envPanelBotKey,
      confirmation: z.literal("SALVAR_ENV"),
      values: z.record(
        z.string().regex(/^[A-Z0-9_]+$/, "Nome de variável inválido"),
        z.string().max(20_000),
      ),
    }),
  )
  .handler(async ({ data }) => {
    await admin();
    return saveEnvSettingsFromPanel(data.bot_key, data.values);
  });

const imageBotSettingsSchema = z
  .object({
    id: uuid,
    welcome_message: z.string().trim().min(1).max(4000),
    welcome_image_url: z
      .string()
      .trim()
      .max(1000)
      .refine(
        (value) => !value || /^https:\/\//i.test(value) || value.startsWith("/api/public/media/"),
        "A imagem precisa usar um link HTTPS ou uma mídia enviada",
      )
      .optional()
      .nullable(),
    category_hetero_label: z.string().trim().min(1).max(40),
    category_trans_label: z.string().trim().min(1).max(40),
    photo_button_label: z.string().trim().min(1).max(40),
    video_button_label: z.string().trim().min(1).max(40),
    random_button_label: z.string().trim().min(1).max(40),
    back_button_label: z.string().trim().min(1).max(40),
    favorites_button_label: z.string().trim().min(1).max(40),
    category_prompt: z.string().trim().min(1).max(1000),
    media_prompt: z.string().trim().min(1).max(1000),
    category_required_message: z.string().trim().min(1).max(1000),
    empty_media_message: z.string().trim().min(1).max(1000),
    favorites_empty_message: z.string().trim().min(1).max(1000),
    rate_limit_message: z.string().trim().min(1).max(1000),
    daily_limit_message: z.string().trim().min(1).max(1000),
    maintenance_enabled: z.boolean(),
    maintenance_message: z.string().trim().min(1).max(1000),
    flood_cooldown_seconds: z.number().int().min(0).max(60),
    flood_limit_per_minute: z.number().int().min(1).max(120),
    daily_media_limit: z.number().int().min(0).max(10000),
    operating_hours_enabled: z.boolean(),
    operating_start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inicial inválido"),
    operating_end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário final inválido"),
    outside_hours_message: z.string().trim().min(1).max(1000),
    auto_message_enabled: z.boolean(),
    auto_message_every: z.number().int().min(0).max(10000),
    auto_message_text: z.string().trim().max(4000),
    auto_message_plan_mode: z.enum(["none", "all", "single"]),
    auto_message_plan_id: uuid.optional().nullable(),
    payment_enabled: z.boolean(),
    payment_hetero_price: z.number().min(0).max(1000000),
    payment_trans_price: z.number().min(0).max(1000000),
    payment_access_days: z.number().int().min(1).max(3650),
    payment_prompt: z.string().trim().min(1).max(2000),
    payment_success_message: z.string().trim().min(1).max(1000),
    limit_upgrade_enabled: z.boolean(),
    limit_upgrade_button_label: z.string().trim().min(1).max(64),
    limit_upgrade_price: z.number().positive().max(1000000),
    limit_upgrade_bonus_count: z.number().int().min(1).max(100000),
    limit_upgrade_access_type: z.enum(["days", "lifetime"]),
    limit_upgrade_access_days: z.number().int().min(1).max(3650),
  })
  .superRefine((value, context) => {
    if (value.auto_message_plan_mode === "single" && !value.auto_message_plan_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["auto_message_plan_id"],
        message: "Selecione o plano da mensagem automatica",
      });
    }
  });

export const getImageBotSettings = createServerFn({ method: "GET" }).handler(async () => {
  await admin();
  return readImageBotSettings();
});

export const saveImageBotSettings = createServerFn({ method: "POST" })
  .validator(imageBotSettingsSchema)
  .handler(async ({ data }) => {
    await admin();
    if (data.auto_message_plan_mode === "single") {
      const plan = data.auto_message_plan_id
        ? getImageBotPremiumPlans({ activeOnly: true }).find(
            (item) => item.id === data.auto_message_plan_id,
          )
        : null;
      if (!plan) throw new Error("O plano da mensagem automatica nao esta ativo");
    }
    updateImageBotSettings({
      id: data.id,
      welcome_message: data.welcome_message,
      welcome_image_url: data.welcome_image_url || null,
      category_hetero_label: data.category_hetero_label,
      category_trans_label: data.category_trans_label,
      photo_button_label: data.photo_button_label,
      video_button_label: data.video_button_label,
      random_button_label: data.random_button_label,
      back_button_label: data.back_button_label,
      favorites_button_label: data.favorites_button_label,
      category_prompt: data.category_prompt,
      media_prompt: data.media_prompt,
      category_required_message: data.category_required_message,
      empty_media_message: data.empty_media_message,
      favorites_empty_message: data.favorites_empty_message,
      rate_limit_message: data.rate_limit_message,
      daily_limit_message: data.daily_limit_message,
      maintenance_enabled: data.maintenance_enabled,
      maintenance_message: data.maintenance_message,
      flood_cooldown_seconds: data.flood_cooldown_seconds,
      flood_limit_per_minute: data.flood_limit_per_minute,
      daily_media_limit: data.daily_media_limit,
      operating_hours_enabled: data.operating_hours_enabled,
      operating_start: data.operating_start,
      operating_end: data.operating_end,
      outside_hours_message: data.outside_hours_message,
      auto_message_enabled: data.auto_message_enabled,
      auto_message_every: data.auto_message_every,
      auto_message_text: data.auto_message_text,
      auto_message_plan_mode: data.auto_message_plan_mode,
      auto_message_plan_id:
        data.auto_message_plan_mode === "single" ? data.auto_message_plan_id : null,
      payment_enabled: data.payment_enabled,
      payment_hetero_price: data.payment_hetero_price,
      payment_trans_price: data.payment_trans_price,
      payment_access_days: data.payment_access_days,
      payment_prompt: data.payment_prompt,
      payment_success_message: data.payment_success_message,
      limit_upgrade_enabled: data.limit_upgrade_enabled,
      limit_upgrade_button_label: data.limit_upgrade_button_label,
      limit_upgrade_price: data.limit_upgrade_price,
      limit_upgrade_bonus_count: data.limit_upgrade_bonus_count,
      limit_upgrade_access_type: data.limit_upgrade_access_type,
      limit_upgrade_access_days: data.limit_upgrade_access_days,
    });
    return { ok: true };
  });

const imageBotFreePlanSettingsSchema = z.object({
  id: uuid,
  daily_limit_message: z.string().trim().min(1).max(1000),
  flood_cooldown_seconds: z.number().int().min(0).max(60),
  daily_media_limit: z.number().int().min(0).max(10000),
});

export const saveImageBotFreePlanSettings = createServerFn({ method: "POST" })
  .validator(imageBotFreePlanSettingsSchema)
  .handler(async ({ data }) => {
    const session = requireAdminSession();
    updateImageBotSettings({
      ...data,
      // Scheduling was removed: UpMidias is available 24/7 unless maintenance is enabled.
      operating_hours_enabled: false,
    });
    recordImageBotAuditLog({
      actorType: "panel",
      actorId: session.email,
      action: "free_plan.update",
      entityType: "settings",
      entityId: data.id,
    });
    return { ok: true };
  });

const imageBotPremiumReminderSettingsSchema = z.object({
  id: uuid,
  premium_expiry_warning_days: z.number().int().min(1).max(365),
  premium_expiry_warning_message: z.string().trim().min(1).max(1000),
  premium_expiry_repeat_count: z.number().int().min(1).max(10),
  premium_expiry_repeat_interval_minutes: z.number().int().min(1).max(10080),
  premium_offer_button_label: z.string().trim().min(1).max(64),
});

export const saveImageBotPremiumReminderSettings = createServerFn({ method: "POST" })
  .validator(imageBotPremiumReminderSettingsSchema)
  .handler(async ({ data }) => {
    const session = requireAdminSession();
    updateImageBotSettings(data);
    recordImageBotAuditLog({
      actorType: "panel",
      actorId: session.email,
      action: "premium_expiry_reminder.update",
      entityType: "settings",
      entityId: data.id,
    });
    return { ok: true };
  });

export const getImageBotDashboard = createServerFn({ method: "GET" }).handler(async () => {
  await admin();
  return getImageBotDashboardStats();
});

export const listImageBotUsers = createServerFn({ method: "GET" }).handler(async () => {
  await admin();
  return getImageBotUsers();
});

export const listImageBotPayments = createServerFn({ method: "GET" }).handler(async () => {
  await admin();
  return getImageBotPaymentHistory();
});

export const listImageBotPremiumPlans = createServerFn({ method: "GET" }).handler(async () => {
  await admin();
  return getImageBotPremiumPlans();
});

const imageBotPremiumPlanSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  price: z.number().positive().max(1000000),
  access_type: z.enum(["days", "lifetime"]),
  access_days: z.number().int().min(1).max(36500),
  allow_favorites: z.boolean(),
  media_cooldown_seconds: z.number().int().min(0).max(60),
  daily_media_limit: z.number().int().min(0).max(100000),
  is_active: z.boolean(),
});

export const saveImageBotPremiumPlanAdmin = createServerFn({ method: "POST" })
  .validator(imageBotPremiumPlanSchema)
  .handler(async ({ data }) => {
    const session = requireAdminSession();
    return saveImageBotPremiumPlan({
      id: data.id,
      name: data.name,
      description: data.description,
      price: data.price,
      accessType: data.access_type,
      accessDays: data.access_days,
      allowFavorites: data.allow_favorites,
      mediaCooldownSeconds: data.media_cooldown_seconds,
      dailyMediaLimit: data.daily_media_limit,
      isActive: data.is_active,
      actor: session.email,
    });
  });

export const deleteImageBotPremiumPlanAdmin = createServerFn({ method: "POST" })
  .validator(z.object({ id: uuid }))
  .handler(async ({ data }) => {
    const session = requireAdminSession();
    if (!deleteImageBotPremiumPlan(data.id, session.email)) {
      throw new Error("Plano Premium nao encontrado");
    }
    return { ok: true };
  });

const telegramUserId = z.number().int().positive();

export const getImageBotUserAdminDetails = createServerFn({ method: "GET" })
  .validator(z.object({ telegram_user_id: telegramUserId }))
  .handler(async ({ data }) => {
    await admin();
    const details = getImageBotUserDetails(data.telegram_user_id);
    if (!details) throw new Error("Usuário não encontrado");
    return details;
  });

export const updateImageBotUserAccess = createServerFn({ method: "POST" })
  .validator(z.object({ telegram_user_id: telegramUserId, is_blocked: z.boolean() }))
  .handler(async ({ data }) => {
    await admin();
    if (!setImageBotUserBlocked(data.telegram_user_id, data.is_blocked)) {
      throw new Error("Usuário não encontrado");
    }
    return { ok: true };
  });

export const updateImageBotUserPremium = createServerFn({ method: "POST" })
  .validator(
    z.discriminatedUnion("action", [
      z.object({
        action: z.literal("grant"),
        telegram_user_id: telegramUserId,
        plan_id: uuid,
      }),
      z.object({
        action: z.literal("revoke"),
        telegram_user_id: telegramUserId,
      }),
    ]),
  )
  .handler(async ({ data }) => {
    const session = requireAdminSession();
    if (data.action === "grant") {
      grantImageBotPremiumAccess({
        telegramUserId: data.telegram_user_id,
        planId: data.plan_id,
        source: "manual",
        actor: session.email,
      });
    } else {
      revokeAllImageBotPremiumAccess(data.telegram_user_id, session.email);
    }
    return { ok: true };
  });

export const sendImageBotUserMessage = createServerFn({ method: "POST" })
  .validator(
    z.object({
      telegram_user_id: telegramUserId,
      message: z.string().trim().min(1).max(4000),
    }),
  )
  .handler(async ({ data }) => {
    await admin();
    const token = getManagedBotToken("images");
    if (!token) throw new Error("Bot de imagens não configurado");
    await sendMessageWithToken(token, data.telegram_user_id, data.message);
    return { ok: true };
  });

export const sendImageBotTestMessage = createServerFn({ method: "POST" })
  .validator(
    z.object({
      telegram_user_id: telegramUserId,
      message: z.string().trim().min(1).max(4000),
    }),
  )
  .handler(async ({ data }) => {
    await admin();
    const token = getManagedBotToken("images");
    if (!token) throw new Error("Bot de imagens não configurado");
    await sendMessageWithToken(token, data.telegram_user_id, data.message);
    return { ok: true };
  });

export const exportImageBotUsersCsv = createServerFn({ method: "GET" }).handler(async () => {
  await admin();
  const rows = getImageBotUsers();
  const columns = [
    "telegram_id",
    "nome",
    "username",
    "status",
    "administrador",
    "categoria",
    "midias_recebidas",
    "favoritos",
    "premium_upmidias",
    "premium_telegram",
    "pagamentos",
    "total_pago",
    "primeiro_start",
    "ultima_atividade",
  ];
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const lines = rows.map((user) =>
    [
      user.telegram_user_id,
      [user.first_name, user.last_name].filter(Boolean).join(" "),
      user.username ? `@${user.username}` : "",
      user.is_blocked ? "bloqueado" : "ativo",
      user.is_admin ? "sim" : "não",
      user.selected_category ?? "menu_inicial",
      user.media_delivered_count,
      user.favorite_count,
      user.is_premium ? "sim" : "nao",
      user.is_telegram_premium ? "sim" : "nao",
      user.payment_count,
      user.total_paid,
      user.first_started_at,
      user.last_activity_at,
    ]
      .map(escape)
      .join(","),
  );
  return `\uFEFF${columns.map(escape).join(",")}\r\n${lines.join("\r\n")}`;
});

export const listImageBotMedia = createServerFn({ method: "GET" }).handler(async () => {
  await admin();
  return getImageBotMedia();
});

export const removeImageBotMedia = createServerFn({ method: "POST" })
  .validator(z.object({ id: uuid }))
  .handler(async ({ data }) => {
    const session = requireAdminSession();
    if (!deleteImageBotMedia(data.id, `panel:${session.email}`)) {
      throw new Error("Mídia não encontrada");
    }
    return { ok: true };
  });

const imageBotMediaIds = z.array(uuid).min(1).max(1000);

export const setImageBotMediaStatus = createServerFn({ method: "POST" })
  .validator(z.object({ ids: imageBotMediaIds, is_active: z.boolean() }))
  .handler(async ({ data }) => {
    await admin();
    return { updated: setImageBotMediaActive(data.ids, data.is_active) };
  });

export const removeImageBotMediaMany = createServerFn({ method: "POST" })
  .validator(z.object({ ids: imageBotMediaIds }))
  .handler(async ({ data }) => {
    const session = requireAdminSession();
    return { deleted: deleteImageBotMediaMany(data.ids, `panel:${session.email}`) };
  });

export const listImageBotTrash = createServerFn({ method: "GET" }).handler(async () => {
  await admin();
  return getImageBotDeletedMedia();
});

export const restoreImageBotTrashMedia = createServerFn({ method: "POST" })
  .validator(z.object({ id: uuid }))
  .handler(async ({ data }) => {
    const session = requireAdminSession();
    if (!restoreImageBotMedia(data.id, `panel:${session.email}`)) {
      throw new Error("Mídia não encontrada na lixeira");
    }
    return { ok: true };
  });

/* ------------------------- Image Bot Admin / Stats ------------------------ */

const imageBotAdminRole = z.enum(["owner", "manager", "moderator", "viewer"]);

export const listImageBotAdmins = createServerFn({ method: "GET" }).handler(async () => {
  await admin();
  return getImageBotAdminPermissions();
});

export const saveImageBotAdmin = createServerFn({ method: "POST" })
  .validator(
    z.object({
      telegram_user_id: telegramUserId,
      role: imageBotAdminRole,
      can_delete_media: z.boolean(),
      can_restore_media: z.boolean(),
      can_manage_users: z.boolean(),
      can_manage_settings: z.boolean(),
      can_view_stats: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const session = requireAdminSession();
    upsertImageBotAdminPermission({
      telegramUserId: data.telegram_user_id,
      role: data.role,
      canDeleteMedia: data.can_delete_media,
      canRestoreMedia: data.can_restore_media,
      canManageUsers: data.can_manage_users,
      canManageSettings: data.can_manage_settings,
      canViewStats: data.can_view_stats,
      actor: session.email,
    });
    return { ok: true };
  });

export const removeImageBotAdmin = createServerFn({ method: "POST" })
  .validator(z.object({ telegram_user_id: telegramUserId }))
  .handler(async ({ data }) => {
    const session = requireAdminSession();
    if (!removeImageBotAdminPermission(data.telegram_user_id, session.email)) {
      throw new Error("Administrador não encontrado");
    }
    return { ok: true };
  });

export const listImageBotAuditLogs = createServerFn({ method: "GET" }).handler(async () => {
  await admin();
  return getImageBotAuditLogs();
});

export const getImageBotStats = createServerFn({ method: "GET" }).handler(async () => {
  await admin();
  return getImageBotAdminStats();
});

export const exportImageBotDatabaseBackup = createServerFn({ method: "GET" }).handler(async () => {
  const session = requireAdminSession();
  const path = getImageBotDatabasePath();
  const dataBase64 = readFileSync(path).toString("base64");
  recordImageBotAuditLog({
    actorType: "panel",
    actorId: session.email,
    action: "database.backup.export",
    entityType: "database",
    entityId: "upmidias",
  });
  return {
    filename: `upmidias-backup-${new Date().toISOString().slice(0, 10)}.sqlite`,
    data_base64: dataBase64,
  };
});

const backupTableOrder = [
  "settings",
  "users",
  "groups",
  "media",
  "group_automations",
  "user_navigation",
  "delivery_limits",
  "interaction_limits",
  "favorites",
  "media_deliveries",
  "premium_plans",
  "premium_access",
  "premium_payment_orders",
  "paid_access",
  "payment_orders",
  "limit_payment_orders",
  "daily_limit_boosts",
  "admin_permissions",
  "audit_logs",
  "telegram_errors",
] as const;

const backupDeleteOrder = [...backupTableOrder].reverse();

function tableColumns(db: Database.Database, schema: "main" | "backup", table: string) {
  return db.prepare(`PRAGMA ${schema}.table_info(${table})`).all() as { name: string }[];
}

export const restoreImageBotDatabaseBackup = createServerFn({ method: "POST" })
  .validator(
    z.object({
      filename: z.string().min(1).max(200),
      data_base64: z.string().min(1).max(100_000_000),
      confirmation: z.literal("RESTAURAR BANCO"),
    }),
  )
  .handler(async ({ data }) => {
    const session = requireAdminSession();
    const tempPath = `${getImageBotDatabasePath()}.restore-${Date.now()}.sqlite`;
    writeFileSync(tempPath, Buffer.from(data.data_base64, "base64"));
    let source: Database.Database | null = null;
    try {
      source = new Database(tempPath, { readonly: true });
      const required = ["settings", "users", "media"];
      for (const table of required) {
        const exists = source
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(table);
        if (!exists) throw new Error("Backup inválido para o banco do UpMidias");
      }
      source.close();
      source = null;

      imageBotSqlite.pragma("foreign_keys = OFF");
      imageBotSqlite.prepare("ATTACH DATABASE ? AS backup").run(tempPath);
      const restore = imageBotSqlite.transaction(() => {
        for (const table of backupDeleteOrder) {
          imageBotSqlite.prepare(`DELETE FROM ${table}`).run();
        }
        for (const table of backupTableOrder) {
          const mainCols = new Set(
            tableColumns(imageBotSqlite, "main", table).map((column) => column.name),
          );
          const backupCols = tableColumns(imageBotSqlite, "backup", table).map(
            (column) => column.name,
          );
          const common = backupCols.filter((column) => mainCols.has(column));
          if (!common.length) continue;
          const columns = common.map((column) => `"${column}"`).join(", ");
          imageBotSqlite
            .prepare(`INSERT INTO ${table} (${columns}) SELECT ${columns} FROM backup.${table}`)
            .run();
        }
      });
      restore();
      imageBotSqlite.prepare("DETACH DATABASE backup").run();
      imageBotSqlite.pragma("foreign_keys = ON");
      recordImageBotAuditLog({
        actorType: "panel",
        actorId: session.email,
        action: "database.backup.restore",
        entityType: "database",
        entityId: data.filename,
      });
      return { ok: true };
    } finally {
      if (source) source.close();
      try {
        rmSync(tempPath, { force: true });
      } catch {
        // ignored
      }
    }
  });

/* -------------------------------- Groups --------------------------------- */

export const listTelegramGroups = createServerFn({ method: "GET" }).handler(async () => {
  await admin();
  return getTelegramGroups();
});

export const leaveTelegramGroup = createServerFn({ method: "POST" })
  .validator(z.object({ group_id: uuid }))
  .handler(async ({ data }) => {
    await admin();
    const group = getTelegramGroups().find((item) => item.id === data.group_id);
    if (!group) throw new Error("Grupo ou canal nao encontrado");
    if (!group.is_active) return group;

    const token = getActiveSalesBotToken();
    if (!token) throw new Error("Token do bot de vendas nao configurado");
    await leaveChatWithToken(token, group.telegram_chat_id);

    return upsertTelegramGroup({
      telegramChatId: group.telegram_chat_id,
      title: group.title,
      username: group.username,
      type: group.type,
      botStatus: "left",
      isActive: false,
      memberCount: group.member_count,
    });
  });

async function syncImageBotGroupsWithTelegram(
  token: string,
  groups: ReturnType<typeof getImageBotGroups>,
) {
  if (!groups.length) return;
  const bot = await getBotInfoWithToken(token);
  await Promise.all(
    groups.map(async (group) => {
      try {
        const [member, memberCount] = await Promise.all([
          getChatMemberWithToken(token, group.telegram_chat_id, Number(bot.id)),
          getChatMemberCountWithToken(token, group.telegram_chat_id),
        ]);
        const isActive = ["creator", "administrator", "member", "restricted"].includes(
          member.status,
        );
        upsertImageBotGroup({
          telegramChatId: group.telegram_chat_id,
          title: group.title,
          username: group.username,
          type: group.type,
          botStatus: member.status,
          isActive,
          memberCount,
        });
      } catch (error) {
        console.warn(`[image-bot-group-sync:${group.telegram_chat_id}]`, error);
      }
    }),
  );
}

export const listImageBotGroups = createServerFn({ method: "GET" }).handler(async () => {
  await admin();
  const token = getManagedBotToken("images");
  const groups = getImageBotGroups();
  if (token && groups.length) {
    void syncImageBotGroupsWithTelegram(token, groups).catch((error) =>
      console.warn("[image-bot-groups-sync]", error),
    );
  }
  return groups;
});

export const leaveImageBotGroup = createServerFn({ method: "POST" })
  .validator(z.object({ group_id: uuid }))
  .handler(async ({ data }) => {
    await admin();
    const group = getImageBotGroups().find((item) => item.id === data.group_id);
    if (!group) throw new Error("Grupo do UpMidias nao encontrado");
    if (!group.is_active) return group;

    const token = getManagedBotToken("images");
    if (!token) throw new Error("Token do UpMidias nao configurado");
    await leaveChatWithToken(token, group.telegram_chat_id);

    const updated = upsertImageBotGroup({
      telegramChatId: group.telegram_chat_id,
      title: group.title,
      username: group.username,
      type: group.type,
      botStatus: "left",
      isActive: false,
      memberCount: group.member_count,
    });
    const session = requireAdminSession();
    recordImageBotAuditLog({
      actorType: "panel",
      actorId: session.email,
      action: "group.leave",
      entityType: "group",
      entityId: group.id,
      details: JSON.stringify({ telegram_chat_id: group.telegram_chat_id }),
    });
    return updated;
  });

const imageBotGroupAutomationKind = z.enum([
  "text",
  "custom_photo",
  "custom_video",
  "saved_media",
  "telegram_message",
]);
const imageBotMediaCategory = z.enum(["hetero", "trans"]);
const imageBotAutomationButtonSchema = z.discriminatedUnion("kind", [
  z.object({
    label: z.string().trim().min(1).max(64),
    kind: z.literal("premium_plans"),
    plan_id: z.null().optional(),
  }),
  z.object({
    label: z.string().trim().min(1).max(64),
    kind: z.literal("premium_plan"),
    plan_id: uuid,
  }),
  z.object({
    label: z.string().trim().min(1).max(64),
    kind: z.literal("bot_link"),
    plan_id: z.null().optional(),
    url: z
      .string()
      .trim()
      .max(500)
      .url("Informe um link valido")
      .refine((value) => /^https:\/\/(?:t|telegram)\.me\//i.test(value), {
        message: "Use um link do Telegram, como https://t.me/seu_bot",
      }),
  }),
]);

const imageBotGroupAutomationSchema = z
  .object({
    id: uuid.optional(),
    group_id: uuid,
    title: z.string().trim().min(1).max(160),
    message: z.string().trim().max(4000).default(""),
    content_kind: imageBotGroupAutomationKind,
    custom_media_url: z.string().trim().max(1000).optional().nullable(),
    saved_media_id: uuid.optional().nullable(),
    random_media_category: imageBotMediaCategory.optional().nullable(),
    media_batch_size: z.number().int().min(1).max(20).default(1),
    source_chat_id: z.number().int().optional().nullable(),
    source_message_id: z.number().int().positive().optional().nullable(),
    buttons: z.array(imageBotAutomationButtonSchema).max(6).default([]),
    interval_minutes: z.number().int().min(1).max(525600),
    is_active: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.content_kind === "text" && !value.message.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["message"],
        message: "Informe o texto da mensagem",
      });
    }
    if (
      (value.content_kind === "custom_photo" || value.content_kind === "custom_video") &&
      !value.custom_media_url
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["custom_media_url"],
        message: "Informe o link da mídia personalizada",
      });
    }
    if (
      value.custom_media_url &&
      !/^https?:\/\//i.test(value.custom_media_url) &&
      !value.custom_media_url.startsWith("/api/public/media/")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["custom_media_url"],
        message: "Use um link http(s) ou uma mídia enviada pelo painel",
      });
    }
    if (
      value.content_kind === "saved_media" &&
      !value.saved_media_id &&
      !value.random_media_category
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["random_media_category"],
        message: "Escolha a categoria da mídia do banco",
      });
    }
    if (value.content_kind === "telegram_message" && !value.source_message_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source_message_id"],
        message: "Informe o ID da mensagem do Telegram",
      });
    }
  });

export const listImageBotGroupAutomations = createServerFn({ method: "GET" })
  .validator(z.object({ group_id: uuid }))
  .handler(async ({ data }) => {
    await admin();
    return getImageBotGroupAutomations(data.group_id);
  });

export const saveImageBotGroupAutomation = createServerFn({ method: "POST" })
  .validator(imageBotGroupAutomationSchema)
  .handler(async ({ data }) => {
    const session = requireAdminSession();
    const activePlanIds = new Set(
      getImageBotPremiumPlans({ activeOnly: true }).map((plan) => plan.id),
    );
    for (const button of data.buttons) {
      if (button.kind === "premium_plan" && !activePlanIds.has(button.plan_id)) {
        throw new Error(`O plano do botao "${button.label}" nao esta ativo`);
      }
    }
    if (data.content_kind === "saved_media" && data.saved_media_id) {
      const media = getImageBotMediaById(data.saved_media_id);
      if (!media || media.deleted_at || !media.is_active) {
        throw new Error("A mídia salva não foi encontrada ou está inativa");
      }
    }
    const automation = upsertImageBotGroupAutomation({
      id: data.id,
      groupId: data.group_id,
      title: data.title,
      message: data.message,
      contentKind: data.content_kind,
      customMediaUrl: data.custom_media_url,
      savedMediaId: data.content_kind === "saved_media" ? data.saved_media_id : null,
      randomMediaCategory:
        data.content_kind === "saved_media" ? (data.random_media_category ?? null) : null,
      mediaBatchSize: data.content_kind === "saved_media" ? data.media_batch_size : 1,
      sourceChatId: data.content_kind === "telegram_message" ? data.source_chat_id : null,
      sourceMessageId: data.content_kind === "telegram_message" ? data.source_message_id : null,
      buttons: data.buttons,
      intervalMinutes: data.interval_minutes,
      isActive: data.is_active,
    });
    recordImageBotAuditLog({
      actorType: "panel",
      actorId: session.email,
      action: data.id ? "group_automation.update" : "group_automation.create",
      entityType: "group_automation",
      entityId: automation?.id ?? data.id ?? data.group_id,
      details: JSON.stringify({
        group_id: data.group_id,
        content_kind: data.content_kind,
        random_media_category: data.random_media_category,
        media_batch_size: data.media_batch_size,
      }),
    });
    return automation;
  });

export const deleteImageBotGroupAutomation = createServerFn({ method: "POST" })
  .validator(z.object({ id: uuid, group_id: uuid }))
  .handler(async ({ data }) => {
    const session = requireAdminSession();
    const deleted = removeImageBotGroupAutomationFromDb(data.id, data.group_id);
    if (!deleted) throw new Error("Automação do grupo não encontrada");
    recordImageBotAuditLog({
      actorType: "panel",
      actorId: session.email,
      action: "group_automation.delete",
      entityType: "group_automation",
      entityId: data.id,
      details: JSON.stringify({ group_id: data.group_id }),
    });
    return { ok: true };
  });

export const sendImageBotGroupAutomationNow = createServerFn({ method: "POST" })
  .validator(z.object({ id: uuid, group_id: uuid }))
  .handler(async ({ data }) => {
    await admin();
    const automation = getImageBotGroupAutomations(data.group_id).find(
      (item) => item.id === data.id,
    );
    if (!automation) throw new Error("Automação do grupo não encontrada");
    const { sendImageBotGroupAutomationById } = await import("@/lib/image-bot-broadcast.server");
    const sent = await sendImageBotGroupAutomationById(data.id);
    return { ok: true, sent };
  });

const groupBroadcastButtonSchema = z.discriminatedUnion("kind", [
  z.object({
    label: z.string().min(1).max(64),
    kind: z.literal("link"),
    url: z
      .string()
      .url("Informe um link completo, começando com https://")
      .max(1000)
      .refine(
        (value) => /^https?:\/\//i.test(value),
        "O link deve começar com http:// ou https://",
      ),
  }),
  z.object({
    label: z.string().min(1).max(64),
    kind: z.literal("bot"),
    url: z
      .string()
      .trim()
      .max(500)
      .refine(
        (value) =>
          /^@?[A-Za-z0-9_]{5,32}$/.test(value) ||
          /^https?:\/\/(?:t|telegram)\.me\/[A-Za-z0-9_]{5,32}(?:[/?#].*)?$/i.test(value),
        "Informe o @usuario ou link t.me do bot",
      ),
    plan_id: z.null().optional(),
  }),
  z.object({
    label: z.string().min(1).max(64),
    kind: z.enum(["plans", "offers"]),
    url: z.null().optional(),
  }),
  z.object({
    label: z.string().min(1).max(64),
    kind: z.literal("plan"),
    plan_id: uuid,
    url: z.null().optional(),
  }),
]);

const groupBroadcastSchema = z
  .object({
    id: uuid.optional(),
    group_id: uuid,
    title: z.string().min(1).max(160),
    message: z.string().trim().max(4000),
    image_url: z.string().max(1000).optional().nullable(),
    buttons: z.array(groupBroadcastButtonSchema).max(6),
    interval_minutes: z.number().int().min(1).max(525600),
    is_active: z.boolean(),
  })
  .superRefine((value, context) => {
    if (!value.message && !value.image_url) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["message"],
        message: "Informe o texto, uma foto ou um video",
      });
    }
  });

export const listGroupBroadcasts = createServerFn({ method: "GET" })
  .validator(z.object({ group_id: uuid }))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: broadcasts, error } = await sb
      .from("group_broadcasts")
      .select("*")
      .eq("group_id", data.group_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return broadcasts;
  });

export const saveGroupBroadcast = createServerFn({ method: "POST" })
  .validator(groupBroadcastSchema)
  .handler(async ({ data }) => {
    const sb = await admin();
    const group = sqlite
      .prepare("SELECT is_active FROM telegram_groups WHERE id = ?")
      .get(data.group_id) as { is_active: number } | undefined;
    if (!group) throw new Error("Grupo não encontrado");
    if (data.is_active && !group.is_active) {
      throw new Error("O bot precisa estar no grupo para ativar mensagens");
    }
    for (const button of data.buttons) {
      if (button.kind !== "plan") continue;
      const plan = sqlite
        .prepare("SELECT id FROM plans WHERE id = ? AND is_active = 1")
        .get(button.plan_id);
      if (!plan) throw new Error(`O plano do botao "${button.label}" nao esta ativo`);
    }
    const { id, ...fields } = data;
    if (id) {
      const existing = sqlite
        .prepare("SELECT group_id FROM group_broadcasts WHERE id = ?")
        .get(id) as { group_id: string } | undefined;
      if (!existing || existing.group_id !== data.group_id) {
        throw new Error("Mensagem do grupo não encontrada");
      }
      const { error } = await sb.from("group_broadcasts").update(fields).eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await sb.from("group_broadcasts").insert(fields);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteGroupBroadcast = createServerFn({ method: "POST" })
  .validator(z.object({ id: uuid, group_id: uuid }))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { error } = await sb
      .from("group_broadcasts")
      .delete()
      .eq("id", data.id)
      .eq("group_id", data.group_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const sendGroupBroadcastNow = createServerFn({ method: "POST" })
  .validator(z.object({ id: uuid, group_id: uuid }))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: broadcast, error } = await sb
      .from("group_broadcasts")
      .select("*")
      .eq("id", data.id)
      .eq("group_id", data.group_id)
      .single();
    if (error || !broadcast) throw new Error("Mensagem do grupo não encontrada");
    const { sendGroupBroadcast } = await import("@/lib/broadcast.server");
    const sent = await sendGroupBroadcast(sb, broadcast);
    return { ok: true, sent };
  });

/* --------------------------------- Plans --------------------------------- */

export const listPlans = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("plans")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return [...(data ?? [])].sort(
    (left: any, right: any) =>
      Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0) ||
      Date.parse(right.created_at ?? "") - Date.parse(left.created_at ?? ""),
  );
});

const planSchema = z
  .object({
    id: uuid.optional(),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional().nullable(),
    button_label: z.string().trim().max(80).optional().nullable(),
    button_color: z
      .enum([
        "default",
        "success",
        "danger",
        "primary",
        "red",
        "orange",
        "yellow",
        "green",
        "blue",
        "purple",
        "pink",
      ])
      .default("default"),
    detail_message: z.string().max(4000).optional().nullable(),
    description_mode: z.enum(["custom", "telegram_message"]).default("custom"),
    description_source_chat_id: z
      .union([z.number().int(), z.string().trim().min(1).max(80)])
      .optional()
      .nullable(),
    description_source_message_id: z.number().int().positive().optional().nullable(),
    access_chat_id: z.coerce.number().int().negative("Informe o ID negativo do grupo VIP"),
    access_type: z.enum(["days", "lifetime"]).default("days"),
    price: z.number().min(0).max(1000000),
    duration_days: z.number().int().min(1).max(3650),
    promo_price: z.number().min(0).max(1000000).optional().nullable(),
    promo_starts_at: z.string().max(40).optional().nullable(),
    promo_ends_at: z.string().max(40).optional().nullable(),
    sort_order: z.number().int().min(0).max(1_000_000).optional(),
    renewal_enabled: z.boolean().default(true),
    is_active: z.boolean(),
  })
  .superRefine((plan, context) => {
    if (plan.description_mode !== "telegram_message") return;
    if (!plan.description_source_chat_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["description_source_chat_id"],
        message: "Informe o chat de origem da mensagem pronta",
      });
    }
    if (!plan.description_source_message_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["description_source_message_id"],
        message: "Informe o ID da mensagem pronta",
      });
    }
  });

function normalizeTelegramButtonStyle(value?: string | null) {
  if (value === "success" || value === "green") return "success";
  if (value === "danger" || value === "red") return "danger";
  if (value === "primary" || value === "blue") return "primary";
  return "default";
}

export const savePlan = createServerFn({ method: "POST" })
  .validator(planSchema)
  .handler(async ({ data }) => {
    const sb = await admin();
    if (
      data.promo_starts_at &&
      data.promo_ends_at &&
      Date.parse(data.promo_starts_at) >= Date.parse(data.promo_ends_at)
    ) {
      throw new Error("O fim da promocao deve ser posterior ao inicio");
    }
    const { id, ...rawFields } = data;
    const fields = {
      ...rawFields,
      button_label: rawFields.button_label?.trim() || null,
      button_color: normalizeTelegramButtonStyle(rawFields.button_color),
      detail_message: rawFields.detail_message?.trim() || null,
      sort_order:
        rawFields.sort_order ??
        (id
          ? undefined
          : Number(
              (
                sqlite
                  .prepare("SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM plans")
                  .get() as { next: number }
              ).next,
            )),
      duration_days: rawFields.access_type === "lifetime" ? 1 : rawFields.duration_days,
      renewal_enabled: rawFields.access_type === "lifetime" ? false : rawFields.renewal_enabled,
      description_source_chat_id:
        rawFields.description_mode === "telegram_message"
          ? rawFields.description_source_chat_id
          : null,
      description_source_message_id:
        rawFields.description_mode === "telegram_message"
          ? rawFields.description_source_message_id
          : null,
    };
    if (fields.sort_order === undefined) delete (fields as Record<string, unknown>).sort_order;
    if (id) {
      const { error } = await sb.from("plans").update(fields).eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await sb.from("plans").insert(fields);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const reorderPlan = createServerFn({ method: "POST" })
  .validator(z.object({ id: uuid, direction: z.enum(["up", "down"]) }))
  .handler(async ({ data }) => {
    await admin();
    const rows = sqlite
      .prepare(
        `SELECT id
         FROM plans
         ORDER BY sort_order ASC, datetime(created_at) DESC, name COLLATE NOCASE ASC`,
      )
      .all() as Array<{ id: string }>;
    const index = rows.findIndex((plan) => plan.id === data.id);
    if (index === -1) throw new Error("Plano nao encontrado");
    const targetIndex = data.direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= rows.length) return { ok: true };

    const nextOrder = [...rows];
    [nextOrder[index], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[index]];
    const now = new Date().toISOString();
    const updateOrder = sqlite.transaction(() => {
      for (const [position, plan] of nextOrder.entries()) {
        sqlite
          .prepare("UPDATE plans SET sort_order = ?, updated_at = ? WHERE id = ?")
          .run((position + 1) * 10, now, plan.id);
      }
    });
    updateOrder();
    return { ok: true };
  });

export const deletePlan = createServerFn({ method: "POST" })
  .validator(z.object({ id: uuid }))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { error } = await sb.from("plans").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------------- Contents -------------------------------- */

export const listContents = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("contents")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
});

const contentSchema = z
  .object({
    id: uuid.optional(),
    title: z.string().min(1).max(160),
    description: z.string().max(2000).optional().nullable(),
    category: z.preprocess(
      (value) => String(value ?? "").trim() || "Geral",
      z.string().min(1).max(32),
    ),
    type: z.enum(["foto", "video", "pacote"]),
    price: z.number().min(0).max(1000000),
    preview_url: z
      .string()
      .trim()
      .max(1000)
      .refine(
        (value) => !value || /^https:\/\//i.test(value) || value.startsWith("/api/public/media/"),
        "A prévia precisa usar um link HTTPS ou uma mídia enviada",
      )
      .optional()
      .nullable(),
    file_url: z
      .string()
      .trim()
      .max(1000)
      .refine(
        (value) => !value || value.startsWith("private://") || /^https:\/\//i.test(value),
        "Envie um arquivo ou use um link HTTPS completo",
      ),
    access_chat_id: z.number().int().optional().nullable(),
    is_active: z.boolean(),
  })
  .superRefine((content, context) => {
    if (!content.file_url && !content.access_chat_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["file_url"],
        message: "Envie um arquivo ou informe o ID do canal protegido",
      });
    }
  });

export const saveContent = createServerFn({ method: "POST" })
  .validator(contentSchema)
  .handler(async ({ data }) => {
    const sb = await admin();
    const { id, ...fields } = data;
    if (id) {
      const { error } = await sb.from("contents").update(fields).eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await sb.from("contents").insert(fields);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteContent = createServerFn({ method: "POST" })
  .validator(z.object({ id: uuid }))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { error } = await sb.from("contents").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* -------------------------------- Offers --------------------------------- */

export const listOffers = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("offers")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
});

const offerSchema = z.object({
  id: uuid.optional(),
  name: z.string().min(1).max(160),
  description: z.string().max(3000).optional().nullable(),
  price: z.number().positive().max(1000000),
  starts_at: z.string().max(40).optional().nullable(),
  ends_at: z.string().max(40).optional().nullable(),
  plan_ids: z.array(uuid).max(20),
  content_ids: z.array(uuid).max(50),
  is_active: z.boolean(),
});

export const saveOffer = createServerFn({ method: "POST" })
  .validator(offerSchema)
  .handler(async ({ data }) => {
    const sb = await admin();
    if (!data.plan_ids.length && !data.content_ids.length) {
      throw new Error("Adicione ao menos um plano ou conteudo ao combo");
    }
    if (data.starts_at && data.ends_at && Date.parse(data.starts_at) >= Date.parse(data.ends_at)) {
      throw new Error("O fim da oferta deve ser posterior ao inicio");
    }
    const { id, ...fields } = data;
    const query = id
      ? sb.from("offers").update(fields).eq("id", id)
      : sb.from("offers").insert(fields);
    const { error } = await query;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteOffer = createServerFn({ method: "POST" })
  .validator(z.object({ id: uuid }))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { error } = await sb.from("offers").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------------- Customers ------------------------------- */

export const listCustomers = createServerFn({ method: "GET" }).handler(async () => {
  await admin();
  const rows = sqlite
    .prepare(
      `SELECT u.*,
        s.id AS subscription_id, s.status AS subscription_status,
        s.start_date, s.end_date, s.auto_renew, p.name AS plan_name,
        (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') AS purchases
       FROM users u
       LEFT JOIN subscriptions s ON s.id = (
         SELECT s2.id FROM subscriptions s2
         WHERE s2.user_id = u.id ORDER BY s2.end_date DESC LIMIT 1
       )
       LEFT JOIN plans p ON p.id = s.plan_id
       ORDER BY u.created_at DESC`,
    )
    .all() as Record<string, any>[];
  return rows.map((row) => ({
    ...row,
    is_adult_confirmed: Boolean(row.is_adult_confirmed),
    is_blocked: Boolean(row.is_blocked),
    auto_renew: Boolean(row.auto_renew),
    tags: JSON.parse(row.tags || "[]"),
  }));
});

export const getCustomerDetails = createServerFn({ method: "GET" })
  .validator(z.object({ id: uuid }))
  .handler(async ({ data }) => {
    await admin();
    const customer = sqlite.prepare("SELECT * FROM users WHERE id = ?").get(data.id) as
      | Record<string, any>
      | undefined;
    if (!customer) throw new Error("Cliente nao encontrado");
    const subscriptions = sqlite
      .prepare(
        `SELECT s.*, p.name AS plan_name FROM subscriptions s
         LEFT JOIN plans p ON p.id = s.plan_id
         WHERE s.user_id = ? ORDER BY s.end_date DESC`,
      )
      .all(data.id) as Record<string, any>[];
    const orders = sqlite
      .prepare(
        `SELECT o.*, COALESCE(p.name, c.title, f.name, 'Pedido') AS product_name
         FROM orders o
         LEFT JOIN plans p ON p.id = o.plan_id
         LEFT JOIN contents c ON c.id = o.content_id
         LEFT JOIN offers f ON f.id = o.offer_id
         WHERE o.user_id = ? ORDER BY o.created_at DESC`,
      )
      .all(data.id) as Record<string, any>[];
    const events = sqlite
      .prepare("SELECT * FROM customer_events WHERE user_id = ? ORDER BY created_at DESC")
      .all(data.id) as Record<string, any>[];
    return {
      customer: {
        ...customer,
        is_blocked: Boolean(customer.is_blocked),
        tags: JSON.parse(customer.tags || "[]"),
      },
      subscriptions: subscriptions.map((item) => ({
        ...item,
        auto_renew: Boolean(item.auto_renew),
      })),
      orders,
      events: events.map((item) => ({ ...item, metadata: JSON.parse(item.metadata || "{}") })),
    };
  });

export const updateCustomer = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: uuid,
      email: z.string().email().optional().nullable().or(z.literal("")),
      notes: z.string().max(5000).optional().nullable(),
      tags: z.array(z.string().min(1).max(40)).max(30),
      is_blocked: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    await admin();
    const current = sqlite.prepare("SELECT is_blocked FROM users WHERE id = ?").get(data.id) as
      | Record<string, any>
      | undefined;
    if (!current) throw new Error("Cliente nao encontrado");
    sqlite
      .prepare(
        `UPDATE users SET email = ?, notes = ?, tags = ?, is_blocked = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        data.email || null,
        data.notes || null,
        JSON.stringify([...new Set(data.tags.map((tag) => tag.trim()))]),
        data.is_blocked ? 1 : 0,
        new Date().toISOString(),
        data.id,
      );
    const blockedChanged = Boolean(current.is_blocked) !== data.is_blocked;
    recordCustomerEvent(
      data.id,
      blockedChanged
        ? data.is_blocked
          ? "customer_blocked"
          : "customer_unblocked"
        : "customer_updated",
      blockedChanged
        ? data.is_blocked
          ? "Cliente bloqueado"
          : "Cliente desbloqueado"
        : "Cadastro atualizado",
    );
    return { ok: true };
  });

const accessActionSchema = z.object({
  user_id: uuid,
  action: z.enum(["grant", "extend", "cancel", "set_auto_renew"]),
  plan_id: uuid.optional(),
  subscription_id: uuid.optional(),
  days: z.number().int().min(1).max(3650).optional(),
  auto_renew: z.boolean().optional(),
});

export const manageCustomerAccess = createServerFn({ method: "POST" })
  .validator(accessActionSchema)
  .handler(async ({ data }) => {
    await admin();
    const now = new Date();
    let description = "Acesso atualizado";
    if (data.action === "grant") {
      if (!data.plan_id) throw new Error("Selecione um plano");
      const plan = sqlite.prepare("SELECT * FROM plans WHERE id = ?").get(data.plan_id) as
        | Record<string, any>
        | undefined;
      if (!plan) throw new Error("Plano nao encontrado");
      const isLifetime = plan.access_type === "lifetime";
      const days = data.days ?? Number(plan.duration_days);
      sqlite
        .prepare(
          `INSERT INTO subscriptions
           (id, user_id, plan_id, start_date, end_date, status, auto_renew, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          data.user_id,
          data.plan_id,
          now.toISOString(),
          isLifetime
            ? "9999-12-31T23:59:59.000Z"
            : new Date(now.getTime() + days * 86_400_000).toISOString(),
          !isLifetime && data.auto_renew ? 1 : 0,
          now.toISOString(),
          now.toISOString(),
        );
      description = isLifetime
        ? `Acesso liberado: ${plan.name} vitalicio`
        : `Acesso liberado: ${plan.name} por ${days} dias`;
    } else {
      if (!data.subscription_id) throw new Error("Acesso nao informado");
      const subscription = sqlite
        .prepare(
          `SELECT s.*, p.name AS plan_name FROM subscriptions s
           LEFT JOIN plans p ON p.id = s.plan_id WHERE s.id = ? AND s.user_id = ?`,
        )
        .get(data.subscription_id, data.user_id) as Record<string, any> | undefined;
      if (!subscription) throw new Error("Acesso nao encontrado");
      if (data.action === "extend") {
        const days = data.days ?? 30;
        const base = Math.max(now.getTime(), Date.parse(subscription.end_date));
        sqlite
          .prepare(
            `UPDATE subscriptions SET end_date = ?, status = 'active', renewal_notice_sent_at = NULL,
             expiration_notice_sent_at = NULL, updated_at = ? WHERE id = ?`,
          )
          .run(
            new Date(base + days * 86_400_000).toISOString(),
            now.toISOString(),
            subscription.id,
          );
        description = `Acesso estendido: ${subscription.plan_name ?? "Plano"} por ${days} dias`;
      } else if (data.action === "cancel") {
        sqlite
          .prepare("UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE id = ?")
          .run(now.toISOString(), subscription.id);
        description = `Acesso cancelado: ${subscription.plan_name ?? "Plano"}`;
      } else {
        sqlite
          .prepare("UPDATE subscriptions SET auto_renew = ?, updated_at = ? WHERE id = ?")
          .run(data.auto_renew ? 1 : 0, now.toISOString(), subscription.id);
        description = data.auto_renew
          ? `Renovacao automatica ativada: ${subscription.plan_name ?? "Plano"}`
          : `Renovacao automatica desativada: ${subscription.plan_name ?? "Plano"}`;
      }
    }
    recordCustomerEvent(data.user_id, `access_${data.action}`, description);
    return { ok: true };
  });

/* --------------------------------- Orders -------------------------------- */

export const listOrders = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("orders")
    .select("*, users(name, telegram_username, telegram_id), plans(name), contents(title)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).filter((order: any) => !order.hidden_at);
});

export const syncOrderPayment = createServerFn({ method: "POST" })
  .validator(z.object({ id: uuid }))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: payment } = await (sb as any)
      .from("payments")
      .select("provider_payment_id")
      .eq("order_id", data.id)
      .maybeSingle();
    if (!payment?.provider_payment_id) {
      throw new Error("O Mercado Pago ainda nÃ£o informou um pagamento para este pedido");
    }
    const { getMercadoPagoPayment } = await import("@/lib/mercado-pago.server");
    const remote = await getMercadoPagoPayment(payment.provider_payment_id);
    if (remote.status !== "approved") throw new Error(`Pagamento ${remote.status}`);
    const { fulfillOrder } = await import("@/lib/fulfillment.server");
    return fulfillOrder(sb, {
      orderId: data.id,
      providerPaymentId: String(remote.id),
      providerStatus: remote.status_detail,
      paidAt: remote.date_approved,
      amount: Number(remote.transaction_amount),
    });
  });

export const cancelOrder = createServerFn({ method: "POST" })
  .validator(z.object({ id: uuid }))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { error } = await sb.from("orders").update({ status: "canceled" }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const hideOrder = createServerFn({ method: "POST" })
  .validator(z.object({ id: uuid }))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { error } = await sb
      .from("orders")
      .update({ hidden_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ----------------------------- Broadcasts -------------------------------- */

const broadcastButtonSchema = z.discriminatedUnion("kind", [
  z.object({
    label: z.string().min(1).max(64),
    kind: z.literal("link"),
    url: z.string().url().max(1000),
  }),
  z.object({
    label: z.string().min(1).max(64),
    kind: z.enum(["plans", "offers", "menu"]),
    url: z.null().optional(),
  }),
  z.object({
    label: z.string().min(1).max(64),
    kind: z.literal("plan"),
    plan_id: uuid,
    url: z.null().optional(),
  }),
]);

export const listBroadcasts = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await (sb as any)
    .from("broadcasts")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
});

const broadcastSchema = z
  .object({
    id: uuid.optional(),
    title: z.string().min(1).max(160),
    message: z.string().trim().max(4000),
    image_url: z.string().max(1000).optional().nullable(),
    content_kind: z.enum(["custom", "telegram_message"]).default("custom"),
    source_chat_id: z
      .union([z.number().int(), z.string().trim().min(1).max(80)])
      .optional()
      .nullable(),
    source_message_id: z.number().int().positive().optional().nullable(),
    buttons: z.array(broadcastButtonSchema).max(6),
    interval_minutes: z.number().int().min(1).max(525600),
    audience_type: z.enum(["all", "plan", "purchase", "active", "inactive"]),
    audience_value: z.string().max(100).optional().nullable(),
    activity_days: z.number().int().min(1).max(3650),
    is_active: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.content_kind === "custom" && !value.message.trim() && !value.image_url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["message"],
        message: "Informe o texto, uma foto ou um video para a mensagem",
      });
    }
    if (value.content_kind === "telegram_message") {
      if (!value.source_chat_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["source_chat_id"],
          message: "Informe o chat de origem da mensagem",
        });
      }
      if (!value.source_message_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["source_message_id"],
          message: "Informe o ID da mensagem pronta",
        });
      }
    }
  });

export const saveBroadcast = createServerFn({ method: "POST" })
  .validator(broadcastSchema)
  .handler(async ({ data }) => {
    const sb = await admin();
    if (data.audience_type === "plan" && !data.audience_value) {
      throw new Error("Selecione o plano da segmentacao");
    }
    for (const button of data.buttons) {
      if (button.kind !== "plan") continue;
      const plan = sqlite
        .prepare("SELECT id FROM plans WHERE id = ? AND is_active = 1")
        .get(button.plan_id);
      if (!plan) throw new Error(`O plano do botao "${button.label}" nao esta ativo`);
    }
    const { id, ...rawFields } = data;
    const fields = {
      ...rawFields,
      message:
        rawFields.content_kind === "telegram_message" && !rawFields.message.trim()
          ? "Mensagem pronta do Telegram"
          : rawFields.message,
      image_url: rawFields.content_kind === "telegram_message" ? null : rawFields.image_url,
      source_chat_id:
        rawFields.content_kind === "telegram_message" ? rawFields.source_chat_id : null,
      source_message_id:
        rawFields.content_kind === "telegram_message" ? rawFields.source_message_id : null,
    };
    if (id) {
      const { error } = await (sb as any).from("broadcasts").update(fields).eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await (sb as any).from("broadcasts").insert(fields);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteBroadcast = createServerFn({ method: "POST" })
  .validator(z.object({ id: uuid }))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { error } = await (sb as any).from("broadcasts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Sends one broadcast immediately to all bot users (manual "send now").
export const sendBroadcastNow = createServerFn({ method: "POST" })
  .validator(z.object({ id: uuid }))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { sendBroadcast } = await import("@/lib/broadcast.server");
    const { data: b, error } = await (sb as any)
      .from("broadcasts")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error || !b) throw new Error("Mensagem nÃ£o encontrada");
    const sent = await sendBroadcast(sb, b);
    return { ok: true, sent };
  });

/* ------------------------------- Settings -------------------------------- */

export const getSettings = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb.from("bot_settings").select("*").limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
});

const menuButtonSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-zA-Z0-9_-]+$/),
  label: z.string().min(1).max(64),
  action: z.enum(["plans", "offers", "myaccess", "support", "terms", "text", "url"]),
  value: z.string().max(4000).optional().nullable(),
  enabled: z.boolean(),
});

const settingsSchema = z
  .object({
    id: uuid,
    welcome_message: z.string().min(1).max(4000),
    welcome_image_url: z.string().max(1000).optional().nullable(),
    welcome_mode: z.enum(["custom", "telegram_message"]).default("custom"),
    welcome_source_chat_id: z.number().int().optional().nullable(),
    welcome_source_message_id: z.number().int().optional().nullable(),
    terms_text: z.string().min(1).max(8000),
    support_link: z.string().max(500).optional().nullable(),
    private_group_link: z.string().max(500).optional().nullable(),
    payment_info: z.string().max(4000).optional().nullable(),
    renewal_notice_days: z.number().int().min(1).max(30),
    expiration_message: z.string().max(4000).optional().nullable(),
    menu_buttons: z.array(menuButtonSchema).min(1).max(20),
  })
  .superRefine((settings, context) => {
    if (settings.welcome_mode !== "telegram_message") return;
    if (!settings.welcome_source_chat_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["welcome_source_chat_id"],
        message: "Informe o chat de origem da mensagem inicial",
      });
    }
    if (!settings.welcome_source_message_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["welcome_source_message_id"],
        message: "Informe o ID da mensagem inicial",
      });
    }
  });

export const saveSettings = createServerFn({ method: "POST" })
  .validator(settingsSchema)
  .handler(async ({ data }) => {
    const sb = await admin();
    const { id, ...rawFields } = data;
    const fields = {
      ...rawFields,
      welcome_source_chat_id:
        rawFields.welcome_mode === "telegram_message" ? rawFields.welcome_source_chat_id : null,
      welcome_source_message_id:
        rawFields.welcome_mode === "telegram_message" ? rawFields.welcome_source_message_id : null,
    };
    const { error } = await sb.from("bot_settings").update(fields).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
