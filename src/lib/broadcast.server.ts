// Server-only logic to deliver a broadcast (automated message) to every bot user.
import {
  copyMessage,
  sendMessage,
  sendPhoto,
  sendVideo,
  type InlineKeyboard,
} from "@/lib/telegram.server";
import { sqlite } from "@/lib/database.server";

export type BroadcastButton = {
  label: string;
  kind: "link" | "bot" | "plans" | "plan" | "contents" | "offers" | "menu";
  url?: string | null;
  plan_id?: string | null;
};

export type BroadcastRow = {
  id: string;
  title: string;
  message: string;
  image_url: string | null;
  content_kind?: "custom" | "telegram_message";
  source_chat_id?: number | string | null;
  source_message_id?: number | null;
  buttons: BroadcastButton[];
  interval_minutes: number;
  is_active: boolean;
  last_sent_at: string | null;
  locked_at: string | null;
  audience_type: "all" | "plan" | "purchase" | "active" | "inactive";
  audience_value: string | null;
  activity_days: number;
};

export type GroupBroadcastRow = {
  id: string;
  group_id: string;
  title: string;
  message: string;
  image_url: string | null;
  buttons: BroadcastButton[];
  interval_minutes: number;
  is_active: boolean;
  last_sent_at: string | null;
  locked_at: string | null;
};

function normalizeTelegramBotUrl(value: string | null | undefined) {
  const input = value?.trim() ?? "";
  if (!input) return null;
  const username = input
    .replace(/^https?:\/\/(?:t|telegram)\.me\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/, 1)[0];
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) return null;
  return `https://t.me/${username}`;
}

function buildKeyboard(
  buttons: BroadcastButton[],
  options: { openPlansInPrivate?: boolean } = {},
): InlineKeyboard | undefined {
  const rows = (buttons ?? [])
    .map((button): { text: string; url?: string; callback_data?: string } | null => {
      if (button.kind === "link") {
        if (!button.url) return null;
        return { text: button.label, url: button.url };
      }
      if (button.kind === "bot") {
        const url = normalizeTelegramBotUrl(button.url);
        return url ? { text: button.label, url } : null;
      }
      if (button.kind === "plan") {
        if (!button.plan_id) return null;
        return {
          text: button.label,
          callback_data: `${options.openPlansInPrivate ? "auto_plan_" : "plan_"}${button.plan_id}`,
        };
      }
      if (button.kind === "plans" && options.openPlansInPrivate) {
        return { text: button.label, callback_data: "auto_plans" };
      }
      // plans / contents / offers / menu are handled by the bot webhook callbacks
      return { text: button.label, callback_data: button.kind };
    })
    .filter(Boolean) as { text: string; url?: string; callback_data?: string }[];

  if (!rows.length) return undefined;
  return rows.map((r) => [r]);
}

function validateButtons(buttons: BroadcastButton[]) {
  for (const button of buttons ?? []) {
    if (button.kind === "plan" && !button.plan_id) {
      throw new Error(`O botao "${button.label}" precisa de um plano`);
    }
    if (button.kind === "link" && !/^https?:\/\/\S+$/i.test(button.url ?? "")) {
      throw new Error(
        `O botão "${button.label}" precisa de um link completo começando com https://`,
      );
    }
    if (button.kind === "bot" && !normalizeTelegramBotUrl(button.url)) {
      throw new Error(`O botão "${button.label}" precisa do @usuario ou link do bot`);
    }
  }
}

function isVideoMedia(value: string) {
  return (
    /^telegram-file:\/\/video\//i.test(value) || /\.(mp4|mov|m4v|webm)(?:[?#].*)?$/i.test(value)
  );
}

function resolveBroadcastMedia(value: string) {
  const telegramFile = /^telegram-file:\/\/(?:photo|video)\/(.+)$/i.exec(value);
  return telegramFile?.[1] ?? value;
}

// Delivers a single broadcast to all users and stamps last_sent_at.
// Returns the number of users reached.
export async function sendBroadcast(sb: any, b: BroadcastRow): Promise<number> {
  const values: unknown[] = [];
  let condition = "1 = 1";
  if (b.audience_type === "plan" && b.audience_value) {
    condition = `EXISTS (
      SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.plan_id = ?
      AND s.status = 'active' AND s.end_date > ?
    )`;
    values.push(b.audience_value, new Date().toISOString());
  } else if (b.audience_type === "purchase") {
    const [kind, id] = (b.audience_value ?? "any:").split(":", 2);
    if (kind === "any") {
      condition = "EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status = 'paid')";
    } else if (["plan", "content", "offer"].includes(kind) && id) {
      condition = `EXISTS (
        SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status = 'paid'
        AND o.${kind}_id = ?
      )`;
      values.push(id);
    }
  } else if (b.audience_type === "active") {
    condition = "u.last_interaction_at >= ?";
    values.push(new Date(Date.now() - Number(b.activity_days || 30) * 86_400_000).toISOString());
  } else if (b.audience_type === "inactive") {
    condition = "(u.last_interaction_at IS NULL OR u.last_interaction_at < ?)";
    values.push(new Date(Date.now() - Number(b.activity_days || 30) * 86_400_000).toISOString());
  }
  const users = sqlite
    .prepare(`SELECT u.telegram_id FROM users u WHERE u.is_blocked = 0 AND ${condition}`)
    .all(...values) as { telegram_id: number | string }[];
  const recipients = users
    .map((u) => u.telegram_id)
    .filter((id: any) => typeof id === "number" || typeof id === "string");

  const keyboard = buildKeyboard(b.buttons);
  const contentKind = b.content_kind ?? "custom";

  if (contentKind === "telegram_message") {
    if (!b.source_chat_id || !b.source_message_id) {
      throw new Error("Informe o chat de origem e o ID da mensagem pronta");
    }

    let sent = 0;
    for (const chatId of recipients) {
      try {
        await copyMessage(chatId, b.source_chat_id, Number(b.source_message_id), keyboard);
        sent++;
      } catch (err) {
        console.error("[broadcast] falha ao copiar mensagem para", chatId, err);
      }
    }

    await sb
      .from("broadcasts")
      .update({ last_sent_at: new Date().toISOString(), locked_at: null })
      .eq("id", b.id);
    return sent;
  }

  let sent = 0;
  for (const chatId of recipients) {
    try {
      if (b.image_url) {
        const media = resolveBroadcastMedia(b.image_url);
        if (isVideoMedia(b.image_url)) {
          await sendVideo(chatId, media, b.message, keyboard);
        } else {
          await sendPhoto(chatId, media, b.message, keyboard);
        }
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

// Runs all active broadcasts whose interval in minutes has elapsed since last_sent_at.
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

export async function sendGroupBroadcast(sb: any, broadcast: GroupBroadcastRow): Promise<number> {
  const group = sqlite
    .prepare("SELECT telegram_chat_id, is_active FROM telegram_groups WHERE id = ?")
    .get(broadcast.group_id) as { telegram_chat_id: number; is_active: number } | undefined;
  if (!group) throw new Error("Grupo não encontrado");
  if (!group.is_active) throw new Error("O bot não está ativo neste grupo");

  validateButtons(broadcast.buttons);
  const keyboard = buildKeyboard(broadcast.buttons, { openPlansInPrivate: true });
  if (broadcast.image_url) {
    const media = resolveBroadcastMedia(broadcast.image_url);
    if (isVideoMedia(broadcast.image_url)) {
      await sendVideo(group.telegram_chat_id, media, broadcast.message, keyboard);
    } else {
      await sendPhoto(group.telegram_chat_id, media, broadcast.message, keyboard);
    }
  } else {
    await sendMessage(group.telegram_chat_id, broadcast.message, keyboard);
  }
  await sb
    .from("group_broadcasts")
    .update({ last_sent_at: new Date().toISOString(), locked_at: null })
    .eq("id", broadcast.id);
  return 1;
}

export async function runDueGroupBroadcasts(sb: any): Promise<{ ran: number; sent: number }> {
  const { data: broadcasts, error } = await sb.rpc("claim_due_group_broadcasts");
  if (error) throw new Error(error.message);

  let ran = 0;
  let sent = 0;
  for (const broadcast of (broadcasts ?? []) as GroupBroadcastRow[]) {
    try {
      sent += await sendGroupBroadcast(sb, broadcast);
      ran++;
    } catch (error) {
      const invalidButton =
        error instanceof Error && error.message.includes("precisa de um link completo");
      await sb
        .from("group_broadcasts")
        .update({ locked_at: null, ...(invalidButton ? { is_active: false } : {}) })
        .eq("id", broadcast.id);
      console.error("[group-broadcast] falha ao enviar", broadcast.id, error);
    }
  }
  return { ran, sent };
}
