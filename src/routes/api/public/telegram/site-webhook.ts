import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

import {
  getCriaBotToken,
  getCriaBotWebhookSecret,
  isDuplicateCriaBotUpdate,
  linkCriaBotUserByCode,
  sendCriaBotMessage,
} from "@/lib/site-bot.server";

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

type ForwardedChat = {
  id?: number;
  title?: string;
  username?: string;
  type?: string;
};

function formatChatType(type: string | undefined) {
  if (type === "channel") return "Canal";
  if (type === "supergroup") return "Supergrupo";
  if (type === "group") return "Grupo";
  return "Grupo/canal";
}

function getForwardedChat(message: any): ForwardedChat | null {
  const origin = message?.forward_origin;

  if (origin?.type === "channel" && origin.chat?.id) {
    return origin.chat;
  }

  if (origin?.type === "chat" && origin.sender_chat?.id) {
    return origin.sender_chat;
  }

  if (message?.forward_from_chat?.id) {
    return message.forward_from_chat;
  }

  return null;
}

export const Route = createFileRoute("/api/public/telegram/site-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = getCriaBotToken();
        if (!token) return new Response("CRIABOT_TOKEN não configurado", { status: 503 });

        const incomingSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        const expectedSecret = getCriaBotWebhookSecret(token);
        if (!incomingSecret || !safeEqual(incomingSecret, expectedSecret)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (contentLength > 500_000) return new Response("Payload muito grande", { status: 413 });

        const update = await request.json();
        const updateId = Number(update.update_id);
        if (isDuplicateCriaBotUpdate(updateId)) {
          return Response.json({ ok: true, duplicate: true });
        }

        const message = update.message;
        const chatId = Number(message?.chat?.id);
        const chatType = String(message?.chat?.type ?? "");
        const text = String(message?.text ?? "");
        const user = message?.from;

        if (!message || chatType !== "private" || !Number.isFinite(chatId) || !user?.id) {
          return Response.json({ ok: true });
        }

        const startMatch = text.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
        if (startMatch) {
          const code = startMatch?.[1]?.trim().split(/\s+/)[0] ?? "";
          if (!code) {
            await sendCriaBotMessage(
              chatId,
              "Abra este bot pelo botão dentro do painel CriaBot para vincular sua conta.",
            );
            return Response.json({ ok: true, linked: false });
          }

          const result = await linkCriaBotUserByCode({ code, chatId, user });
          if (!result.ok) {
            await sendCriaBotMessage(
              chatId,
              "Esse link expirou ou já foi usado. Volte ao painel CriaBot e abra o bot oficial novamente.",
            );
            return Response.json({ ok: true, linked: false, reason: result.reason });
          }

          const linked = result.linked_user;
          const name =
            [linked?.first_name, linked?.last_name].filter(Boolean).join(" ").trim() ||
            linked?.username ||
            `ID ${linked?.telegram_user_id}`;

          await sendCriaBotMessage(
            chatId,
            `Conta vinculada com sucesso.\n\nUsuário: <b>${escapeHtml(name)}</b>\nID Telegram: <code>${linked?.telegram_user_id}</code>\n\nAgora volte ao Site CriaBot. Para continuar a criação do bot.`,
          );

          return Response.json({ ok: true, linked: true });
        }

        const forwardedChat = getForwardedChat(message);
        if (!forwardedChat?.id) {
          await sendCriaBotMessage(
            chatId,
            "Não consegui identificar o grupo/canal dessa mensagem.\n\nEncaminhe uma mensagem diretamente do grupo/canal VIP ou copie o ID manualmente e cole no painel.",
          );
          return Response.json({ ok: true, vip_chat_detected: false });
        }

        const vipChatId = String(Number(forwardedChat.id));
        const title =
          forwardedChat.title || (forwardedChat.username ? `@${forwardedChat.username}` : vipChatId);

        await sendCriaBotMessage(
          chatId,
          `ID do VIP encontrado.\n\n${formatChatType(forwardedChat.type)}: <b>${escapeHtml(title)}</b>\nID: <code>${vipChatId}</code>\n\nToque em <b>Copiar ID</b> e cole no campo ID do grupo/canal VIP no CriaBot.`,
          [[{ text: "Copiar ID", copy_text: { text: vipChatId } }]],
        );

        return Response.json({ ok: true, vip_chat_detected: true });
      },
    },
  },
});
