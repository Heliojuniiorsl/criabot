import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  formatTelegramError,
  getBotInfoWithToken,
  getBotPhotoDataUrlWithToken,
} from "@/lib/telegram/api";

export const runtime = "nodejs";

const previewSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^\d{6,}:[A-Za-z0-9_-]{20,}$/, "Token do Telegram inválido."),
});

export async function POST(request: Request) {
  const parsed = previewSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Token inválido." },
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
      { error: "Entre na sua conta para identificar o bot." },
      { status: 401 },
    );
  }

  const token = parsed.data.token;
  const telegramBot = await getBotInfoWithToken(token).catch((error) => {
    return Response.json(
      {
        error: formatTelegramError(
          error,
          "Não foi possível validar o token. Confira se você copiou o token completo do BotFather.",
        ),
      },
      { status: 400 },
    );
  });

  if (telegramBot instanceof Response) return telegramBot;

  if (!telegramBot.is_bot) {
    return Response.json(
      { error: "Esse token não pertence a um bot do Telegram." },
      { status: 400 },
    );
  }

  if (!telegramBot.username) {
    return Response.json(
      { error: "O Telegram não retornou o usuário público deste bot." },
      { status: 400 },
    );
  }

  const avatarDataUrl = await getBotPhotoDataUrlWithToken(
    token,
    telegramBot.id,
  ).catch(() => null);

  return Response.json({
    bot: {
      id: String(telegramBot.id),
      name: [telegramBot.first_name, telegramBot.last_name]
        .filter(Boolean)
        .join(" "),
      username: `@${telegramBot.username}`,
      avatarDataUrl,
    },
  });
}
