import { createClient } from "@/lib/supabase/server";
import {
  findTelegramStartUser,
  getTelegramAvatarDataUrl,
  makeRawTelegramUser,
  sendTelegramMessage,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoredTelegramLink = {
  status?: "pending" | "linked" | "expired" | "revoked";
  code?: string;
  expiresAt?: string;
  botUsername?: string;
  linkedAt?: string;
  telegramUser?: {
    id?: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
  };
};

function readStoredLink(value: unknown): StoredTelegramLink | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as StoredTelegramLink;
}

async function makeUserPreview(
  telegramUser: NonNullable<StoredTelegramLink["telegramUser"]>,
  linkedAt: string | null,
) {
  if (!telegramUser.id || !telegramUser.first_name) return null;

  return {
    id: String(telegramUser.id),
    firstName: telegramUser.first_name,
    lastName: telegramUser.last_name ?? null,
    username: telegramUser.username ?? null,
    languageCode: telegramUser.language_code ?? null,
    isPremium: telegramUser.is_premium ?? null,
    avatarDataUrl: await getTelegramAvatarDataUrl(telegramUser.id),
    linkedAt,
  };
}

export async function GET() {
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
      { error: "Entre na sua conta para vincular o Telegram." },
      { status: 401 },
    );
  }

  const stored = readStoredLink(user.user_metadata?.telegram_account_link);
  if (!stored) {
    return Response.json({ status: "not_started", user: null });
  }

  if (stored.status === "linked" && stored.telegramUser) {
    return Response.json({
      status: "linked",
      botUsername: stored.botUsername,
      expiresAt: stored.expiresAt,
      user: await makeUserPreview(
        stored.telegramUser,
        stored.linkedAt ?? null,
      ),
    });
  }

  if (stored.status === "revoked") {
    return Response.json({ status: "revoked", user: null });
  }

  const expiresAt = stored.expiresAt;
  const expired =
    !expiresAt || Number.isNaN(Date.parse(expiresAt))
      ? true
      : Date.parse(expiresAt) <= Date.now();
  if (stored.status === "expired" || expired) {
    await supabase.auth.updateUser({
      data: {
        telegram_account_link: {
          ...stored,
          status: "expired",
        },
      },
    });
    return Response.json({
      status: "expired",
      botUsername: stored.botUsername,
      expiresAt,
      user: null,
    });
  }

  if (!stored.code) {
    return Response.json({ status: "not_started", user: null });
  }

  let match;
  try {
    match = await findTelegramStartUser(stored.code);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível verificar o Telegram.",
      },
      { status: 502 },
    );
  }

  if (!match) {
    return Response.json({
      status: "pending",
      botUsername: stored.botUsername,
      expiresAt,
      user: null,
    });
  }

  const linkedAt = new Date().toISOString();
  const telegramUser = match.telegramUser;
  const { error: updateError } = await supabase.auth.updateUser({
    data: {
      telegram_account_link: {
        status: "linked",
        botUsername: stored.botUsername,
        linkedAt,
        telegramUser: makeRawTelegramUser(telegramUser),
      },
    },
  });
  if (updateError) {
    return Response.json(
      { error: "Recebemos a confirmação, mas não conseguimos salvar o vínculo." },
      { status: 500 },
    );
  }

  await sendTelegramMessage(
    match.chatId,
    "✅ Telegram vinculado com sucesso!\n\nSua conta foi associada ao painel CriaBot. Você já pode voltar ao painel e continuar.",
  );

  return Response.json({
    status: "linked",
    botUsername: stored.botUsername,
    user: await makeUserPreview(telegramUser, linkedAt),
  });
}
