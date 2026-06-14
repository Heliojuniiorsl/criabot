import { createFileRoute } from "@tanstack/react-router";
import { extname } from "node:path";

import { localDb, verifyPrivateMedia } from "@/lib/database.server";

const mimeTypes: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

// Public, read-only proxy that streams files from the private `bot-media`
// bucket. Used so Telegram (and the admin preview) can fetch uploaded images
// by a stable, permanent URL even though the bucket itself is private.
export const Route = createFileRoute("/api/public/media/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const path = (params as { _splat?: string })._splat ?? "";
        if (!path || path.includes("..")) {
          return new Response("Not found", { status: 404 });
        }

        if (path.startsWith("private/")) {
          const url = new URL(request.url);
          const expires = Number(url.searchParams.get("expires"));
          const signature = url.searchParams.get("signature") ?? "";
          if (!verifyPrivateMedia(path, expires, signature)) {
            return new Response("Not found", { status: 404 });
          }
        } else if (!path.startsWith("public/")) {
          return new Response("Not found", { status: 404 });
        }

        const { data, error } = await localDb.storage.from("bot-media").download(path);

        if (error || !data) {
          return new Response("Not found", { status: 404 });
        }

        return new Response(data, {
          status: 200,
          headers: {
            "Content-Type": mimeTypes[extname(path).toLowerCase()] || "application/octet-stream",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});
