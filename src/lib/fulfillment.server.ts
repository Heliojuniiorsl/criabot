import { sendDocument, sendMessage, sendPhoto, sendVideo } from "./telegram.server";
import type { localDb } from "./database.server";

type AnyClient = typeof localDb;

async function resolvePrivateMedia(database: AnyClient, value: string) {
  if (!value.startsWith("private://")) return value;
  const path = value.slice("private://".length);
  const { data, error } = await database.storage.from("bot-media").createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error("Falha ao gerar link temporário do conteúdo");
  return data.signedUrl;
}

export async function fulfillOrder(
  database: AnyClient,
  input: {
    orderId: string;
    providerPaymentId: string;
    providerStatus: string;
    paidAt: string | null;
    amount: number;
  },
) {
  const { error: confirmError } = await database.rpc("confirm_mercado_pago_payment", {
    p_order_id: input.orderId,
    p_provider_payment_id: input.providerPaymentId,
    p_provider_status: input.providerStatus,
    p_paid_at: input.paidAt,
    p_amount: input.amount,
  });
  if (confirmError) throw new Error(confirmError.message);

  const { data: claimed, error: claimError } = await database.rpc("claim_order_delivery", {
    p_order_id: input.orderId,
  });
  if (claimError) throw new Error(claimError.message);
  if (!claimed) return { alreadyDelivered: true };

  try {
    const { data: order, error: orderError } = await database
      .from("orders")
      .select(
        "id, user_id, plan_id, content_id, users(telegram_id), plans(name), contents(title, type, file_url)",
      )
      .eq("id", input.orderId)
      .single();
    if (orderError || !order) throw new Error("Pedido não encontrado após confirmação");

    const customer = order.users as unknown as { telegram_id: number } | null;
    if (!customer?.telegram_id) throw new Error("Cliente sem Telegram vinculado");

    if (order.content_id) {
      const content = order.contents as unknown as {
        title: string;
        type: "foto" | "video" | "pacote";
        file_url: string | null;
      } | null;
      if (!content?.file_url) throw new Error("Conteúdo pago sem arquivo de entrega");
      const mediaUrl = await resolvePrivateMedia(database, content.file_url);
      const caption = `✅ <b>Pagamento confirmado!</b>\n\nSeu conteúdo: <b>${content.title}</b>`;
      if (content.type === "video") await sendVideo(customer.telegram_id, mediaUrl, caption);
      else if (content.type === "pacote")
        await sendDocument(customer.telegram_id, mediaUrl, caption);
      else await sendPhoto(customer.telegram_id, mediaUrl, caption);
    } else {
      const { data: settings } = await database
        .from("bot_settings")
        .select("private_group_link")
        .limit(1)
        .maybeSingle();
      const groupLink = settings?.private_group_link;
      const linkText = groupLink
        ? `\n\n🔓 Entre no grupo privado:\n${groupLink}`
        : "\n\nSeu acesso foi liberado. O link será enviado pelo suporte.";
      await sendMessage(customer.telegram_id, `✅ <b>Pagamento confirmado!</b>${linkText}`);
    }

    const { error: deliveryError } = await database
      .from("orders")
      .update({ delivery_sent_at: new Date().toISOString(), delivery_claimed_at: null })
      .eq("id", input.orderId);
    if (deliveryError) throw new Error(deliveryError.message);
    return { ok: true };
  } catch (error) {
    await database.from("orders").update({ delivery_claimed_at: null }).eq("id", input.orderId);
    throw error;
  }
}
