import { createClient } from "@/lib/supabase/server";
import { removeLocalTelegramBot } from "@/lib/telegram/local-bot-store";
import { stopLocalTelegramPolling } from "@/lib/telegram/local-polling";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ botId: string }> },
) {
  const { botId } = await context.params;
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
      { error: "Entre na sua conta para excluir o bot." },
      { status: 401 },
    );
  }

  const { data: bot, error: botError } = await supabase
    .from("bots")
    .select("id")
    .eq("id", botId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (botError || !bot) {
    return Response.json(
      { error: "Não encontrei esse bot na sua conta." },
      { status: 404 },
    );
  }

  stopLocalTelegramPolling(bot.id);
  await removeLocalTelegramBot(bot.id);

  await supabase
    .from("bots")
    .update({
      status: "archived",
      updated_at: new Date().toISOString(),
    })
    .eq("id", bot.id)
    .eq("owner_id", user.id);

  const { error: deleteError } = await supabase
    .from("bots")
    .delete()
    .eq("id", bot.id)
    .eq("owner_id", user.id);

  if (deleteError) {
    return Response.json(
      {
        error:
          deleteError.message ||
          "Não foi possível excluir o bot. Tente novamente.",
      },
      { status: 400 },
    );
  }

  return Response.json({
    ok: true,
    message: "Bot excluído com sucesso.",
  });
}
