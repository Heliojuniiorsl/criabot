import { createFileRoute } from "@tanstack/react-router";

import { localDb } from "@/lib/database.server";
import { timingSafeEqual } from "node:crypto";

// Cron endpoint: delivers automated messages whose interval has elapsed.
function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Called by an external cron using a dedicated server-only secret.
export const Route = createFileRoute("/api/public/broadcasts/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
        const expected = process.env.CRON_SECRET ?? "";
        if (!expected || !safeEqual(provided, expected)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { runDueBroadcasts } = await import("@/lib/broadcast.server");
        const { runDueImageBotGroupAutomations } = await import("@/lib/image-bot-broadcast.server");
        const { runImageBotPremiumExpiryReminders } =
          await import("@/lib/image-bot-premium-reminders.server");
        const { runPendingPixReminders, runSubscriptionAutomation } =
          await import("@/lib/sales.server");
        const { listManagedSalesBots, managedSalesBotRuntime } =
          await import("@/lib/sales-bot-registry.server");
        const { enterSalesBotRuntime, runWithSalesBotRuntime } =
          await import("@/lib/sales-bot-runtime.server");

        const runSalesAutomations = async () => {
          const [broadcasts, subscriptions, pendingPix] = await Promise.all([
            runDueBroadcasts(localDb),
            runSubscriptionAutomation(),
            runPendingPixReminders(),
          ]);
          return { broadcasts, subscriptions, pendingPix };
        };

        enterSalesBotRuntime(null);
        const [primarySales, managedSalesBots, imageGroupAutomations, premiumExpiryReminders] =
          await Promise.all([
            runSalesAutomations(),
            Promise.all(
              listManagedSalesBots().map((bot) =>
                runWithSalesBotRuntime(managedSalesBotRuntime(bot), runSalesAutomations),
              ),
            ),
            runDueImageBotGroupAutomations(),
            runImageBotPremiumExpiryReminders(),
          ]);
        return Response.json({
          ok: true,
          broadcasts: primarySales.broadcasts,
          imageGroupAutomations,
          premiumExpiryReminders,
          subscriptions: primarySales.subscriptions,
          pendingPix: primarySales.pendingPix,
          managedSalesBots,
        });
      },
    },
  },
});
