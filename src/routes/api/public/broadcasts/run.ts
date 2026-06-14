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
        const result = await runDueBroadcasts(localDb);
        return Response.json({ ok: true, ...result });
      },
    },
  },
});
