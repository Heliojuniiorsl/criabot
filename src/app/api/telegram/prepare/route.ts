import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  deleteWebhookWithToken,
  formatTelegramError,
  getBotInfoWithToken,
} from "@/lib/telegram/api";

export const runtime = "nodejs";

const prepareSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^\d{6,}:[A-Za-z0-9_-]{20,}$/, "Token do Telegram inválido."),
});

export async function POST(request: Request) {
  const parsed = prepareSchema.safeParse(await request.json().catch(() => null));
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
      { error: "Entre na sua conta para preparar o bot." },
      { status: 401 },
    );
  }

  const token = parsed.data.token;
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

  if (!bot.is_bot || !bot.username) {
    return Response.json(
      {
        error:
          "Token inválido. Copie novamente o token enviado pelo BotFather.",
      },
      { status: 400 },
    );
  }

  const prepared = await deleteWebhookWithToken(token, false).catch((error) => {
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

  return Response.json({
    ready: true,
    message: `Bot @${bot.username} online para verificar grupo ou canal VIP.`,
  });
}
