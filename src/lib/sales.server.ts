import { randomUUID } from "node:crypto";

import { localDb, sqlite } from "./database.server";
import { createPixPayment, getMercadoPagoPayment } from "./mercado-pago.server";
import { getSalesPaymentReference } from "./sales-bot-runtime.server";
import { sendMessage, sendPhotoBuffer, type InlineKeyboard } from "./telegram.server";

type ProductRef = { plan_id?: string; content_id?: string; offer_id?: string };

type Product = {
  label: string;
  description: string | null;
  amount: number;
  ref: ProductRef;
};

type PixOrderResult = {
  orderId: string;
  product: Product;
  paymentId: string;
  status: string;
  qrCode: string;
  qrCodeBase64: string;
  ticketUrl: string;
  reused?: boolean;
};

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function effectivePlanPrice(plan: Record<string, any>, now = Date.now()) {
  const hasPromoPrice =
    plan.promo_price !== null && plan.promo_price !== undefined && plan.promo_price !== "";
  const promoPrice = Number(plan.promo_price);
  const starts = plan.promo_starts_at ? Date.parse(plan.promo_starts_at) : -Infinity;
  const ends = plan.promo_ends_at ? Date.parse(plan.promo_ends_at) : Infinity;
  if (
    hasPromoPrice &&
    Number.isFinite(promoPrice) &&
    promoPrice >= 0 &&
    now >= starts &&
    now <= ends
  ) {
    return promoPrice;
  }
  return Number(plan.price);
}

function resolveProduct(ref: ProductRef): Product {
  const now = Date.now();
  if (ref.plan_id) {
    const plan = sqlite
      .prepare("SELECT * FROM plans WHERE id = ? AND is_active = 1")
      .get(ref.plan_id) as Record<string, any> | undefined;
    if (!plan) throw new Error("Plano indisponivel");
    return {
      label: plan.name,
      description: plan.description,
      amount: effectivePlanPrice(plan, now),
      ref: { plan_id: plan.id },
    };
  }
  if (ref.content_id) {
    const content = sqlite
      .prepare("SELECT * FROM contents WHERE id = ? AND is_active = 1")
      .get(ref.content_id) as Record<string, any> | undefined;
    if (!content?.file_url) throw new Error("Conteudo indisponivel para entrega");
    return {
      label: content.title,
      description: content.description,
      amount: Number(content.price),
      ref: { content_id: content.id },
    };
  }
  if (ref.offer_id) {
    const offer = sqlite
      .prepare("SELECT * FROM offers WHERE id = ? AND is_active = 1")
      .get(ref.offer_id) as Record<string, any> | undefined;
    if (!offer) throw new Error("Oferta indisponivel");
    if (offer.starts_at && Date.parse(offer.starts_at) > now)
      throw new Error("Oferta ainda nao iniciou");
    if (offer.ends_at && Date.parse(offer.ends_at) < now) throw new Error("Oferta encerrada");
    return {
      label: offer.name,
      description: offer.description,
      amount: Number(offer.price),
      ref: { offer_id: offer.id },
    };
  }
  throw new Error("Produto invalido");
}

export async function createPixOrder(input: {
  userId: string;
  ref: ProductRef;
  autoRenew?: boolean;
}): Promise<PixOrderResult> {
  const user = sqlite.prepare("SELECT * FROM users WHERE id = ?").get(input.userId) as
    | Record<string, any>
    | undefined;
  if (!user) throw new Error("Cliente nao encontrado");
  if (user.is_blocked) throw new Error("Cliente bloqueado");
  if (!user.email) throw new Error("EMAIL_REQUIRED");

  const product = resolveProduct(input.ref);
  if (product.amount <= 0) throw new Error("O valor do produto deve ser maior que zero");

  const reuseSince = new Date(Date.now() - 15 * 60_000).toISOString();
  const reusable = sqlite
    .prepare(
      `SELECT o.id AS order_id, p.provider_payment_id, p.raw_status, p.status,
              p.pix_qr_code, p.pix_qr_code_base64, p.pix_ticket_url
       FROM orders o
       JOIN payments p ON p.order_id = o.id
       WHERE o.user_id = ?
         AND o.status = 'pending'
         AND p.status = 'pending'
         AND IFNULL(o.plan_id, '') = IFNULL(?, '')
         AND IFNULL(o.content_id, '') = IFNULL(?, '')
         AND IFNULL(o.offer_id, '') = IFNULL(?, '')
         AND o.auto_renew = ?
         AND o.amount = ?
         AND o.created_at >= ?
         AND p.pix_qr_code IS NOT NULL
       ORDER BY o.created_at DESC
       LIMIT 1`,
    )
    .get(
      input.userId,
      product.ref.plan_id ?? null,
      product.ref.content_id ?? null,
      product.ref.offer_id ?? null,
      input.autoRenew ? 1 : 0,
      product.amount,
      reuseSince,
    ) as
    | {
        order_id: string;
        provider_payment_id: string | null;
        raw_status: string | null;
        status: string;
        pix_qr_code: string;
        pix_qr_code_base64: string | null;
        pix_ticket_url: string | null;
      }
    | undefined;

  if (reusable) {
    return {
      orderId: reusable.order_id,
      product,
      paymentId: reusable.provider_payment_id ?? "",
      status: reusable.raw_status ?? reusable.status,
      qrCode: reusable.pix_qr_code,
      qrCodeBase64: reusable.pix_qr_code_base64 ?? "",
      ticketUrl: reusable.pix_ticket_url ?? "",
      reused: true,
    };
  }

  const pendingLimitWindow = new Date(Date.now() - 30 * 60_000).toISOString();
  const recentPending = sqlite
    .prepare(
      `SELECT COUNT(*) AS total
       FROM orders
       WHERE user_id = ? AND status = 'pending' AND created_at >= ?`,
    )
    .get(input.userId, pendingLimitWindow) as { total: number };
  if (Number(recentPending.total) >= 5) {
    throw new Error("Muitos Pix pendentes. Aguarde alguns minutos antes de tentar novamente.");
  }

  const orderId = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO orders
       (id, user_id, plan_id, content_id, offer_id, auto_renew, amount, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(
      orderId,
      input.userId,
      product.ref.plan_id ?? null,
      product.ref.content_id ?? null,
      product.ref.offer_id ?? null,
      input.autoRenew ? 1 : 0,
      product.amount,
      now,
      now,
    );

  try {
    const publicBaseUrl = process.env.PUBLIC_BASE_URL;
    if (!publicBaseUrl) throw new Error("PUBLIC_BASE_URL nao configurado");
    const pix = await createPixPayment({
      orderId,
      externalReference: getSalesPaymentReference(orderId),
      title: product.label,
      amount: product.amount,
      payerEmail: user.email,
      payerName: user.name,
      publicBaseUrl,
    });
    sqlite
      .prepare(
        `INSERT INTO payments
         (id, order_id, provider, provider_payment_id, payment_url, pix_qr_code,
          pix_qr_code_base64, pix_ticket_url, status, raw_status, amount, created_at, updated_at)
         VALUES (?, ?, 'mercado_pago', ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        orderId,
        pix.paymentId,
        pix.ticketUrl || null,
        pix.qrCode,
        pix.qrCodeBase64 || null,
        pix.ticketUrl || null,
        pix.status,
        product.amount,
        now,
        now,
      );
    recordCustomerEvent(input.userId, "order_created", `Pedido criado: ${product.label}`, {
      order_id: orderId,
      amount: product.amount,
    });
    return { orderId, product, ...pix };
  } catch (error) {
    sqlite.prepare("DELETE FROM orders WHERE id = ?").run(orderId);
    throw error;
  }
}

export async function sendPixOrder(
  chatId: number | string,
  order: Awaited<ReturnType<typeof createPixOrder>>,
) {
  const price = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    order.product.amount,
  );
  const keyboard: InlineKeyboard = [
    [{ text: "📋 Copiar Pix copia e cola", copy_text: { text: order.qrCode } }],
    [{ text: "✅ Verificar pagamento", callback_data: `pix_check:${order.orderId}` }],
    [{ text: "Ver QR Code", callback_data: `pix_qr:${order.orderId}` }],
    [{ text: "Voltar ao menu", callback_data: "menu" }],
  ];
  const safeKeyboard = order.qrCode.length <= 256 ? keyboard : keyboard.slice(1);
  const caption =
    `<b>Pix gerado</b>\n\n${escapeHtml(order.product.label)}\n` +
    `<b>Valor:</b> ${price}\n\n` +
    `<b>Pix copia e cola:</b>\n<code>${escapeHtml(order.qrCode)}</code>\n\n` +
    `Escaneie o QR Code ou toque no botão para copiar.`;
  const response = await sendMessage(
    chatId,
    caption.replace(
      /Escaneie[\s\S]*$/,
      "Copie o codigo acima e pague pelo app do seu banco. Se preferir escanear, toque em Ver QR Code.",
    ),
    safeKeyboard,
  );
  const messageId = Number(response.result?.message_id);
  if (Number.isFinite(messageId)) {
    sqlite
      .prepare(
        `UPDATE payments SET telegram_chat_id = ?, telegram_message_id = ?,
         telegram_message_type = ?, updated_at = ? WHERE order_id = ?`,
      )
      .run(Number(chatId), messageId, "text", new Date().toISOString(), order.orderId);
  }
}

export async function sendPixQrCode(chatId: number | string, orderId: string) {
  const payment = sqlite
    .prepare(
      `SELECT p.pix_qr_code, p.pix_qr_code_base64, p.pix_ticket_url,
              o.amount,
              COALESCE(plans.name, contents.title, offers.name, 'Pedido') AS product_name
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN plans ON plans.id = o.plan_id
       LEFT JOIN contents ON contents.id = o.content_id
       LEFT JOIN offers ON offers.id = o.offer_id
       WHERE p.order_id = ?`,
    )
    .get(orderId) as
    | {
        pix_qr_code: string | null;
        pix_qr_code_base64: string | null;
        pix_ticket_url: string | null;
        amount: number | null;
        product_name: string | null;
      }
    | undefined;

  if (!payment?.pix_qr_code) throw new Error("Pix nao encontrado");
  const price = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(payment.amount ?? 0),
  );
  const keyboard: InlineKeyboard = [
    [{ text: "Copiar Pix copia e cola", copy_text: { text: payment.pix_qr_code } }],
    ...(payment.pix_ticket_url ? [[{ text: "Abrir Pix", url: payment.pix_ticket_url }]] : []),
    [{ text: "Voltar ao menu", callback_data: "menu" }],
  ];
  const safeKeyboard = payment.pix_qr_code.length <= 256 ? keyboard : keyboard.slice(1);

  if (!payment.pix_qr_code_base64) {
    await sendMessage(
      chatId,
      "<b>QR Code indisponivel</b>\n\nUse o Pix copia e cola enviado na mensagem anterior.",
      safeKeyboard,
    );
    return;
  }

  await sendPhotoBuffer(
    chatId,
    Buffer.from(payment.pix_qr_code_base64, "base64"),
    `pix-${orderId}.png`,
    `<b>QR Code Pix</b>\n\n${escapeHtml(payment.product_name ?? "Pedido")}\n<b>Valor:</b> ${price}`,
    safeKeyboard,
  );
}

export async function checkSalesOrderPayment(input: { orderId: string; userId: string }) {
  const order = sqlite
    .prepare(
      `SELECT o.user_id, o.status, o.delivery_sent_at, p.provider_payment_id
       FROM orders o
       LEFT JOIN payments p ON p.order_id = o.id
       WHERE o.id = ?`,
    )
    .get(input.orderId) as
    | {
        user_id: string;
        status: string;
        delivery_sent_at: string | null;
        provider_payment_id: string | null;
      }
    | undefined;
  if (!order || order.user_id !== input.userId) {
    throw new Error("Pedido nao encontrado para esta conta");
  }
  if (!order.provider_payment_id) {
    throw new Error("Pagamento ainda nao registrado no Mercado Pago");
  }
  if (order.status === "paid" && order.delivery_sent_at) {
    return { status: "approved", alreadyDelivered: true };
  }

  const payment = await getMercadoPagoPayment(order.provider_payment_id);
  if (
    payment.external_reference &&
    payment.external_reference !== getSalesPaymentReference(input.orderId)
  ) {
    throw new Error("Pagamento nao pertence a este pedido");
  }
  await localDb
    .from("payments")
    .update({ raw_status: payment.status })
    .eq("order_id", input.orderId);

  if (payment.status !== "approved") {
    return { status: payment.status, alreadyDelivered: false };
  }
  if (payment.currency_id !== "BRL") throw new Error("Moeda inesperada no pagamento");

  const { fulfillOrder } = await import("./fulfillment.server");
  await fulfillOrder(localDb, {
    orderId: input.orderId,
    providerPaymentId: String(payment.id),
    providerStatus: payment.status_detail,
    paidAt: payment.date_approved,
    amount: Number(payment.transaction_amount),
  });
  return { status: "approved", alreadyDelivered: false };
}

export async function runPendingPixReminders() {
  const now = new Date();
  const nowIso = now.toISOString();
  const dueBefore = new Date(now.getTime() - 10 * 60_000).toISOString();
  const notOlderThan = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const rows = sqlite
    .prepare(
      `SELECT o.id AS order_id, o.user_id, o.amount, u.telegram_id, u.is_blocked,
              p.pix_qr_code, p.pix_ticket_url,
              COALESCE(plans.name, contents.title, offers.name, 'Pedido') AS product_name
       FROM orders o
       JOIN users u ON u.id = o.user_id
       JOIN payments p ON p.order_id = o.id
       LEFT JOIN plans ON plans.id = o.plan_id
       LEFT JOIN contents ON contents.id = o.content_id
       LEFT JOIN offers ON offers.id = o.offer_id
       WHERE o.status = 'pending'
         AND p.status = 'pending'
         AND o.pix_reminder_sent_at IS NULL
         AND o.created_at <= ?
         AND o.created_at >= ?
       ORDER BY o.created_at ASC
       LIMIT 50`,
    )
    .all(dueBefore, notOlderThan) as Array<{
    order_id: string;
    user_id: string;
    amount: number;
    telegram_id: number;
    is_blocked: number;
    pix_qr_code: string | null;
    pix_ticket_url: string | null;
    product_name: string | null;
  }>;

  let sent = 0;
  for (const row of rows) {
    if (row.is_blocked || !row.pix_qr_code) continue;
    const price = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
      Number(row.amount ?? 0),
    );
    const keyboard: InlineKeyboard = [
      [{ text: "Copiar Pix", copy_text: { text: row.pix_qr_code } }],
      [{ text: "✅ Verificar pagamento", callback_data: `pix_check:${row.order_id}` }],
      [{ text: "Ver QR Code", callback_data: `pix_qr:${row.order_id}` }],
      [{ text: "Voltar ao menu", callback_data: "menu" }],
    ];
    const safeKeyboard = row.pix_qr_code.length <= 256 ? keyboard : keyboard.slice(1);
    try {
      await sendMessage(
        row.telegram_id,
        `<b>Seu Pix ainda esta pendente</b>\n\n${escapeHtml(
          row.product_name ?? "Pedido",
        )}\n<b>Valor:</b> ${price}\n\nSe ainda quiser concluir, copie o Pix ou abra o QR Code abaixo.`,
        safeKeyboard,
      );
      sqlite
        .prepare("UPDATE orders SET pix_reminder_sent_at = ?, updated_at = ? WHERE id = ?")
        .run(nowIso, nowIso, row.order_id);
      recordCustomerEvent(row.user_id, "pix_reminder_sent", "Lembrete de Pix pendente enviado", {
        order_id: row.order_id,
      });
      sent++;
    } catch (error) {
      console.error("[pix-reminder] falha ao avisar", row.order_id, error);
    }
  }
  return { reminders: sent };
}

export function recordCustomerEvent(
  userId: string,
  type: string,
  description: string,
  metadata: Record<string, unknown> = {},
) {
  sqlite
    .prepare(
      `INSERT INTO customer_events (id, user_id, type, description, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      userId,
      type,
      description,
      JSON.stringify(metadata),
      new Date().toISOString(),
    );
}

export async function runSubscriptionAutomation() {
  const now = new Date();
  const nowIso = now.toISOString();
  const settings = sqlite.prepare("SELECT * FROM bot_settings LIMIT 1").get() as Record<
    string,
    any
  >;
  const noticeDays = Math.max(1, Number(settings?.renewal_notice_days ?? 3));
  const noticeLimit = new Date(now.getTime() + noticeDays * 86_400_000).toISOString();
  const expiring = sqlite
    .prepare(
      `SELECT s.*, p.name AS plan_name, p.renewal_enabled, u.telegram_id, u.email, u.is_blocked
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       JOIN users u ON u.id = s.user_id
       WHERE s.status = 'active' AND s.end_date > ? AND s.end_date <= ?
       AND IFNULL(p.access_type, 'days') != 'lifetime'
       AND s.renewal_notice_sent_at IS NULL`,
    )
    .all(nowIso, noticeLimit) as Record<string, any>[];

  let reminders = 0;
  for (const sub of expiring) {
    if (sub.is_blocked) continue;
    try {
      if (sub.auto_renew && sub.renewal_enabled && sub.email) {
        const order = await createPixOrder({
          userId: sub.user_id,
          ref: { plan_id: sub.plan_id },
          autoRenew: true,
        });
        await sendPixOrder(sub.telegram_id, order);
      } else {
        await sendMessage(
          sub.telegram_id,
          `<b>Seu acesso vence em breve</b>\n\n${escapeHtml(sub.plan_name)} vence em ${new Date(
            sub.end_date,
          ).toLocaleDateString("pt-BR")}.`,
          [[{ text: "Renovar agora", callback_data: `renew_plan_${sub.plan_id}` }]],
        );
      }
      sqlite
        .prepare("UPDATE subscriptions SET renewal_notice_sent_at = ?, updated_at = ? WHERE id = ?")
        .run(nowIso, nowIso, sub.id);
      reminders++;
    } catch (error) {
      console.error("[renewal] falha ao avisar", sub.id, error);
    }
  }

  const expired = sqlite
    .prepare(
      `SELECT s.*, p.name AS plan_name, u.telegram_id, u.is_blocked
       FROM subscriptions s
       LEFT JOIN plans p ON p.id = s.plan_id
       JOIN users u ON u.id = s.user_id
       WHERE s.status = 'active' AND s.end_date <= ?`,
    )
    .all(nowIso) as Record<string, any>[];
  let expirations = 0;
  for (const sub of expired) {
    sqlite
      .prepare("UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE id = ?")
      .run(nowIso, sub.id);
    if (!sub.expiration_notice_sent_at && !sub.is_blocked) {
      const message =
        settings?.expiration_message ||
        `Seu acesso ao plano ${sub.plan_name ?? "contratado"} venceu. Renove para continuar.`;
      try {
        await sendMessage(sub.telegram_id, `<b>Acesso vencido</b>\n\n${escapeHtml(message)}`, [
          [{ text: "Renovar acesso", callback_data: `renew_plan_${sub.plan_id}` }],
        ]);
        sqlite
          .prepare("UPDATE subscriptions SET expiration_notice_sent_at = ? WHERE id = ?")
          .run(nowIso, sub.id);
      } catch (error) {
        console.error("[expiration] falha ao avisar", sub.id, error);
      }
    }
    recordCustomerEvent(
      sub.user_id,
      "access_expired",
      `Acesso vencido: ${sub.plan_name ?? "Plano"}`,
    );
    expirations++;
  }
  return { reminders, expirations };
}

export { localDb };
