import { randomUUID } from "node:crypto";
import QRCode from "qrcode";

import {
  grantImageBotDailyLimitBoost,
  grantImageBotPremiumAccess,
  getImageBotSettings,
  getImageBotPremiumPlan,
  imageBotSqlite,
  setImageBotUserCategory,
  type ImageBotCategory,
  type ImageBotSettingsRow,
} from "@/lib/image-bot-database.server";
import { createPixPayment } from "@/lib/mercado-pago.server";
import {
  editMessageTextWithToken,
  sendMessageWithToken,
  sendPhotoBufferWithToken,
  type InlineKeyboard,
} from "@/lib/telegram.server";

type ImageBotPaymentOrder = {
  id: string;
  telegram_user_id: number;
  category: ImageBotCategory;
  amount: number;
  status: "pending" | "paid" | "canceled" | "expired";
  provider_payment_id: string | null;
  pix_qr_code: string | null;
  pix_qr_code_base64: string | null;
  pix_ticket_url: string | null;
  raw_status: string | null;
  paid_at: string | null;
  telegram_chat_id: number | null;
  telegram_message_id: number | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type ImageBotLimitPaymentOrder = {
  id: string;
  telegram_user_id: number;
  amount: number;
  bonus_count: number;
  status: "pending" | "paid" | "canceled" | "expired";
  provider_payment_id: string | null;
  pix_qr_code: string | null;
  pix_qr_code_base64: string | null;
  pix_ticket_url: string | null;
  raw_status: string | null;
  paid_at: string | null;
  telegram_chat_id: number | null;
  telegram_message_id: number | null;
  access_type: "days" | "lifetime";
  access_days: number;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type ImageBotPremiumPaymentOrder = {
  id: string;
  telegram_user_id: number;
  plan_id: string | null;
  plan_name: string;
  amount: number;
  access_type: "days" | "lifetime";
  access_days: number;
  status: "pending" | "paid" | "canceled" | "expired";
  provider_payment_id: string | null;
  pix_qr_code: string | null;
  pix_qr_code_base64: string | null;
  pix_ticket_url: string | null;
  raw_status: string | null;
  paid_at: string | null;
  telegram_chat_id: number | null;
  telegram_message_id: number | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

const PIX_VALIDITY_MINUTES = 15;

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatPixExpiration(expiresAt: string | null) {
  if (!expiresAt) return "15 minutos";
  return new Date(expiresAt).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function limitBoostValidityLabel(order: ImageBotLimitPaymentOrder) {
  return order.access_type === "lifetime"
    ? "vitalício"
    : `${Math.max(1, order.access_days)} dia${order.access_days === 1 ? "" : "s"}`;
}

function createSmallPixQrCode(pixCode: string) {
  return QRCode.toBuffer(pixCode, {
    type: "png",
    width: 220,
    margin: 2,
    errorCorrectionLevel: "M",
  });
}

function renderTemplate(
  template: string,
  values: Partial<Record<"categoria" | "valor" | "dias", string | number>>,
) {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{{${key}}}`, String(value)),
    template,
  );
}

export function imageBotCategoryLabel(settings: ImageBotSettingsRow, category: ImageBotCategory) {
  return category === "hetero" ? settings.category_hetero_label : settings.category_trans_label;
}

export function imageBotCategoryPrice(settings: ImageBotSettingsRow, category: ImageBotCategory) {
  return Number(
    category === "hetero" ? settings.payment_hetero_price : settings.payment_trans_price,
  );
}

export function hasActiveImageBotPaidAccess(
  telegramUserId: number,
  category: ImageBotCategory,
  settings = getImageBotSettings(),
) {
  if (!settings.payment_enabled || imageBotCategoryPrice(settings, category) <= 0) return true;
  const access = imageBotSqlite
    .prepare(
      `SELECT expires_at
       FROM paid_access
       WHERE telegram_user_id = ? AND category = ? AND expires_at > ?
       LIMIT 1`,
    )
    .get(telegramUserId, category, new Date().toISOString()) as { expires_at: string } | undefined;
  return Boolean(access);
}

function getPendingPaymentOrder(
  telegramUserId: number,
  category: ImageBotCategory,
  amount: number,
) {
  const nowIso = new Date().toISOString();
  imageBotSqlite
    .prepare(
      `UPDATE payment_orders
       SET status = 'expired', updated_at = ?
       WHERE status = 'pending' AND (expires_at IS NULL OR expires_at <= ?)`,
    )
    .run(nowIso, nowIso);
  return imageBotSqlite
    .prepare(
      `SELECT *
       FROM payment_orders
       WHERE telegram_user_id = ? AND category = ? AND status = 'pending'
         AND amount = ? AND expires_at > ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(telegramUserId, category, amount, nowIso) as ImageBotPaymentOrder | undefined;
}

function imageBotLimitBoostCount(settings = getImageBotSettings()) {
  return Math.max(1, Math.trunc(Number(settings.limit_upgrade_bonus_count || 1)));
}

function getPendingLimitBoostOrder(input: {
  telegramUserId: number;
  amount: number;
  bonusCount: number;
  accessType: "days" | "lifetime";
  accessDays: number;
}) {
  const nowIso = new Date().toISOString();
  imageBotSqlite
    .prepare(
      `UPDATE limit_payment_orders
       SET status = 'expired', updated_at = ?
       WHERE status = 'pending' AND (expires_at IS NULL OR expires_at <= ?)`,
    )
    .run(nowIso, nowIso);
  return imageBotSqlite
    .prepare(
      `SELECT *
       FROM limit_payment_orders
       WHERE telegram_user_id = ? AND status = 'pending'
         AND amount = ? AND bonus_count = ? AND access_type = ? AND access_days = ?
         AND expires_at > ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(
      input.telegramUserId,
      input.amount,
      input.bonusCount,
      input.accessType,
      input.accessDays,
      nowIso,
    ) as ImageBotLimitPaymentOrder | undefined;
}

function getPendingPremiumOrder(telegramUserId: number, planId: string, amount: number) {
  const nowIso = new Date().toISOString();
  imageBotSqlite
    .prepare(
      `UPDATE premium_payment_orders
       SET status = 'expired', updated_at = ?
       WHERE status = 'pending' AND (expires_at IS NULL OR expires_at <= ?)`,
    )
    .run(nowIso, nowIso);
  return imageBotSqlite
    .prepare(
      `SELECT *
       FROM premium_payment_orders
       WHERE telegram_user_id = ? AND plan_id = ? AND status = 'pending'
         AND amount = ? AND expires_at > ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(telegramUserId, planId, amount, nowIso) as ImageBotPremiumPaymentOrder | undefined;
}

export async function createImageBotPixOrder(input: {
  telegramUserId: number;
  category: ImageBotCategory;
  payerName?: string | null;
}) {
  const settings = getImageBotSettings();
  const amount = imageBotCategoryPrice(settings, input.category);
  if (!settings.payment_enabled || amount <= 0) {
    throw new Error("Pagamento não está ativo para esta categoria");
  }

  const pending = getPendingPaymentOrder(input.telegramUserId, input.category, amount);
  if (pending?.pix_qr_code) {
    return { order: pending, settings, reused: true };
  }

  const recentSince = new Date(Date.now() - 15 * 60_000).toISOString();
  const recent = imageBotSqlite
    .prepare(
      `SELECT COUNT(*) AS total
       FROM payment_orders
       WHERE telegram_user_id = ? AND status = 'pending' AND created_at >= ?`,
    )
    .get(input.telegramUserId, recentSince) as { total: number };
  if (Number(recent.total) >= 5) {
    throw new Error("Você gerou muitos Pix pendentes. Aguarde alguns minutos.");
  }

  const orderId = randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + PIX_VALIDITY_MINUTES * 60_000).toISOString();
  const label = imageBotCategoryLabel(settings, input.category);
  const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  if (!publicBaseUrl) throw new Error("PUBLIC_BASE_URL não configurado");

  imageBotSqlite
    .prepare(
      `INSERT INTO payment_orders
       (id, telegram_user_id, category, amount, status, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .run(orderId, input.telegramUserId, input.category, amount, expiresAt, now, now);

  try {
    const pix = await createPixPayment({
      orderId,
      externalReference: `image:${orderId}`,
      title: `UpMídias - ${label}`,
      amount,
      payerEmail: `telegram-${input.telegramUserId}@example.com`,
      payerName: input.payerName || `Telegram ${input.telegramUserId}`,
      publicBaseUrl,
      expirationMinutes: PIX_VALIDITY_MINUTES,
    });
    imageBotSqlite
      .prepare(
        `UPDATE payment_orders
         SET provider_payment_id = ?, pix_qr_code = ?, pix_qr_code_base64 = ?,
             pix_ticket_url = ?, raw_status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        pix.paymentId,
        pix.qrCode,
        pix.qrCodeBase64 || null,
        pix.ticketUrl || null,
        pix.status,
        new Date().toISOString(),
        orderId,
      );
    const order = imageBotSqlite
      .prepare("SELECT * FROM payment_orders WHERE id = ?")
      .get(orderId) as ImageBotPaymentOrder;
    return { order, settings, reused: false };
  } catch (error) {
    imageBotSqlite.prepare("DELETE FROM payment_orders WHERE id = ?").run(orderId);
    throw error;
  }
}

export async function createImageBotLimitBoostPixOrder(input: {
  telegramUserId: number;
  payerName?: string | null;
}) {
  const settings = getImageBotSettings();
  const amount = Number(settings.limit_upgrade_price);
  const bonusCount = imageBotLimitBoostCount(settings);
  const accessType = settings.limit_upgrade_access_type;
  const accessDays =
    accessType === "lifetime" ? 0 : Math.max(1, settings.limit_upgrade_access_days);
  if (!settings.limit_upgrade_enabled || amount <= 0) {
    throw new Error("Compra de limite não está ativa");
  }
  const pending = getPendingLimitBoostOrder({
    telegramUserId: input.telegramUserId,
    amount,
    bonusCount,
    accessType,
    accessDays,
  });
  if (pending?.pix_qr_code) {
    return { order: pending, settings, reused: true };
  }

  const recentSince = new Date(Date.now() - 15 * 60_000).toISOString();
  const recent = imageBotSqlite
    .prepare(
      `SELECT COUNT(*) AS total
       FROM limit_payment_orders
       WHERE telegram_user_id = ? AND status = 'pending' AND created_at >= ?`,
    )
    .get(input.telegramUserId, recentSince) as { total: number };
  if (Number(recent.total) >= 5) {
    throw new Error("Você gerou muitos Pix pendentes. Aguarde alguns minutos.");
  }

  const orderId = randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + PIX_VALIDITY_MINUTES * 60_000).toISOString();
  const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  if (!publicBaseUrl) throw new Error("PUBLIC_BASE_URL não configurado");

  imageBotSqlite
    .prepare(
      `INSERT INTO limit_payment_orders
       (id, telegram_user_id, amount, bonus_count, status, access_type, access_days,
        expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    )
    .run(
      orderId,
      input.telegramUserId,
      amount,
      bonusCount,
      accessType,
      accessDays,
      expiresAt,
      now,
      now,
    );

  try {
    const pix = await createPixPayment({
      orderId,
      externalReference: `image-limit:${orderId}`,
      title: `UpMídias - mais ${bonusCount} mídias hoje`,
      amount,
      payerEmail: `telegram-${input.telegramUserId}@example.com`,
      payerName: input.payerName || `Telegram ${input.telegramUserId}`,
      publicBaseUrl,
      expirationMinutes: PIX_VALIDITY_MINUTES,
    });
    imageBotSqlite
      .prepare(
        `UPDATE limit_payment_orders
         SET provider_payment_id = ?, pix_qr_code = ?, pix_qr_code_base64 = ?,
             pix_ticket_url = ?, raw_status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        pix.paymentId,
        pix.qrCode,
        pix.qrCodeBase64 || null,
        pix.ticketUrl || null,
        pix.status,
        new Date().toISOString(),
        orderId,
      );
    const order = imageBotSqlite
      .prepare("SELECT * FROM limit_payment_orders WHERE id = ?")
      .get(orderId) as ImageBotLimitPaymentOrder;
    return { order, settings, reused: false };
  } catch (error) {
    imageBotSqlite.prepare("DELETE FROM limit_payment_orders WHERE id = ?").run(orderId);
    throw error;
  }
}

export async function createImageBotPremiumPixOrder(input: {
  telegramUserId: number;
  planId: string;
  payerName?: string | null;
}) {
  const plan = getImageBotPremiumPlan(input.planId);
  if (!plan?.is_active || Number(plan.price) <= 0) {
    throw new Error("Plano Premium indisponivel");
  }
  const amount = Number(plan.price);
  const pending = getPendingPremiumOrder(input.telegramUserId, plan.id, amount);
  if (pending?.pix_qr_code) {
    return { order: pending, plan, reused: true };
  }

  const recentSince = new Date(Date.now() - 15 * 60_000).toISOString();
  const recent = imageBotSqlite
    .prepare(
      `SELECT COUNT(*) AS total
       FROM premium_payment_orders
       WHERE telegram_user_id = ? AND status = 'pending' AND created_at >= ?`,
    )
    .get(input.telegramUserId, recentSince) as { total: number };
  if (Number(recent.total) >= 5) {
    throw new Error("Você gerou muitos Pix pendentes. Aguarde alguns minutos.");
  }

  const orderId = randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + PIX_VALIDITY_MINUTES * 60_000).toISOString();
  const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  if (!publicBaseUrl) throw new Error("PUBLIC_BASE_URL não configurado");

  imageBotSqlite
    .prepare(
      `INSERT INTO premium_payment_orders
       (id, telegram_user_id, plan_id, plan_name, amount, access_type, access_days,
        status, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .run(
      orderId,
      input.telegramUserId,
      plan.id,
      plan.name,
      amount,
      plan.access_type,
      plan.access_days,
      expiresAt,
      now,
      now,
    );

  try {
    const pix = await createPixPayment({
      orderId,
      externalReference: `image-premium:${orderId}`,
      title: `UpMídias Premium - ${plan.name}`,
      amount,
      payerEmail: `telegram-${input.telegramUserId}@example.com`,
      payerName: input.payerName || `Telegram ${input.telegramUserId}`,
      publicBaseUrl,
      expirationMinutes: PIX_VALIDITY_MINUTES,
    });
    imageBotSqlite
      .prepare(
        `UPDATE premium_payment_orders
         SET provider_payment_id = ?, pix_qr_code = ?, pix_qr_code_base64 = ?,
             pix_ticket_url = ?, raw_status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        pix.paymentId,
        pix.qrCode,
        pix.qrCodeBase64 || null,
        pix.ticketUrl || null,
        pix.status,
        new Date().toISOString(),
        orderId,
      );
    const order = imageBotSqlite
      .prepare("SELECT * FROM premium_payment_orders WHERE id = ?")
      .get(orderId) as ImageBotPremiumPaymentOrder;
    return { order, plan, reused: false };
  } catch (error) {
    imageBotSqlite.prepare("DELETE FROM premium_payment_orders WHERE id = ?").run(orderId);
    throw error;
  }
}

export async function sendImageBotPixOrder(input: {
  token: string;
  chatId: number;
  order: ImageBotPaymentOrder;
  settings: ImageBotSettingsRow;
}) {
  if (!input.order.pix_qr_code) throw new Error("Pix não encontrado");
  const category = imageBotCategoryLabel(input.settings, input.order.category);
  const price = formatCurrency(Number(input.order.amount));
  const keyboard: InlineKeyboard = [
    [{ text: "Copiar Pix copia e cola", copy_text: { text: input.order.pix_qr_code } }],
    [{ text: "Ver QR Code", callback_data: `ipix_qr:${input.order.id}` }],
  ];
  const safeKeyboard = input.order.pix_qr_code.length <= 256 ? keyboard : keyboard.slice(1);
  const prompt = renderTemplate(input.settings.payment_prompt, {
    categoria: category,
    valor: price,
    dias: input.settings.payment_access_days,
  });
  const response = await sendMessageWithToken(
    input.token,
    input.chatId,
    `<b>Pix gerado</b>\n\n${escapeHtml(prompt)}\n\n<b>Categoria:</b> ${escapeHtml(
      category,
    )}\n<b>Valor:</b> ${price}\n<b>Acesso:</b> ${input.settings.payment_access_days} dias\n\n<b>Pix copia e cola:</b>\n<code>${escapeHtml(
      input.order.pix_qr_code,
    )}</code>\n\nPix valido ate ${formatPixExpiration(input.order.expires_at)}.`,
    safeKeyboard,
  );
  const messageId = Number(response.result?.message_id);
  if (Number.isFinite(messageId)) {
    imageBotSqlite
      .prepare(
        `UPDATE payment_orders
         SET telegram_chat_id = ?, telegram_message_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(input.chatId, messageId, new Date().toISOString(), input.order.id);
  }
}

export async function sendImageBotLimitBoostPixOrder(input: {
  token: string;
  chatId: number;
  order: ImageBotLimitPaymentOrder;
}) {
  if (!input.order.pix_qr_code) throw new Error("Pix não encontrado");
  const price = formatCurrency(Number(input.order.amount));
  const keyboard: InlineKeyboard = [
    [{ text: "Copiar Pix copia e cola", copy_text: { text: input.order.pix_qr_code } }],
    [{ text: "Ver QR Code", callback_data: `ilimit_qr:${input.order.id}` }],
  ];
  const safeKeyboard = input.order.pix_qr_code.length <= 256 ? keyboard : keyboard.slice(1);
  const response = await sendMessageWithToken(
    input.token,
    input.chatId,
    `<b>Pix gerado</b>\n\n<b>Pacote:</b> +${input.order.bonus_count} mídias por dia\n<b>Validade do benefício:</b> ${limitBoostValidityLabel(
      input.order,
    )}\n<b>Valor:</b> ${price}\n\nAssim que o pagamento aprovar, seu limite diário aumenta automaticamente.\n\n<b>Pix copia e cola:</b>\n<code>${escapeHtml(
      input.order.pix_qr_code,
    )}</code>\n\nPix valido ate ${formatPixExpiration(input.order.expires_at)}.`,
    safeKeyboard,
  );
  const messageId = Number(response.result?.message_id);
  if (Number.isFinite(messageId)) {
    imageBotSqlite
      .prepare(
        `UPDATE limit_payment_orders
         SET telegram_chat_id = ?, telegram_message_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(input.chatId, messageId, new Date().toISOString(), input.order.id);
  }
}

export async function sendImageBotPremiumPixOrder(input: {
  token: string;
  chatId: number;
  order: ImageBotPremiumPaymentOrder;
  messageId?: number;
}) {
  if (!input.order.pix_qr_code) throw new Error("Pix não encontrado");
  const price = formatCurrency(Number(input.order.amount));
  const validity =
    input.order.access_type === "lifetime"
      ? "Vitalício"
      : `${input.order.access_days} dia${input.order.access_days === 1 ? "" : "s"}`;
  const plan = input.order.plan_id ? getImageBotPremiumPlan(input.order.plan_id) : null;
  const approvalMessage =
    plan?.allow_favorites === false
      ? "Depois da aprovação, o plano será liberado automaticamente."
      : "Depois da aprovação, os favoritos serão liberados automaticamente.";
  const copyRow: InlineKeyboard[number] = [
    { text: "Copiar Pix copia e cola", copy_text: { text: input.order.pix_qr_code } },
  ];
  const navigationRows: InlineKeyboard = [
    [{ text: "Ver QR Code", callback_data: `ipremium_qr:${input.order.id}` }],
    [
      input.order.plan_id
        ? { text: "Voltar ao plano", callback_data: `ipremium:plan:${input.order.plan_id}` }
        : { text: "Planos Premium", callback_data: "ipremium:menu" },
    ],
  ];
  const safeKeyboard =
    input.order.pix_qr_code.length <= 256 ? [copyRow, ...navigationRows] : navigationRows;
  const message = `<b>Pix Premium gerado</b>\n\n<b>Plano:</b> ${escapeHtml(
    input.order.plan_name,
  )}\n<b>Validade:</b> ${validity}\n<b>Valor:</b> ${price}\n\n${approvalMessage}\n\n<b>Pix copia e cola:</b>\n<code>${escapeHtml(
    input.order.pix_qr_code,
  )}</code>\n\nPix valido ate ${formatPixExpiration(input.order.expires_at)}.`;
  if (input.messageId && Number.isFinite(input.messageId)) {
    try {
      await editMessageTextWithToken(
        input.token,
        input.chatId,
        input.messageId,
        message,
        safeKeyboard,
      );
      imageBotSqlite
        .prepare(
          `UPDATE premium_payment_orders
           SET telegram_chat_id = ?, telegram_message_id = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(input.chatId, input.messageId, new Date().toISOString(), input.order.id);
      return;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.toLowerCase().includes("message is not modified")) {
        imageBotSqlite
          .prepare(
            `UPDATE premium_payment_orders
             SET telegram_chat_id = ?, telegram_message_id = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(input.chatId, input.messageId, new Date().toISOString(), input.order.id);
        return;
      }
      console.warn("[image-premium-pix-edit]", error);
      return;
    }
  }

  const response = await sendMessageWithToken(input.token, input.chatId, message, safeKeyboard);
  const messageId = Number(response.result?.message_id);
  if (Number.isFinite(messageId)) {
    imageBotSqlite
      .prepare(
        `UPDATE premium_payment_orders
         SET telegram_chat_id = ?, telegram_message_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(input.chatId, messageId, new Date().toISOString(), input.order.id);
  }
}

export async function sendImageBotPixQrCode(input: {
  token: string;
  chatId: number;
  telegramUserId: number;
  orderId: string;
}) {
  const order = imageBotSqlite
    .prepare("SELECT * FROM payment_orders WHERE id = ? AND telegram_user_id = ?")
    .get(input.orderId, input.telegramUserId) as ImageBotPaymentOrder | undefined;
  if (!order?.pix_qr_code) throw new Error("Pix não encontrado");

  const keyboard: InlineKeyboard = [
    [{ text: "Copiar Pix copia e cola", copy_text: { text: order.pix_qr_code } }],
  ];
  const safeKeyboard = order.pix_qr_code.length <= 256 ? keyboard : [];
  const qrCode = await createSmallPixQrCode(order.pix_qr_code);
  await sendPhotoBufferWithToken(
    input.token,
    input.chatId,
    qrCode,
    `upmídias-pix-${order.id}.png`,
    `<b>QR Code Pix</b>\n\n<b>Valor:</b> ${formatCurrency(Number(order.amount))}`,
    safeKeyboard,
  );
}

export async function sendImageBotLimitBoostPixQrCode(input: {
  token: string;
  chatId: number;
  telegramUserId: number;
  orderId: string;
}) {
  const order = imageBotSqlite
    .prepare("SELECT * FROM limit_payment_orders WHERE id = ? AND telegram_user_id = ?")
    .get(input.orderId, input.telegramUserId) as ImageBotLimitPaymentOrder | undefined;
  if (!order?.pix_qr_code) throw new Error("Pix não encontrado");

  const keyboard: InlineKeyboard = [
    [{ text: "Copiar Pix copia e cola", copy_text: { text: order.pix_qr_code } }],
  ];
  const safeKeyboard = order.pix_qr_code.length <= 256 ? keyboard : [];
  const qrCode = await createSmallPixQrCode(order.pix_qr_code);
  await sendPhotoBufferWithToken(
    input.token,
    input.chatId,
    qrCode,
    `upmídias-limite-${order.id}.png`,
    `<b>QR Code Pix</b>\n\n<b>Pacote:</b> mais ${order.bonus_count} mídias hoje\n<b>Valor:</b> ${formatCurrency(
      Number(order.amount),
    )}`,
    safeKeyboard,
  );
}

export async function sendImageBotPremiumPixQrCode(input: {
  token: string;
  chatId: number;
  telegramUserId: number;
  orderId: string;
}) {
  const order = imageBotSqlite
    .prepare("SELECT * FROM premium_payment_orders WHERE id = ? AND telegram_user_id = ?")
    .get(input.orderId, input.telegramUserId) as ImageBotPremiumPaymentOrder | undefined;
  if (!order?.pix_qr_code) throw new Error("Pix não encontrado");

  const keyboard: InlineKeyboard = [
    [{ text: "Copiar Pix copia e cola", copy_text: { text: order.pix_qr_code } }],
  ];
  const safeKeyboard = order.pix_qr_code.length <= 256 ? keyboard : [];
  const qrCode = await createSmallPixQrCode(order.pix_qr_code);
  await sendPhotoBufferWithToken(
    input.token,
    input.chatId,
    qrCode,
    `upmídias-premium-${order.id}.png`,
    `<b>QR Code Pix Premium</b>\n\n<b>Plano:</b> ${escapeHtml(
      order.plan_name,
    )}\n<b>Valor:</b> ${formatCurrency(Number(order.amount))}`,
    safeKeyboard,
  );
}

export async function fulfillImageBotPayment(input: {
  token: string | null;
  orderId: string;
  providerPaymentId: string;
  providerStatus: string;
  paidAt: string | null;
  amount: number;
}) {
  const settings = getImageBotSettings();
  const now = new Date();
  const nowIso = now.toISOString();
  const order = imageBotSqlite
    .prepare("SELECT * FROM payment_orders WHERE id = ?")
    .get(input.orderId) as ImageBotPaymentOrder | undefined;
  if (!order) throw new Error("Pedido do UpMídias não encontrado");
  if (order.status === "paid") return { ok: true, orderId: order.id, alreadyPaid: true };
  if (Math.round(Number(order.amount) * 100) !== Math.round(Number(input.amount) * 100)) {
    throw new Error("Valor pago diferente do pedido UpMídias");
  }

  const expiresAt = imageBotSqlite.transaction(() => {
    imageBotSqlite
      .prepare(
        `UPDATE payment_orders
         SET status = 'paid', provider_payment_id = ?, raw_status = ?, paid_at = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(input.providerPaymentId, input.providerStatus, input.paidAt ?? nowIso, nowIso, order.id);

    const existing = imageBotSqlite
      .prepare(
        `SELECT expires_at
         FROM paid_access
         WHERE telegram_user_id = ? AND category = ?`,
      )
      .get(order.telegram_user_id, order.category) as { expires_at: string } | undefined;
    const baseMs = Math.max(
      now.getTime(),
      existing?.expires_at ? Date.parse(existing.expires_at) : 0,
    );
    const end = new Date(
      baseMs + Math.max(1, Number(settings.payment_access_days || 30)) * 86_400_000,
    );
    imageBotSqlite
      .prepare(
        `INSERT INTO paid_access
         (id, telegram_user_id, category, order_id, starts_at, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(telegram_user_id, category) DO UPDATE SET
           order_id = excluded.order_id,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        randomUUID(),
        order.telegram_user_id,
        order.category,
        order.id,
        nowIso,
        end.toISOString(),
        nowIso,
        nowIso,
      );
    return end;
  })();

  setImageBotUserCategory(order.telegram_user_id, order.category);

  if (input.token) {
    const category = imageBotCategoryLabel(settings, order.category);
    const success = renderTemplate(settings.payment_success_message, {
      categoria: category,
      valor: formatCurrency(Number(order.amount)),
      dias: settings.payment_access_days,
    });
    await sendMessageWithToken(
      input.token,
      order.telegram_user_id,
      `<b>${escapeHtml(success)}</b>\n\nValido ate ${expiresAt.toLocaleDateString(
        "pt-BR",
      )}. Toque em ${escapeHtml(category)} no menu e escolha fotos, vídeos ou aleatorio.`,
    ).catch((error) => console.warn("[image-payment-confirmation]", error));

    if (order.telegram_chat_id && order.telegram_message_id) {
      await editMessageTextWithToken(
        input.token,
        order.telegram_chat_id,
        order.telegram_message_id,
        `Pagamento confirmado.\n\nAcesso a ${escapeHtml(category)} liberado ate ${expiresAt.toLocaleDateString(
          "pt-BR",
        )}.`,
      ).catch((error) => console.warn("[image-payment-message-update]", error));
    }
  }

  return { ok: true, orderId: order.id };
}

export async function fulfillImageBotLimitBoostPayment(input: {
  token: string | null;
  orderId: string;
  providerPaymentId: string;
  providerStatus: string;
  paidAt: string | null;
  amount: number;
}) {
  const now = new Date();
  const nowIso = now.toISOString();
  const order = imageBotSqlite
    .prepare("SELECT * FROM limit_payment_orders WHERE id = ?")
    .get(input.orderId) as ImageBotLimitPaymentOrder | undefined;
  if (!order) throw new Error("Pedido de limite do UpMídias não encontrado");
  if (order.status === "paid") {
    return { ok: true, orderId: order.id, bonusCount: order.bonus_count, alreadyPaid: true };
  }
  if (Math.round(Number(order.amount) * 100) !== Math.round(Number(input.amount) * 100)) {
    throw new Error("Valor pago diferente do pedido de limite UpMídias");
  }

  const granted = imageBotSqlite.transaction(() => {
    imageBotSqlite
      .prepare(
        `UPDATE limit_payment_orders
         SET status = 'paid', provider_payment_id = ?, raw_status = ?, paid_at = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(input.providerPaymentId, input.providerStatus, input.paidAt ?? nowIso, nowIso, order.id);

    return grantImageBotDailyLimitBoost({
      telegramUserId: order.telegram_user_id,
      orderId: order.id,
      bonusCount: order.bonus_count,
      accessType: order.access_type,
      accessDays: order.access_days,
      now,
    });
  })();
  const validity =
    order.access_type === "lifetime"
      ? "sem vencimento"
      : `por ${Math.max(1, order.access_days)} dia${order.access_days === 1 ? "" : "s"}`;

  if (input.token) {
    await sendMessageWithToken(
      input.token,
      order.telegram_user_id,
      `<b>Pagamento confirmado!</b>\n\nSeu limite diário recebeu +${granted.bonusCount} mídias por dia, ${validity}.`,
    ).catch((error) => console.warn("[image-limit-payment-confirmation]", error));

    if (order.telegram_chat_id && order.telegram_message_id) {
      await editMessageTextWithToken(
        input.token,
        order.telegram_chat_id,
        order.telegram_message_id,
        `Pagamento confirmado.\n\nSeu limite diário recebeu +${granted.bonusCount} mídias por dia, ${validity}.`,
      ).catch((error) => console.warn("[image-limit-payment-message-update]", error));
    }
  }

  return {
    ok: true,
    orderId: order.id,
    bonusCount: granted.bonusCount,
    expiresAt: granted.expiresAt,
  };
}

export async function fulfillImageBotPremiumPayment(input: {
  token: string | null;
  orderId: string;
  providerPaymentId: string;
  providerStatus: string;
  paidAt: string | null;
  amount: number;
}) {
  const nowIso = new Date().toISOString();
  const order = imageBotSqlite
    .prepare("SELECT * FROM premium_payment_orders WHERE id = ?")
    .get(input.orderId) as ImageBotPremiumPaymentOrder | undefined;
  if (!order) throw new Error("Pedido Premium do UpMídias não encontrado");
  if (order.status === "paid") return { ok: true, orderId: order.id, alreadyPaid: true };
  if (Math.round(Number(order.amount) * 100) !== Math.round(Number(input.amount) * 100)) {
    throw new Error("Valor pago diferente do plano Premium");
  }
  if (!order.plan_id) throw new Error("Plano Premium do pedido não encontrado");

  const access = imageBotSqlite.transaction(() => {
    imageBotSqlite
      .prepare(
        `UPDATE premium_payment_orders
         SET status = 'paid', provider_payment_id = ?, raw_status = ?, paid_at = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(input.providerPaymentId, input.providerStatus, input.paidAt ?? nowIso, nowIso, order.id);
    return grantImageBotPremiumAccess({
      telegramUserId: order.telegram_user_id,
      planId: order.plan_id!,
      source: "payment",
      orderId: order.id,
      actor: `mercado-pago:${input.providerPaymentId}`,
    });
  })();

  if (input.token) {
    const validity = access.expiresAt
      ? `ate ${new Date(access.expiresAt).toLocaleDateString("pt-BR")}`
      : "de forma vitalicia";
    await sendMessageWithToken(
      input.token,
      order.telegram_user_id,
      access.plan.allow_favorites
        ? `<b>Pagamento confirmado!</b>\n\nSeu Premium foi liberado ${validity}. Agora você pode favoritar e abrir seus favoritos.`
        : `<b>Pagamento confirmado!</b>\n\nSeu plano ${escapeHtml(order.plan_name)} foi liberado ${validity}.`,
    ).catch((error) => console.warn("[image-premium-payment-confirmation]", error));

    if (order.telegram_chat_id && order.telegram_message_id) {
      await editMessageTextWithToken(
        input.token,
        order.telegram_chat_id,
        order.telegram_message_id,
        `Pagamento confirmado.\n\nPremium ${escapeHtml(order.plan_name)} liberado ${validity}.`,
      ).catch((error) => console.warn("[image-premium-payment-message-update]", error));
    }
  }

  return { ok: true, orderId: order.id, expiresAt: access.expiresAt };
}

export function updateImageBotPaymentRawStatus(orderId: string, rawStatus: string) {
  imageBotSqlite
    .prepare("UPDATE payment_orders SET raw_status = ?, updated_at = ? WHERE id = ?")
    .run(rawStatus, new Date().toISOString(), orderId);
}

export function updateImageBotLimitBoostPaymentRawStatus(orderId: string, rawStatus: string) {
  imageBotSqlite
    .prepare("UPDATE limit_payment_orders SET raw_status = ?, updated_at = ? WHERE id = ?")
    .run(rawStatus, new Date().toISOString(), orderId);
}

export function updateImageBotPremiumPaymentRawStatus(orderId: string, rawStatus: string) {
  imageBotSqlite
    .prepare("UPDATE premium_payment_orders SET raw_status = ?, updated_at = ? WHERE id = ?")
    .run(rawStatus, new Date().toISOString(), orderId);
}
