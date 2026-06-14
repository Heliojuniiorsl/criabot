// Server-only logic to deliver a broadcast (automated message) to every bot user.
import { sendMessage, sendPhoto, type InlineKeyboard } from "@/lib/telegram.server";

export type BroadcastButton = {
  label: string;
  kind: "link" | "plans" | "contents" | "menu";
  url?: string | null;
};

export type BroadcastRow = {
  id: string;
  title: string;
  message: string;
  image_url: string | null;
  buttons: BroadcastButton[];
  interval_hours: number;
  is_active: boolean;
  last_sent_at: string | null;
  locked_at: string | null;
};

function buildKeyboard(buttons: BroadcastButton[]): InlineKeyboard | undefined {
  const rows = (buttons ?? [])
    .map((b): { text: string; url?: string; callback_data?: string } | null => {
      if (b.kind === "link") {
        if (!b.url) return null;
        return { text: b.label, url: b.url };
      }
      // plans / contents / menu are handled by the bot webhook callbacks
      return { text: b.label, callback_data: b.kind };
    })
    .filter(Boolean) as { text: string; url?: string; callback_data?: string }[];

  if (!rows.length) return undefined;
  return rows.map((r) => [r]);
}

// Delivers a single broadcast to all users and stamps last_sent_at.
// Returns the number of users reached.
export async function sendBroadcast(sb: any, b: BroadcastRow): Promise<number> {
  const { data: users } = await sb.from("users").select("telegram_id");
  const recipients = (users ?? [])
    .map((u: any) => u.telegram_id)
    .filter((id: any) => typeof id === "number" || typeof id === "string");

  const keyboard = buildKeyboard(b.buttons);

  let sent = 0;
  for (const chatId of recipients) {
    try {
      if (b.image_url) {
        await sendPhoto(chatId, b.image_url, b.message, keyboard);
      } else {
        await sendMessage(chatId, b.message, keyboard);
      }
      sent++;
    } catch (err) {
      console.error("[broadcast] falha ao enviar para", chatId, err);
    }
  }

  await sb
    .from("broadcasts")
    .update({ last_sent_at: new Date().toISOString(), locked_at: null })
    .eq("id", b.id);
  return sent;
}

// Runs all active broadcasts whose interval has elapsed since last_sent_at.
export async function runDueBroadcasts(sb: any): Promise<{ ran: number; sent: number }> {
  const { data: broadcasts, error } = await sb.rpc("claim_due_broadcasts");
  if (error) throw new Error(error.message);

  let ran = 0;
  let sent = 0;
  for (const b of (broadcasts ?? []) as BroadcastRow[]) {
    try {
      sent += await sendBroadcast(sb, b);
      ran++;
    } catch (error) {
      await sb.from("broadcasts").update({ locked_at: null }).eq("id", b.id);
      throw error;
    }
  }
  return { ran, sent };
}
