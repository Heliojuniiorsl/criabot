import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  deleteWebhookWithToken,
  formatTelegramError,
  getBotInfoWithToken,
  getChatMemberWithToken,
  getChatWithToken,
  getTelegramErrorMessage,
  getUpdatesWithToken,
  type TelegramChat,
  type TelegramChatMember,
  type TelegramUpdate,
} from "@/lib/telegram/api";

export const runtime = "nodejs";

const verifySchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^\d{6,}:[A-Za-z0-9_-]{20,}$/, "Token do Telegram inválido."),
  lookup: z.string().trim().max(140).optional().default(""),
});

type CommunityUpdate = TelegramUpdate & {
  my_chat_member?: {
    chat: TelegramChat;
    new_chat_member: TelegramChatMember;
  };
  message?: {
    chat: TelegramChat;
    new_chat_members?: Array<{
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    }>;
  };
};

function normalizeLookup(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    if (url.hostname === "t.me" || url.hostname === "telegram.me") {
      const [firstSegment] = url.pathname.split("/").filter(Boolean);
      if (!firstSegment || firstSegment.startsWith("+")) return trimmed;
      if (firstSegment === "joinchat") return trimmed;
      if (/^-?\d+$/.test(firstSegment)) return firstSegment;
      return firstSegment.startsWith("@") ? firstSegment : `@${firstSegment}`;
    }
  } catch {
    // Não era URL; seguimos normalizando como @username, ID ou texto livre.
  }

  if (/^-?\d+$/.test(trimmed)) return trimmed;
  if (/^@?[A-Za-z0-9_]{5,}$/.test(trimmed)) {
    return `@${trimmed.replace(/^@+/, "")}`;
  }
  return trimmed;
}

function getMissingPermissions(member: TelegramChatMember) {
  if (member.status === "creator") return [];
  if (member.status !== "administrator") return [];

  const missing: string[] = [];
  if (!member.can_invite_users) missing.push("Adicionar membros");
  if (!member.can_manage_chat) missing.push("Gerenciar grupo/canal");
  if (!member.can_restrict_members) missing.push("Remover membros");
  return missing;
}

function makeCommunity(chat: TelegramChat, member: TelegramChatMember) {
  const isAdmin =
    member.status === "administrator" || member.status === "creator";
  const missingPermissions = getMissingPermissions(member);

  return {
    id: String(chat.id),
    title: chat.title || chat.username || `Grupo ${chat.id}`,
    type:
      chat.type === "channel" || chat.type === "supergroup"
        ? chat.type
        : "group",
    username: chat.username ? `@${chat.username.replace(/^@+/, "")}` : null,
    botStatus: member.status,
    botIsAdmin: isAdmin,
    verifiedAt: new Date().toISOString(),
    inviteLink: chat.invite_link ?? null,
    missingPermissions,
  };
}

async function preparePolling(token: string) {
  await deleteWebhookWithToken(token, false);
}

async function checkChat(token: string, chatId: string | number, botId: number) {
  try {
    const chat = await getChatWithToken(token, chatId);
    const member = await getChatMemberWithToken(token, chat.id, botId);

    return {
      community: makeCommunity(chat, member),
      message: "",
    };
  } catch (error) {
    return {
      community: null,
      message: formatTelegramError(
        error,
        getTelegramErrorMessage(undefined),
      ),
    };
  }
}

async function detectLatestCommunity(token: string, botId: number) {
  try {
    const updates = await getUpdatesWithToken<CommunityUpdate>(token, {
      offset: -100,
      limit: 100,
      timeout: 0,
      allowedUpdates: ["my_chat_member", "message"],
    });

    for (const update of [...updates].reverse()) {
      const membership = update.my_chat_member;
      if (
        membership?.new_chat_member.user.id === botId &&
        !["left", "kicked"].includes(membership.new_chat_member.status)
      ) {
        return { chatId: membership.chat.id, message: "" };
      }

      const message = update.message;
      if (
        message?.new_chat_members?.some((member) => member.id === botId) &&
        message.chat.type !== "private"
      ) {
        return { chatId: message.chat.id, message: "" };
      }
    }

    return {
      chatId: null,
      message:
        "Ainda não detectei o bot em nenhum grupo ou canal. Adicione o bot e clique em verificar novamente.",
    };
  } catch (error) {
    return {
      chatId: null,
      message: formatTelegramError(
        error,
        "Não foi possível verificar a confirmação no Telegram.",
      ),
    };
  }
}

export async function POST(request: Request) {
  const parsed = verifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  if (!supabase) {
    return Response.json(
      { error: "O ambiente ainda não está configurado." },
      { status: 500 },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json(
      { error: "Entre na sua conta para verificar o grupo." },
      { status: 401 },
    );
  }

  const { token, lookup } = parsed.data;
  const bot = await getBotInfoWithToken(token).catch((error) => {
    return Response.json(
      {
        error: formatTelegramError(
          error,
          "Token inválido. Copie novamente o token enviado pelo BotFather.",
        ),
      },
      { status: 400 },
    );
  });

  if (bot instanceof Response) return bot;

  if (!bot.is_bot) {
    return Response.json(
      { error: "Esse token não pertence a um bot do Telegram." },
      { status: 400 },
    );
  }

  const prepared = await preparePolling(token).catch((error) => {
    return Response.json(
      {
        error: formatTelegramError(
          error,
          "Não foi possível preparar o bot para verificar grupo ou canal.",
        ),
      },
      { status: 400 },
    );
  });

  if (prepared instanceof Response) return prepared;

  const normalizedLookup = normalizeLookup(lookup);
  const checked = normalizedLookup
    ? await checkChat(token, normalizedLookup, bot.id)
    : null;

  let community = checked?.community ?? null;
  let message = checked?.message ?? "";

  if (!community && !normalizedLookup) {
    const detected = await detectLatestCommunity(token, bot.id);
    if (detected.chatId) {
      const detectedCheck = await checkChat(token, detected.chatId, bot.id);
      community = detectedCheck.community;
      message = detectedCheck.message;
    } else {
      message = detected.message;
    }
  }

  if (!community) {
    return Response.json({
      ready: false,
      status: "not_found",
      message:
        message ||
        "Não encontrei o grupo ou canal. Adicione o bot e tente novamente.",
      community: null,
    });
  }

  const ready = community.botIsAdmin;
  return Response.json({
    ready,
    status: ready ? "admin" : "member",
    message: ready
      ? "Bot confirmado como administrador."
      : "Bot detectado, mas ainda não é administrador.",
    community,
  });
}
