import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { getMercadoPagoPayment, validateMercadoPagoSignature } from "@/lib/mercado-pago.server";
import { localDb } from "@/lib/database.server";
import { getManagedBotToken } from "@/lib/bot-manager.server";
import { findManagedSalesBotById, managedSalesBotRuntime } from "@/lib/sales-bot-registry.server";
import { runWithSalesBotRuntime } from "@/lib/sales-bot-runtime.server";
import {
  fulfillImageBotLimitBoostPayment,
  fulfillImageBotPayment,
  fulfillImageBotPremiumPayment,
  updateImageBotLimitBoostPaymentRawStatus,
  updateImageBotPaymentRawStatus,
  updateImageBotPremiumPaymentRawStatus,
} from "@/lib/image-bot-payments.server";

const orderIdSchema = z.string().uuid();

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
          if (!secret) return new Response("Webhook ainda não configurado", { status: 503 });

          const body = (await request.json()) as {
            type?: string;
            live_mode?: boolean;
            data?: { id?: string | number };
          };
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
          if (body.live_mode === false) {
            return Response.json({ ok: true, simulated: true });
          }
          const payment = await getMercadoPagoPayment(dataId);
          const externalReference = String(payment.external_reference ?? "");

          if (externalReference.startsWith("image:")) {
            const imageOrderId = orderIdSchema.parse(externalReference.slice("image:".length));
            if (payment.status !== "approved") {
              updateImageBotPaymentRawStatus(imageOrderId, payment.status);
              return Response.json({ ok: true, status: payment.status, target: "image_bot" });
            }
            if (payment.currency_id !== "BRL") throw new Error("Moeda inesperada no pagamento");
            await fulfillImageBotPayment({
              token: getManagedBotToken("images"),
              orderId: imageOrderId,
              providerPaymentId: String(payment.id),
              providerStatus: payment.status_detail,
              paidAt: payment.date_approved,
              amount: Number(payment.transaction_amount),
            });
            return Response.json({ ok: true, target: "image_bot" });
          }

          if (externalReference.startsWith("image-limit:")) {
            const imageLimitOrderId = orderIdSchema.parse(
              externalReference.slice("image-limit:".length),
            );
            if (payment.status !== "approved") {
              updateImageBotLimitBoostPaymentRawStatus(imageLimitOrderId, payment.status);
              return Response.json({
                ok: true,
                status: payment.status,
                target: "image_bot_limit",
              });
            }
            if (payment.currency_id !== "BRL") throw new Error("Moeda inesperada no pagamento");
            await fulfillImageBotLimitBoostPayment({
              token: getManagedBotToken("images"),
              orderId: imageLimitOrderId,
              providerPaymentId: String(payment.id),
              providerStatus: payment.status_detail,
              paidAt: payment.date_approved,
              amount: Number(payment.transaction_amount),
            });
            return Response.json({ ok: true, target: "image_bot_limit" });
          }

          if (externalReference.startsWith("image-premium:")) {
            const premiumOrderId = orderIdSchema.parse(
              externalReference.slice("image-premium:".length),
            );
            if (payment.status !== "approved") {
              updateImageBotPremiumPaymentRawStatus(premiumOrderId, payment.status);
              return Response.json({
                ok: true,
                status: payment.status,
                target: "image_bot_premium",
              });
            }
            if (payment.currency_id !== "BRL") throw new Error("Moeda inesperada no pagamento");
            await fulfillImageBotPremiumPayment({
              token: getManagedBotToken("images"),
              orderId: premiumOrderId,
              providerPaymentId: String(payment.id),
              providerStatus: payment.status_detail,
              paidAt: payment.date_approved,
              amount: Number(payment.transaction_amount),
            });
            return Response.json({ ok: true, target: "image_bot_premium" });
          }

          async function processSalesPayment(salesOrderReference: string) {
            const orderId = orderIdSchema.parse(salesOrderReference);

            if (payment.status !== "approved") {
              await localDb
                .from("payments")
                .update({ raw_status: payment.status })
                .eq("order_id", orderId);
              return Response.json({ ok: true, status: payment.status });
            }
            if (payment.currency_id !== "BRL") throw new Error("Moeda inesperada no pagamento");

            const { fulfillOrder } = await import("@/lib/fulfillment.server");
            await fulfillOrder(localDb, {
              orderId,
              providerPaymentId: String(payment.id),
              providerStatus: payment.status_detail,
              paidAt: payment.date_approved,
              amount: Number(payment.transaction_amount),
            });
            return Response.json({ ok: true });
          }

          const managedBotReference = /^sales:([^:]+):(.+)$/.exec(externalReference);
          if (managedBotReference) {
            const bot = findManagedSalesBotById(managedBotReference[1]);
            if (!bot) throw new Error("Bot de vendas do pagamento nao foi encontrado");
            return runWithSalesBotRuntime(managedSalesBotRuntime(bot), () =>
              processSalesPayment(managedBotReference[2]),
            );
          }
          return runWithSalesBotRuntime(null, () => processSalesPayment(externalReference));
        } catch (error) {
          console.error("[mercado-pago-webhook]", error);
          return new Response("Falha temporária", { status: 500 });
        }
      },
    },
  },
});
