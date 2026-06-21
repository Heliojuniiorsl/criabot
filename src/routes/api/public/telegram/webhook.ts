import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";

import { localDb, sqlite, upsertTelegramGroup } from "@/lib/database.server";
import { resolveSalesBotRuntimeByWebhookSecret } from "@/lib/sales-bot-registry.server";
import { enterSalesBotRuntime } from "@/lib/sales-bot-runtime.server";
import {
  createPixOrder,
  checkSalesOrderPayment,
  effectivePlanPrice,
  recordCustomerEvent,
  sendPixQrCode,
  sendPixOrder,
} from "@/lib/sales.server";
import { resendPlanAccess } from "@/lib/fulfillment.server";
import {
  approveChatJoinRequest,
  answerCallbackQuery,
  copyMessage,
  deleteMessage,
  declineChatJoinRequest,
  editMessageCaption,
  editMessageText,
  getChatMemberCount,
  sendMessage,
  sendPhoto,
  sendVideo,
  revokeChatInviteLink,
  type InlineKeyboard,
} from "@/lib/telegram.server";

type MenuAction = "plans" | "offers" | "myaccess" | "support" | "terms" | "text" | "url";
type MenuButton = {
  id: string;
  label: string;
  action?: MenuAction;
  value?: string | null;
  enabled: boolean;
};
type Target = { chatId: number; messageId?: number; hasMedia?: boolean };
type ProductRef = { plan_id?: string; offer_id?: string };

const defaultButtons: MenuButton[] = [
  { id: "plans", label: "💎 Ver planos", action: "plans", enabled: true },
  { id: "offers", label: "🎁 Ofertas e combos", action: "offers", enabled: true },
  { id: "terms", label: "📜 Termos e regras", action: "terms", enabled: true },
];

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

const fmtPrice = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
const fmtDate = (value: string) => new Date(value).toLocaleDateString("pt-BR");
const backMenu: InlineKeyboard = [[{ text: "⬅️ Menu", callback_data: "menu" }]];

function categoryName(value: unknown) {
  return String(value ?? "Geral").trim() || "Geral";
}

function categoryKey(value: string) {
  return createHash("sha256").update(value).digest("base64url").slice(0, 16);
}

function formatRemaining(value: string | null | undefined) {
  if (!value) return "";
  const ms = Date.parse(value) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "encerrando";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.ceil(hours / 24)} dias`;
}

function enforceFloodLimit(telegramId: number) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const windowMs = 60_000;
  const blockMs = 2 * 60_000;
  const limit = 35;
  const row = sqlite
    .prepare(
      `SELECT hits, window_start, blocked_until
       FROM bot_rate_limits
       WHERE telegram_id = ? AND scope = 'sales'`,
    )
    .get(telegramId) as
    | { hits: number; window_start: string; blocked_until: string | null }
    | undefined;

  if (row?.blocked_until && Date.parse(row.blocked_until) > now) {
    return {
      allowed: false,
      retrySeconds: Math.ceil((Date.parse(row.blocked_until) - now) / 1000),
    };
  }

  const currentWindow = row?.window_start ? Date.parse(row.window_start) : 0;
  const resetWindow = !row || !Number.isFinite(currentWindow) || now - currentWindow > windowMs;
  const hits = resetWindow ? 1 : Number(row.hits) + 1;
  const blockedUntil = hits > limit ? new Date(now + blockMs).toISOString() : null;

  sqlite
    .prepare(
      `INSERT INTO bot_rate_limits
       (telegram_id, scope, hits, window_start, blocked_until, updated_at)
       VALUES (?, 'sales', ?, ?, ?, ?)
       ON CONFLICT(telegram_id, scope) DO UPDATE SET
         hits = excluded.hits,
         window_start = excluded.window_start,
         blocked_until = excluded.blocked_until,
         updated_at = excluded.updated_at`,
    )
    .run(telegramId, hits, resetWindow ? nowIso : row.window_start, blockedUntil, nowIso);

  if (blockedUntil) return { allowed: false, retrySeconds: Math.ceil(blockMs / 1000) };
  return { allowed: true, retrySeconds: 0 };
}

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const runtimeSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        const runtime = resolveSalesBotRuntimeByWebhookSecret(runtimeSecret);
        const token = runtime?.token;
        if (runtime) enterSalesBotRuntime(runtime);
        if (!runtime || !token) return new Response("Unauthorized", { status: 401 });

        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (contentLength > 1_000_000) return new Response("Payload muito grande", { status: 413 });

        const update = await request.json();
        const sb = localDb;
        const updateId = Number(update.update_id);
        if (Number.isFinite(updateId)) {
          const { error } = await sb.from("telegram_updates").insert({ update_id: updateId });
          if (error?.code === "23505") return Response.json({ ok: true, duplicate: true });
          if (error) throw new Error(error.message);
        }

        const { data: settings } = await sb.from("bot_settings").select("*").limit(1).maybeSingle();
        const rawButtons = Array.isArray(settings?.menu_buttons)
          ? (settings.menu_buttons as MenuButton[])
          : defaultButtons;
        const buttons = (rawButtons.length ? rawButtons : defaultButtons)
          .filter((button) => {
            const action = String(button.action ?? button.id);
            return (
              !["contents", "myaccess", "support"].includes(action) && button.id !== "contents"
            );
          })
          .map((button) => ({
            ...button,
            action: button.action ?? (button.id as MenuAction),
            value: button.value ?? "",
          }));
        const mainMenu: InlineKeyboard = buttons
          .filter((button) => button.enabled)
          .map((button) => [
            button.action === "url"
              ? { text: button.label, url: button.value || "https://t.me" }
              : { text: button.label, callback_data: `menu_item:${button.id}` },
          ]);

        async function render(target: Target, text: string, keyboard?: InlineKeyboard) {
          if (target.messageId) {
            try {
              if (target.hasMedia) {
                await editMessageCaption(target.chatId, target.messageId, text, keyboard);
              } else {
                await editMessageText(target.chatId, target.messageId, text, keyboard);
              }
              return;
            } catch {
              // Older messages or unsupported media may no longer be editable.
            }
          }
          await sendMessage(target.chatId, text, keyboard);
        }

        function looksLikeVideoUrl(value: string) {
          return /\.(mp4|mov|m4v|webm)(?:[?#].*)?$/i.test(value);
        }

        function isActiveOffer(offer: any, now = Date.now()) {
          return (
            (offer.plan_ids?.length ?? 0) > 0 &&
            (!offer.starts_at || Date.parse(offer.starts_at) <= now) &&
            (!offer.ends_at || Date.parse(offer.ends_at) >= now)
          );
        }

        async function getCatalogItems() {
          const now = Date.now();
          const [{ data: plans }, { data: offersData }] = await Promise.all([
            sb.from("plans").select("*").eq("is_active", true).order("price"),
            sb.from("offers").select("*").eq("is_active", true).order("price"),
          ]);
          const offers = (offersData ?? []).filter((offer: any) => isActiveOffer(offer, now));
          return { plans: plans ?? [], offers };
        }

        async function buildPlansKeyboard() {
          const { plans, offers } = await getCatalogItems();
          const keyboard: InlineKeyboard = [];
          for (const offer of offers) {
            keyboard.push([
              {
                text: `🎁 ${offer.name} — ${fmtPrice(offer.price)}${
                  offer.ends_at ? ` | acaba em ${formatRemaining(offer.ends_at)}` : ""
                }`,
                callback_data: `offer_${offer.id}`,
              },
            ]);
          }
          for (const plan of plans) {
            keyboard.push([
              {
                text: `💎 ${plan.name} — ${fmtPrice(effectivePlanPrice(plan))}`,
                callback_data: `plan_${plan.id}`,
              },
            ]);
          }
          return { keyboard, plans, offers };
        }

        async function sendWelcome(chatId: number, options: { deleteMessageId?: number } = {}) {
          const { keyboard, offers } = await buildPlansKeyboard();
          if (!keyboard.length) {
            await sendMessage(chatId, "Nenhum plano disponível no momento.");
            return;
          }
          if (
            settings?.welcome_mode === "telegram_message" &&
            settings.welcome_source_chat_id &&
            settings.welcome_source_message_id
          ) {
            try {
              await copyMessage(
                chatId,
                settings.welcome_source_chat_id,
                Number(settings.welcome_source_message_id),
                keyboard,
              );
              if (options.deleteMessageId) {
                await deleteMessage(chatId, options.deleteMessageId).catch(() => undefined);
              }
              return;
            } catch (error) {
              console.error("[welcome-ready-message]", error);
            }
          }
          if (options.deleteMessageId) {
            await deleteMessage(chatId, options.deleteMessageId).catch(() => undefined);
          }
          const text = settings?.welcome_message ?? "Bem-vindo(a)!";
          const prompt =
            offers.length > 0
              ? "Escolha uma oferta ou plano abaixo. As ofertas ativas aparecem primeiro."
              : "Escolha um plano abaixo.";
          const caption = `${text}\n\n${prompt}`;
          if (settings?.welcome_image_url) {
            if (looksLikeVideoUrl(settings.welcome_image_url)) {
              await sendVideo(chatId, settings.welcome_image_url, caption, keyboard);
            } else {
              await sendPhoto(chatId, settings.welcome_image_url, caption, keyboard);
            }
          } else {
            await sendMessage(chatId, caption, keyboard);
          }
        }

        async function ensureUser(from: any) {
          const { data, error } = await sb
            .from("users")
            .upsert(
              {
                telegram_id: from.id,
                telegram_username: from.username ?? null,
                name: [from.first_name, from.last_name].filter(Boolean).join(" ") || null,
                last_interaction_at: new Date().toISOString(),
              },
              { onConflict: "telegram_id" },
            )
            .select("*")
            .single();
          if (error || !data) throw new Error(error?.message ?? "Falha ao criar usuário");
          return data;
        }

        function isManagedTelegramChat(chat: any): chat is {
          id: number;
          title?: string;
          username?: string;
          type: "group" | "supergroup" | "channel";
        } {
          return chat?.type === "group" || chat?.type === "supergroup" || chat?.type === "channel";
        }

        async function syncGroup(
          chat: any,
          options: { botStatus?: string; isActive?: boolean; loadMemberCount?: boolean } = {},
        ) {
          if (!isManagedTelegramChat(chat)) return;
          let memberCount: number | null | undefined;
          if (options.loadMemberCount && options.isActive) {
            try {
              memberCount = await getChatMemberCount(chat.id);
            } catch (error) {
              console.warn("[telegram-group-count]", error);
            }
          }
          upsertTelegramGroup({
            telegramChatId: chat.id,
            title: chat.title ?? "Grupo sem título",
            username: chat.username ?? null,
            type: chat.type,
            botStatus: options.botStatus,
            isActive: options.isActive,
            memberCount,
          });
        }

        async function dispatchAction(target: Target, user: any, action: MenuAction, value = "") {
          if (action === "plans") return showPlans(target);
          if (action === "offers") return showPlans(target);
          if (action === "myaccess") return showAccess(target, user.id);
          if (action === "support") return showSupport(target);
          if (action === "terms") return showTerms(target);
          if (action === "text")
            return render(target, value || "Mensagem não configurada.", backMenu);
        }

        async function beginPurchase(
          target: Target,
          user: any,
          ref: ProductRef,
          autoRenew = false,
        ) {
          if (!user.email) {
            await sb.from("bot_sessions").upsert({
              user_id: user.id,
              state: "awaiting_email",
              payload: { ref, autoRenew },
            });
            await render(
              target,
              "📧 <b>Informe seu e-mail</b>\n\nO Mercado Pago exige um e-mail para gerar o Pix. Envie seu e-mail nesta conversa.",
              backMenu,
            );
            return;
          }
          try {
            const order = await createPixOrder({ userId: user.id, ref, autoRenew });
            await sendPixOrder(target.chatId, order);
            await render(
              target,
              "⏳ <b>Pix gerado</b>\n\nAguardando o pagamento. Assim que ele for aprovado, o acesso será enviado automaticamente.",
              [[{ text: "🏠 Menu inicial", callback_data: "menu" }]],
            );
          } catch (error) {
            console.error("[pix-order]", error);
            await render(
              target,
              "Não foi possível gerar o Pix agora. Confira o e-mail informado ou tente novamente em alguns minutos.",
              backMenu,
            );
          }
        }

        try {
          if (update.chat_join_request) {
            const joinRequest = update.chat_join_request;
            const chatId = Number(joinRequest.chat?.id);
            const telegramUserId = Number(joinRequest.from?.id);
            const inviteLink = String(joinRequest.invite_link?.invite_link ?? "");
            const grant = sqlite
              .prepare(
                `SELECT id, telegram_user_id, expires_at, product_name
                 FROM telegram_access_grants
                 WHERE chat_id = ? AND invite_link = ? AND status = 'pending'`,
              )
              .get(chatId, inviteLink) as
              | {
                  id: string;
                  telegram_user_id: number;
                  expires_at: string;
                  product_name: string;
                }
              | undefined;
            if (
              !grant ||
              grant.telegram_user_id !== telegramUserId ||
              Date.parse(grant.expires_at) <= Date.now()
            ) {
              await declineChatJoinRequest(chatId, telegramUserId);
              if (grant && Date.parse(grant.expires_at) <= Date.now()) {
                sqlite
                  .prepare(
                    `UPDATE telegram_access_grants
                     SET status = 'expired', updated_at = ? WHERE id = ?`,
                  )
                  .run(new Date().toISOString(), grant.id);
              }
              return Response.json({ ok: true, joinRequestApproved: false });
            }

            await approveChatJoinRequest(chatId, telegramUserId);
            const now = new Date().toISOString();
            sqlite
              .prepare(
                `UPDATE telegram_access_grants
                 SET status = 'approved', approved_at = ?, updated_at = ? WHERE id = ?`,
              )
              .run(now, now, grant.id);
            await revokeChatInviteLink(chatId, inviteLink).catch((error) =>
              console.warn("[telegram-invite-revoke]", error),
            );
            await sendMessage(
              telegramUserId,
              `✅ Entrada aprovada para <b>${escapeHtml(grant.product_name)}</b>.`,
            ).catch((error) => console.warn("[telegram-access-confirmation]", error));
            return Response.json({ ok: true, joinRequestApproved: true });
          }

          if (update.my_chat_member) {
            const membership = update.my_chat_member;
            const status = String(membership.new_chat_member?.status ?? "left");
            const isActive = ["creator", "administrator", "member", "restricted"].includes(status);
            await syncGroup(membership.chat, {
              botStatus: status,
              isActive,
              loadMemberCount: true,
            });
            return Response.json({ ok: true, groupUpdated: true });
          }

          if (update.message) {
            const message = update.message;
            const chatId = message.chat.id;
            if (isManagedTelegramChat(message.chat) && message.chat.type !== "channel") {
              await syncGroup(message.chat, { isActive: true });
              return Response.json({ ok: true, groupActivity: true });
            }
            const forwardedChannel =
              message.forward_origin?.type === "channel"
                ? message.forward_origin.chat
                : message.forward_from_chat?.type === "channel"
                  ? message.forward_from_chat
                  : null;
            if (forwardedChannel?.id) {
              await sendMessage(
                chatId,
                `📢 <b>Canal identificado</b>\n\n${escapeHtml(forwardedChannel.title ?? "Canal")}\nID: <code>${forwardedChannel.id}</code>\n\nUse esse número no campo “ID do canal protegido” do conteúdo.`,
              );
              return Response.json({ ok: true, channelIdentified: true });
            }
            const text = String(message.text ?? "").trim();
            const user = await ensureUser(message.from);
            const flood = enforceFloodLimit(Number(message.from.id));
            if (!flood.allowed) {
              await sendMessage(
                chatId,
                `Voce enviou muitas acoes em pouco tempo. Aguarde ${flood.retrySeconds}s e tente novamente.`,
              );
              return Response.json({ ok: true, rateLimited: true });
            }
            if (user.is_blocked) {
              await sendMessage(
                chatId,
                "Seu atendimento está bloqueado. Entre em contato com o suporte.",
              );
              return Response.json({ ok: true, blocked: true });
            }

            const { data: session } = await sb
              .from("bot_sessions")
              .select("*")
              .eq("user_id", user.id)
              .maybeSingle();
            if (session?.state === "awaiting_email" && !text.startsWith("/")) {
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
                await sendMessage(chatId, "Esse e-mail não parece válido. Envie novamente.");
                return Response.json({ ok: true });
              }
              await sb.from("users").update({ email: text.toLowerCase() }).eq("id", user.id);
              await sb.from("bot_sessions").delete().eq("user_id", user.id);
              const payload = session.payload as { ref: ProductRef; autoRenew?: boolean };
              try {
                const order = await createPixOrder({
                  userId: user.id,
                  ref: payload.ref,
                  autoRenew: payload.autoRenew,
                });
                await sendPixOrder(chatId, order);
              } catch (error) {
                console.error("[pix-order]", error);
                await sendMessage(
                  chatId,
                  "Não foi possível gerar o Pix agora. Confira o e-mail ou tente novamente em alguns minutos.",
                  backMenu,
                );
              }
              return Response.json({ ok: true });
            }

            const ageGate: InlineKeyboard = [
              [{ text: "✅ Tenho 18 anos ou mais", callback_data: "confirm_age" }],
              [{ text: "❌ Sou menor de idade", callback_data: "deny_age" }],
            ];
            if (text.startsWith("/start")) {
              recordCustomerEvent(user.id, "bot_started", "Abriu o bot");
              if (!user.is_adult_confirmed) {
                await sendMessage(
                  chatId,
                  "🔞 <b>Conteúdo adulto (+18)</b>\n\nEste serviço é exclusivo para maiores de 18 anos.",
                  ageGate,
                );
              } else await sendWelcome(chatId);
            } else if (!user.is_adult_confirmed) {
              await sendMessage(chatId, "Confirme sua maioridade primeiro com /start.", ageGate);
            } else if (text.startsWith("/planos")) await showPlans({ chatId });
            else if (text.startsWith("/ofertas")) await showPlans({ chatId });
            else if (text.startsWith("/meusacessos")) await showAccess({ chatId }, user.id);
            else if (text.startsWith("/suporte")) await showSupport({ chatId });
            else if (text.startsWith("/termos")) await showTerms({ chatId });
            else await sendMessage(chatId, "Use /start para abrir o menu.", mainMenu);
            return Response.json({ ok: true });
          }

          if (update.channel_post?.chat) {
            await syncGroup(update.channel_post.chat, { isActive: true });
            return Response.json({ ok: true, channelActivity: true });
          }

          if (update.callback_query) {
            const callback = update.callback_query;
            const chatId = callback.message.chat.id;
            const target = {
              chatId,
              messageId: callback.message.message_id,
              hasMedia: Boolean(
                callback.message.photo ||
                callback.message.video ||
                callback.message.document ||
                callback.message.animation,
              ),
            };
            const data = String(callback.data ?? "");
            const user = await ensureUser(callback.from);
            if (user.is_blocked) {
              await answerCallbackQuery(callback.id, "Seu atendimento está bloqueado.");
              await sendMessage(
                chatId,
                "Seu atendimento está bloqueado. Entre em contato com o suporte.",
              );
              return Response.json({ ok: true, blocked: true });
            }
            const flood = enforceFloodLimit(Number(callback.from.id));
            if (!flood.allowed) {
              await answerCallbackQuery(
                callback.id,
                `Aguarde ${flood.retrySeconds}s antes de tentar de novo.`,
              );
              return Response.json({ ok: true, rateLimited: true });
            }
            const purchaseFromGroup =
              isManagedTelegramChat(callback.message.chat) &&
              (data.startsWith("buy_") || data.startsWith("renew_"));
            const planAutomationFromGroup =
              isManagedTelegramChat(callback.message.chat) &&
              (data === "auto_plans" || data.startsWith("auto_plan_"));
            const checkingPayment = data.startsWith("pix_check:");
            if (!checkingPayment) {
              await answerCallbackQuery(
                callback.id,
                purchaseFromGroup
                  ? "Abra o bot no privado para concluir a compra."
                  : planAutomationFromGroup
                    ? "Enviei os planos no privado."
                    : undefined,
              );
            }
            if (purchaseFromGroup) {
              return Response.json({ ok: true, privatePurchaseRequired: true });
            }

            if (checkingPayment) {
              const orderId = data.slice("pix_check:".length);
              try {
                const result = await checkSalesOrderPayment({ orderId, userId: user.id });
                const statusText =
                  result.status === "approved"
                    ? result.alreadyDelivered
                      ? "Pagamento aprovado. Seu acesso ja foi enviado."
                      : "Pagamento aprovado! Seu acesso foi liberado."
                    : result.status === "pending"
                      ? "Pagamento ainda pendente. Aguarde alguns instantes e tente novamente."
                      : `Pagamento ainda nao aprovado. Status: ${result.status}.`;
                await answerCallbackQuery(callback.id, statusText, true);
              } catch (error) {
                console.error("[pix-check]", error);
                await answerCallbackQuery(
                  callback.id,
                  error instanceof Error
                    ? error.message
                    : "Nao foi possivel verificar o pagamento agora.",
                  true,
                );
              }
              return Response.json({ ok: true, pixChecked: true });
            }

            if (data.startsWith("pix_qr:")) {
              const orderId = data.slice("pix_qr:".length);
              const owner = sqlite
                .prepare("SELECT user_id FROM orders WHERE id = ?")
                .get(orderId) as { user_id: string } | undefined;
              if (!owner || owner.user_id !== user.id) {
                await render(target, "Pedido nao encontrado para esta conta.", backMenu);
                return Response.json({ ok: true, pixQrDenied: true });
              }
              try {
                await sendPixQrCode(chatId, orderId);
              } catch (error) {
                console.error("[pix-qr]", error);
                await sendMessage(
                  chatId,
                  "Nao consegui abrir o QR Code agora. Use o Pix copia e cola enviado acima.",
                );
              }
              return Response.json({ ok: true, pixQr: true });
            }

            if (data === "confirm_age") {
              await sb.from("users").update({ is_adult_confirmed: true }).eq("id", user.id);
              await sendWelcome(chatId, { deleteMessageId: target.messageId });
            } else if (data === "deny_age") {
              await render(target, "Acesso permitido apenas para maiores de 18 anos. 🔞");
            } else if (!user.is_adult_confirmed) {
              await render(target, "Confirme sua maioridade primeiro com /start.");
            } else if (data === "auto_plans") {
              try {
                await sendWelcome(Number(callback.from.id));
              } catch (error) {
                console.error("[group-automation-plans-private]", error);
              }
            } else if (data.startsWith("auto_plan_")) {
              try {
                await showPlanDetail(
                  { chatId: Number(callback.from.id) },
                  data.slice("auto_plan_".length),
                );
              } catch (error) {
                console.error("[group-automation-plan-private]", error);
              }
            } else if (data === "menu") {
              await sendWelcome(chatId, { deleteMessageId: target.messageId });
            } else if (data === "menu_new") {
              await sendWelcome(chatId, { deleteMessageId: target.messageId });
            } else if (data === "plans_new") {
              await sendWelcome(chatId, { deleteMessageId: target.messageId });
            } else if (data === "offers_new") {
              await sendWelcome(chatId, { deleteMessageId: target.messageId });
            } else if (data === "contents_new") {
              await sendWelcome(chatId, { deleteMessageId: target.messageId });
            } else if (data.startsWith("menu_item:")) {
              const item = buttons.find((button) => button.id === data.slice("menu_item:".length));
              if (item)
                await dispatchAction(target, user, item.action as MenuAction, item.value ?? "");
            } else if (data === "plans") await showPlans(target);
            else if (data === "offers") await showPlans(target);
            else if (data === "contents") await showPlans(target);
            else if (data === "myaccess") await showAccess(target, user.id);
            else if (data === "support") await showSupport(target);
            else if (data === "terms") await showTerms(target);
            else if (data.startsWith("plan_")) await showPlanDetail(target, data.slice(5));
            else if (data.startsWith("offer_")) await showOfferDetail(target, data.slice(6));
            else if (data.startsWith("access_plan:")) {
              const planId = data.slice("access_plan:".length);
              try {
                await resendPlanAccess({ userId: user.id, planId });
                recordCustomerEvent(user.id, "plan_access_resent", "Convite VIP reenviado", {
                  plan_id: planId,
                });
                await render(target, "Enviei um novo convite VIP em outra mensagem.", backMenu);
              } catch (error) {
                console.error("[plan-access-resend]", error);
                await render(
                  target,
                  "Nao consegui gerar o convite. Confirme se o plano ainda esta ativo.",
                  backMenu,
                );
              }
            } else if (
              data.startsWith("content_cat:") ||
              data.startsWith("access_content:") ||
              data.startsWith("content_")
            )
              await showPlans(target);
            else if (data.startsWith("buy_plan_")) {
              await beginPurchase(target, user, { plan_id: data.slice(9) });
            } else if (data.startsWith("renew_plan_")) {
              await beginPurchase(target, user, { plan_id: data.slice(11) }, true);
            } else if (data.startsWith("buy_offer_")) {
              await beginPurchase(target, user, { offer_id: data.slice(10) });
            } else if (data.startsWith("buy_content_")) await showPlans(target);
            return Response.json({ ok: true });
          }
          return Response.json({ ok: true, ignored: true });
        } catch (error) {
          console.error("[telegram-webhook]", error);
          if (Number.isFinite(updateId)) {
            await sb.from("telegram_updates").delete().eq("update_id", updateId);
          }
          return new Response("Falha temporária", { status: 500 });
        }

        async function showPlans(target: Target) {
          await sendWelcome(target.chatId, { deleteMessageId: target.messageId });
        }

        async function showPlanDetail(target: Target, id: string) {
          const { data: plan } = await sb.from("plans").select("*").eq("id", id).single();
          if (!plan) return render(target, "Plano não encontrado.", backMenu);
          const price = effectivePlanPrice(plan);
          const keyboard: InlineKeyboard = [
            [{ text: `✅ Comprar — ${fmtPrice(price)}`, callback_data: `buy_plan_${plan.id}` }],
            [{ text: "⬅️ Ver todos os planos", callback_data: "plans" }],
          ];
          if (
            plan.description_mode === "telegram_message" &&
            plan.description_source_chat_id &&
            plan.description_source_message_id
          ) {
            try {
              await copyMessage(
                target.chatId,
                plan.description_source_chat_id,
                Number(plan.description_source_message_id),
                keyboard,
              );
              if (target.messageId) {
                await deleteMessage(target.chatId, target.messageId).catch(() => undefined);
              }
              return;
            } catch (error) {
              console.error("[plan-ready-message]", error);
            }
          }
          const promo =
            price !== Number(plan.price) ? `\n<s>${fmtPrice(plan.price)}</s> por ` : "\n";
          await render(
            target,
            `💎 <b>${escapeHtml(plan.name)}</b>\n${plan.description ?? ""}\n\n⏳ ${plan.duration_days} dias${promo}<b>${fmtPrice(price)}</b>`,
            keyboard,
          );
        }

        async function showOffers(target: Target) {
          const { data } = await sb.from("offers").select("*").eq("is_active", true).order("price");
          const now = Date.now();
          const offers = (data ?? []).filter((offer: any) => isActiveOffer(offer, now));
          if (!offers.length) return render(target, "Nenhuma oferta ativa no momento.", backMenu);
          const keyboard: InlineKeyboard = offers.map((offer: any) => [
            {
              text: `🎁 ${offer.name} — ${fmtPrice(offer.price)}${
                offer.ends_at ? ` | acaba em ${formatRemaining(offer.ends_at)}` : ""
              }`,
              callback_data: `offer_${offer.id}`,
            },
          ]);
          keyboard.push([{ text: "⬅️ Ver todos os planos", callback_data: "plans" }]);
          await render(
            target,
            "🎁 <b>Ofertas, combos e promoções</b>\n\nEscolha uma oferta:",
            keyboard,
          );
        }

        async function showOfferDetail(target: Target, id: string) {
          const { data: offer } = await sb.from("offers").select("*").eq("id", id).single();
          if (!offer) return render(target, "Oferta não encontrada.", backMenu);
          const items: string[] = [];
          for (const planId of offer.plan_ids ?? []) {
            const { data: plan } = await sb
              .from("plans")
              .select("name")
              .eq("id", planId)
              .maybeSingle();
            if (plan) items.push(`💎 ${plan.name}`);
          }
          const deadline = offer.ends_at
            ? `\n⏰ Válida até ${fmtDate(offer.ends_at)} — acaba em ${formatRemaining(
                offer.ends_at,
              )}`
            : "";
          await render(
            target,
            `🎁 <b>${escapeHtml(offer.name)}</b>\n${offer.description ?? ""}\n\n${items.join("\n")}${deadline}\n\n💰 <b>${fmtPrice(offer.price)}</b>`,
            [
              [
                {
                  text: `✅ Comprar combo — ${fmtPrice(offer.price)}`,
                  callback_data: `buy_offer_${offer.id}`,
                },
              ],
              [{ text: "⬅️ Ver todos os planos", callback_data: "plans" }],
            ],
          );
        }

        async function showContents(target: Target, categoryHash?: string) {
          {
            const allContents = sqlite
              .prepare(
                `SELECT * FROM contents
                 WHERE is_active = 1
                 ORDER BY category COLLATE NOCASE, price ASC, title COLLATE NOCASE`,
              )
              .all() as Record<string, any>[];
            if (!allContents.length)
              return render(target, "Nenhum conteudo avulso disponivel.", backMenu);

            const categoryMap = new Map<string, number>();
            for (const content of allContents) {
              const name = categoryName(content.category);
              categoryMap.set(name, (categoryMap.get(name) ?? 0) + 1);
            }
            const categories = [...categoryMap.entries()].map(([name, count]) => ({
              name,
              count,
            }));
            const selectedCategory =
              categoryHash && categoryHash !== "all"
                ? categories.find((category) => categoryKey(category.name) === categoryHash)?.name
                : null;

            if (!selectedCategory && categoryHash !== "all" && categories.length > 1) {
              const keyboard: InlineKeyboard = categories.map((category) => [
                {
                  text: `${category.name} (${category.count})`,
                  callback_data: `content_cat:${categoryKey(category.name)}`,
                },
              ]);
              keyboard.push([{ text: "Ver todos", callback_data: "content_cat:all" }]);
              keyboard.push([{ text: "Voltar ao menu", callback_data: "menu" }]);
              return render(target, "<b>Conteudos avulsos</b>\n\nEscolha uma categoria:", keyboard);
            }

            const visibleContents = selectedCategory
              ? allContents.filter((content) => categoryName(content.category) === selectedCategory)
              : allContents;
            const keyboard: InlineKeyboard = visibleContents.map((content) => [
              {
                text: `${content.title} - ${fmtPrice(content.price)}`,
                callback_data: `content_${content.id}`,
              },
            ]);
            if (categories.length > 1)
              keyboard.push([{ text: "Categorias", callback_data: "contents" }]);
            keyboard.push([{ text: "Voltar ao menu", callback_data: "menu" }]);
            const title = selectedCategory ? `Categoria: ${escapeHtml(selectedCategory)}` : "Todos";
            return render(
              target,
              `<b>Conteudos avulsos</b>\n\n${title}\nEscolha um item:`,
              keyboard,
            );
          }
        }

        async function showContentDetail(target: Target, id: string) {
          const { data: content } = await sb.from("contents").select("*").eq("id", id).single();
          if (!content) return render(target, "Conteúdo não encontrado.", backMenu);
          const caption = `🖼️ <b>${escapeHtml(content.title)}</b>\n${content.description ?? ""}\n\n💰 ${fmtPrice(content.price)}`;
          const keyboard: InlineKeyboard = [
            [
              {
                text: `✅ Comprar — ${fmtPrice(content.price)}`,
                callback_data: `buy_content_${content.id}`,
              },
            ],
            [{ text: "⬅️ Conteúdos", callback_data: "contents" }],
          ];
          if (content.preview_url)
            await sendPhoto(target.chatId, content.preview_url, caption, keyboard);
          else await render(target, caption, keyboard);
        }

        async function showAccess(target: Target, userId: string) {
          {
            const nowIso = new Date().toISOString();
            const activePlans = sqlite
              .prepare(
                `SELECT s.plan_id, s.end_date, s.auto_renew, p.name
                 FROM subscriptions s
                 LEFT JOIN plans p ON p.id = s.plan_id
                 WHERE s.user_id = ? AND s.status = 'active' AND s.end_date > ?
                 ORDER BY s.end_date DESC`,
              )
              .all(userId, nowIso) as Record<string, any>[];
            const paidOffers = sqlite
              .prepare(
                `SELECT f.name, MAX(o.created_at) AS purchased_at
                 FROM orders o
                 JOIN offers f ON f.id = o.offer_id
                 WHERE o.user_id = ? AND o.status = 'paid'
                 GROUP BY f.id
                 ORDER BY purchased_at DESC`,
              )
              .all(userId) as Record<string, any>[];

            if (!activePlans.length && !paidOffers.length) {
              return render(target, "Voce ainda nao tem acessos ativos ou compras pagas.", [
                [{ text: "Ver planos", callback_data: "plans" }],
                [{ text: "Voltar ao menu", callback_data: "menu" }],
              ]);
            }

            const lines: string[] = ["<b>Seus acessos</b>"];
            if (activePlans.length) {
              lines.push(
                "\n<b>Planos ativos</b>",
                ...activePlans.map(
                  (plan) =>
                    `- ${escapeHtml(plan.name ?? "Plano")} ate ${fmtDate(plan.end_date)}${
                      plan.auto_renew ? " (renovacao automatica)" : ""
                    }`,
                ),
              );
            }
            if (paidOffers.length) {
              lines.push(
                "\n<b>Combos comprados</b>",
                ...paidOffers.map((offer) => `- ${escapeHtml(offer.name)}`),
              );
            }

            const keyboard: InlineKeyboard = [];
            for (const plan of activePlans.slice(0, 5)) {
              keyboard.push([
                {
                  text: `Entrar no VIP: ${plan.name ?? "plano"}`,
                  callback_data: `access_plan:${plan.plan_id}`,
                },
              ]);
              keyboard.push([
                {
                  text: `Renovar ${plan.name ?? "plano"}`,
                  callback_data: `renew_plan_${plan.plan_id}`,
                },
              ]);
            }
            keyboard.push([{ text: "Ver ofertas", callback_data: "offers" }]);
            keyboard.push([{ text: "Voltar ao menu", callback_data: "menu" }]);
            recordCustomerEvent(userId, "access_viewed", "Consultou os acessos pelo bot");
            return render(target, lines.join("\n"), keyboard);
          }
          const { data: subscriptions } = await sb
            .from("subscriptions")
            .select("status, end_date, auto_renew, plan_id, plans(name)")
            .eq("user_id", userId)
            .order("end_date", { ascending: false });
          const now = new Date().toISOString();
          const active = (subscriptions ?? []).filter(
            (subscription: any) => subscription.status === "active" && subscription.end_date > now,
          );
          if (!active.length) {
            return render(target, "Você ainda não tem acessos ativos.", [
              [{ text: "💎 Ver planos", callback_data: "plans" }],
              [{ text: "⬅️ Menu", callback_data: "menu" }],
            ]);
          }
          const lines = active.map(
            (subscription: any) =>
              `✅ ${subscription.plans?.name ?? "Plano"} — até ${fmtDate(subscription.end_date)}${
                subscription.auto_renew ? "\n   🔄 Renovação automática ativa" : ""
              }`,
          );
          const keyboard: InlineKeyboard = active.map((subscription: any) => [
            {
              text: `Renovar ${subscription.plans?.name ?? "plano"}`,
              callback_data: `renew_plan_${subscription.plan_id}`,
            },
          ]);
          keyboard.push([{ text: "⬅️ Menu", callback_data: "menu" }]);
          const group = settings?.private_group_link
            ? `\n\n🔗 Grupo privado: ${settings.private_group_link}`
            : "";
          await render(target, `🔑 <b>Seus acessos</b>\n\n${lines.join("\n\n")}${group}`, keyboard);
        }

        async function showSupport(target: Target) {
          await render(
            target,
            `💬 <b>Suporte</b>\n\n${settings?.support_link ?? "Em breve"}`,
            backMenu,
          );
        }

        async function showTerms(target: Target) {
          await render(
            target,
            `📜 <b>Termos e Regras</b>\n\n${settings?.terms_text ?? ""}`,
            backMenu,
          );
        }
      },
    },
  },
});
