import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { getMercadoPagoPayment, validateMercadoPagoSignature } from "@/lib/mercado-pago.server";

const orderIdSchema = z.string().uuid();

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
          if (!secret) return new Response("Webhook ainda não configurado", { status: 503 });

          const body = (await request.json()) as { type?: string; data?: { id?: string | number } };
          const url = new URL(request.url);
          const dataId =
            url.searchParams.get("data.id") ??
            url.searchParams.get("id") ??
            String(body.data?.id ?? "");
          const signature = request.headers.get("x-signature") ?? "";
          const requestId = request.headers.get("x-request-id") ?? "";
          if (
            !dataId ||
            !requestId ||
            !validateMercadoPagoSignature({ dataId, requestId, signature, secret })
          ) {
            return new Response("Assinatura inválida", { status: 401 });
          }

          if (body.type && body.type !== "payment") return Response.json({ ok: true });
          const payment = await getMercadoPagoPayment(dataId);
          const orderId = orderIdSchema.parse(payment.external_reference);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          if (payment.status !== "approved") {
            await supabaseAdmin
              .from("payments")
              .update({ raw_status: payment.status })
              .eq("order_id", orderId);
            return Response.json({ ok: true, status: payment.status });
          }
          if (payment.currency_id !== "BRL") throw new Error("Moeda inesperada no pagamento");

          const { fulfillOrder } = await import("@/lib/fulfillment.server");
          await fulfillOrder(supabaseAdmin, {
            orderId,
            providerPaymentId: String(payment.id),
            providerStatus: payment.status_detail,
            paidAt: payment.date_approved,
            amount: Number(payment.transaction_amount),
          });
          return Response.json({ ok: true });
        } catch (error) {
          console.error("[mercado-pago-webhook]", error);
          return new Response("Falha temporária", { status: 500 });
        }
      },
    },
  },
});
