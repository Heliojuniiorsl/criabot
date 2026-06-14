import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireAdminSession } from "@/lib/auth.server";
import { localDb } from "@/lib/database.server";

async function admin() {
  requireAdminSession();
  return localDb;
}

const uuid = z.string().uuid();

/* ------------------------------- Uploads --------------------------------- */

const uploadSchema = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().regex(/^image\/(jpeg|jpg|png|webp|gif)$/, "Tipo de imagem invÃ¡lido"),
  // base64 (sem o prefixo data:) do arquivo
  dataBase64: z.string().min(1).max(15_000_000),
  visibility: z.enum(["public", "private"]).default("public"),
});

export const uploadMedia = createServerFn({ method: "POST" })
  .validator(uploadSchema)
  .handler(async ({ data }) => {
    const sb = await admin();

    const bytes = Buffer.from(data.dataBase64, "base64");
    if (bytes.length > 8 * 1024 * 1024) {
      throw new Error("Imagem muito grande (mÃ¡x. 8MB)");
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

    // URL pÃºblica estÃ¡vel servida pela rota /api/public/media/*
    const origin = (process.env.PUBLIC_BASE_URL ?? new URL(getRequest().url).origin).replace(
      /\/$/,
      "",
    );
    return { url: `${origin}/api/public/media/${key}` };
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

/* --------------------------------- Plans --------------------------------- */

export const listPlans = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("plans")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
});

const planSchema = z.object({
  id: uuid.optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  price: z.number().min(0).max(1000000),
  duration_days: z.number().int().min(1).max(3650),
  is_active: z.boolean(),
});

export const savePlan = createServerFn({ method: "POST" })
  .validator(planSchema)
  .handler(async ({ data }) => {
    const sb = await admin();
    const { id, ...fields } = data;
    if (id) {
      const { error } = await sb.from("plans").update(fields).eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await sb.from("plans").insert(fields);
      if (error) throw new Error(error.message);
    }
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

const contentSchema = z.object({
  id: uuid.optional(),
  title: z.string().min(1).max(160),
  description: z.string().max(2000).optional().nullable(),
  type: z.enum(["foto", "video", "pacote"]),
  price: z.number().min(0).max(1000000),
  preview_url: z.string().max(1000).optional().nullable(),
  file_url: z.string().max(1000).optional().nullable(),
  is_active: z.boolean(),
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

/* ------------------------------- Customers ------------------------------- */

export const listCustomers = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data: users, error } = await sb
    .from("users")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const { data: subs } = await sb
    .from("subscriptions")
    .select("user_id, status, start_date, end_date, plan_id, plans(name)")
    .order("end_date", { ascending: false });

  return (users ?? []).map((u: any) => {
    const sub = (subs ?? []).find((s: any) => s.user_id === u.id);
    return {
      ...u,
      plan_name: sub?.plans?.name ?? null,
      start_date: sub?.start_date ?? null,
      end_date: sub?.end_date ?? null,
      subscription_status: sub?.status ?? null,
    };
  });
});

/* --------------------------------- Orders -------------------------------- */

export const listOrders = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("orders")
    .select("*, users(name, telegram_username, telegram_id), plans(name), contents(title)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
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

/* ----------------------------- Broadcasts -------------------------------- */

const broadcastButtonSchema = z.object({
  label: z.string().min(1).max(64),
  kind: z.enum(["link", "plans", "contents", "menu"]),
  url: z.string().max(1000).optional().nullable(),
});

export const listBroadcasts = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await (sb as any)
    .from("broadcasts")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
});

const broadcastSchema = z.object({
  id: uuid.optional(),
  title: z.string().min(1).max(160),
  message: z.string().min(1).max(4000),
  image_url: z.string().max(1000).optional().nullable(),
  buttons: z.array(broadcastButtonSchema).max(6),
  interval_hours: z.number().int().min(1).max(8760),
  is_active: z.boolean(),
});

export const saveBroadcast = createServerFn({ method: "POST" })
  .validator(broadcastSchema)
  .handler(async ({ data }) => {
    const sb = await admin();
    const { id, ...fields } = data;
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
  id: z.enum(["plans", "contents", "myaccess", "support", "terms"]),
  label: z.string().min(1).max(64),
  enabled: z.boolean(),
});

const settingsSchema = z.object({
  id: uuid,
  welcome_message: z.string().min(1).max(4000),
  welcome_image_url: z.string().max(1000).optional().nullable(),
  terms_text: z.string().min(1).max(8000),
  support_link: z.string().max(500).optional().nullable(),
  private_group_link: z.string().max(500).optional().nullable(),
  payment_info: z.string().max(4000).optional().nullable(),
  menu_buttons: z.array(menuButtonSchema).min(1).max(5),
});

export const saveSettings = createServerFn({ method: "POST" })
  .validator(settingsSchema)
  .handler(async ({ data }) => {
    const sb = await admin();
    const { id, ...fields } = data;
    const { error } = await sb.from("bot_settings").update(fields).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
