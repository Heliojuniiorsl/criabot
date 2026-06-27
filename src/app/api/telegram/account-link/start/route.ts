import { createClient } from "@/lib/supabase/server";
import {
  getExpiresAt,
  getOfficialBot,
  makePublicLinkCode,
  prepareOfficialBotPolling,
} from "../_shared";

export const runtime = "nodejs";

export async function POST() {
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

  let officialBot;
  try {
    officialBot = await getOfficialBot();
    await prepareOfficialBotPolling();
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "O bot oficial ainda não foi configurado.",
      },
      { status: 400 },
    );
  }

  const linkCode = makePublicLinkCode();
  const expiresAt = getExpiresAt();
  const { error: linkError } = await supabase.auth.updateUser({
    data: {
      telegram_account_link: {
        status: "pending",
        code: linkCode,
        expiresAt,
        botUsername: `@${officialBot.username}`,
      },
    },
  });

  if (linkError) {
    return Response.json(
      { error: "Não foi possível preparar a vinculação com o Telegram." },
      { status: 400 },
    );
  }

  return Response.json({
    status: "pending",
    url: `https://t.me/${officialBot.username}?start=${linkCode}`,
    botUsername: `@${officialBot.username}`,
    expiresAt,
    user: null,
  });
}
