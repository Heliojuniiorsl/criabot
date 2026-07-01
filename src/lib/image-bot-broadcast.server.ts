import { getManagedBotToken } from "@/lib/bot-manager.server";
import {
  claimDueImageBotGroupAutomations,
  claimImageBotGroupAutomationMedia,
  getImageBotGroupAutomationById,
  imageBotSqlite,
  markImageBotGroupAutomationSent,
  unlockImageBotGroupAutomation,
  type ImageBotAutomationPlanButton,
  type ImageBotGroupAutomationRow,
} from "@/lib/image-bot-database.server";
import {
  copyMessageWithToken,
  sendMessageWithToken,
  sendPhotoWithToken,
  sendVideoWithToken,
  type InlineKeyboard,
} from "@/lib/telegram.server";

type ImageBotGroupTarget = {
  telegram_chat_id: number;
  is_active: number;
};

function getTargetGroup(groupId: string) {
  const group = imageBotSqlite
    .prepare("SELECT telegram_chat_id, is_active FROM groups WHERE id = ?")
    .get(groupId) as ImageBotGroupTarget | undefined;
  if (!group) throw new Error("Grupo do UpMídias não encontrado");
  if (!group.is_active) throw new Error("O bot não está ativo neste grupo");
  return group;
}

function requireText(value: string, context: string) {
  const text = value.trim();
  if (!text) throw new Error(`${context} precisa de texto`);
  return text;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPlanKeyboard(buttons: ImageBotAutomationPlanButton[]): InlineKeyboard | undefined {
  const rows = buttons
    .map((button) => {
      if (button.kind === "premium_plans") {
        return [{ text: button.label, callback_data: "iauto:plans" }];
      }
      if (button.kind === "premium_plan" && button.plan_id) {
        return [
          {
            text: button.label,
            callback_data: `iauto:plan:${button.plan_id}`,
          },
        ];
      }
      if (button.kind === "bot_link" && button.url) {
        return [{ text: button.label, url: button.url }];
      }
      return null;
    })
    .filter(Boolean) as InlineKeyboard;
  return rows.length ? rows : undefined;
}

export async function sendImageBotGroupAutomationById(id: string) {
  const automation = getImageBotGroupAutomationById(id);
  if (!automation) throw new Error("Automação do grupo não encontrada");
  return sendImageBotGroupAutomation(automation);
}

export async function sendImageBotGroupAutomation(automation: ImageBotGroupAutomationRow) {
  const token = getManagedBotToken("images");
  if (!token) throw new Error("Bot de imagens não configurado");

  const group = getTargetGroup(automation.group_id);
  const chatId = group.telegram_chat_id;
  const message = automation.message.trim();
  const keyboard = buildPlanKeyboard(automation.buttons);
  let sent = 0;

  if (automation.content_kind === "text") {
    await sendMessageWithToken(
      token,
      chatId,
      requireText(message, "A automação de texto"),
      keyboard,
    );
    sent = 1;
  } else if (automation.content_kind === "custom_photo") {
    if (!automation.custom_media_url) throw new Error("Informe a URL da foto personalizada");
    await sendPhotoWithToken(token, chatId, automation.custom_media_url, message, keyboard);
    sent = 1;
  } else if (automation.content_kind === "custom_video") {
    if (!automation.custom_media_url) throw new Error("Informe a URL do vídeo personalizado");
    await sendVideoWithToken(token, chatId, automation.custom_media_url, message, keyboard);
    sent = 1;
  } else if (automation.content_kind === "saved_media") {
    if (automation.random_media_category) {
      const mediaItems = claimImageBotGroupAutomationMedia({
        automationId: automation.id,
        category: automation.random_media_category,
        count: automation.media_batch_size,
      });
      if (!mediaItems.length) {
        throw new Error("Não há mídias ativas nesta categoria");
      }

      for (const [index, media] of mediaItems.entries()) {
        const caption = message;
        const mediaKeyboard = index === mediaItems.length - 1 ? keyboard : undefined;
        if (media.media_type === "video") {
          await sendVideoWithToken(token, chatId, media.file_id, caption, mediaKeyboard);
        } else {
          await sendPhotoWithToken(token, chatId, media.file_id, caption, mediaKeyboard);
        }
        sent++;
        if (index < mediaItems.length - 1) await sleep(450);
      }
    } else if (!automation.saved_media_id || !automation.saved_media_file_id) {
      throw new Error("Selecione uma mídia salva do banco");
    }
    if (!automation.random_media_category && !automation.saved_media_is_active) {
      throw new Error("A mídia salva está inativa ou foi removida");
    }
    if (!automation.random_media_category) {
      const fileId = automation.saved_media_file_id;
      if (!fileId) throw new Error("Selecione uma mídia salva do banco");
      const caption = message;
      if (automation.saved_media_type === "video") {
        await sendVideoWithToken(token, chatId, fileId, caption, keyboard);
      } else {
        await sendPhotoWithToken(token, chatId, fileId, caption, keyboard);
      }
      sent = 1;
    }
  } else if (automation.content_kind === "telegram_message") {
    if (!automation.source_message_id) throw new Error("Informe o ID da mensagem do Telegram");
    if (message) await sendMessageWithToken(token, chatId, message);
    await copyMessageWithToken(
      token,
      chatId,
      automation.source_chat_id ?? chatId,
      automation.source_message_id,
      keyboard,
    );
    sent = 1;
  }

  markImageBotGroupAutomationSent(automation.id);
  return sent;
}

export async function runDueImageBotGroupAutomations() {
  const automations = claimDueImageBotGroupAutomations();
  let ran = 0;
  let sent = 0;

  for (const automation of automations) {
    try {
      sent += await sendImageBotGroupAutomation(automation);
      ran++;
    } catch (error) {
      unlockImageBotGroupAutomation(automation.id);
      console.error("[image-bot-group-automation] falha ao enviar", automation.id, error);
    }
  }

  return { ran, sent };
}
