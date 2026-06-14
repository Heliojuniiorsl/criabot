import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";

import { localDb } from "@/lib/database.server";

import {
  sendMessage,
  sendPhoto,
  editMessageText,
  answerCallbackQuery,
  type InlineKeyboard,
} from "@/lib/telegram.server";

type MenuButton = { id: string; label: string; enabled: boolean };

const defaultButtons: MenuButton[] = [
  { id: "plans", label: "💎 Ver planos", enabled: true },
  { id: "contents", label: "🖼️ Comprar conteúdo", enabled: true },
  { id: "myaccess", label: "🔑 Meus acessos", enabled: true },
  { id: "support", label: "💬 Suporte", enabled: true },
  { id: "terms", label: "📜 Termos e regras", enabled: true },
];

function deriveSecret(token: string): string {
  return createHash("sha256").update(`telegram-webhook:${token}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const fmtPrice = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v));

const backMenu: InlineKeyboard = [[{ text: "⬅️ Menu", callback_data: "menu" }]];

// Navigation target. When messageId is present we edit the existing message
// so the bot replaces the previous screen instead of stacking new messages.
type Target = { chatId: number; messageId?: number };

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) return new Response("Bot não configurado", { status: 500 });

        const expected = deriveSecret(token);
        const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!safeEqual(got, expected)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const update = await request.json();
        const sb = localDb;

        const updateId = Number(update.update_id);
        if (Number.isFinite(updateId)) {
          const { error: claimError } = await (sb as any)
            .from("telegram_updates")
            .insert({ update_id: updateId });
          if (claimError?.code === "23505") return Response.json({ ok: true, duplicate: true });
          if (claimError) throw new Error(claimError.message);
        }

        const { data: settings } = await sb.from("bot_settings").select("*").limit(1).maybeSingle();

        const rawButtons = (settings as any)?.menu_buttons as MenuButton[] | undefined;
        const buttons =
          Array.isArray(rawButtons) && rawButtons.length ? rawButtons : defaultButtons;
        const mainMenu: InlineKeyboard = buttons
          .filter((b) => b.enabled)
          .map((b) => [{ text: b.label, callback_data: b.id }]);
        const welcomeText = settings?.welcome_message ?? "Bem-vindo(a)!";
        const welcomeImage = (settings as any)?.welcome_image_url as string | undefined;

        // Show the welcome screen, with the configured image when available.
        async function sendWelcome(chatId: number) {
          if (welcomeImage) {
            await sendPhoto(chatId, welcomeImage, welcomeText, mainMenu);
          } else {
            await sendMessage(chatId, welcomeText, mainMenu);
          }
        }

        // Render to a target: edit the message when possible, otherwise send a
        // new one. This keeps a single "screen" that updates in place.
        async function render(target: Target, text: string, keyboard?: InlineKeyboard) {
          if (target.messageId) {
            const res = await editMessageText(target.chatId, target.messageId, text, keyboard);
            if (res?.ok) return;
            // Fallback (e.g. message too old / identical) -> send a new one.
          }
          await sendMessage(target.chatId, text, keyboard);
        }

        // Ensure customer record exists, return it
        async function ensureUser(from: any) {
          const { data: created, error } = await sb
            .from("users")
            .upsert(
              {
                telegram_id: from.id,
                telegram_username: from.username ?? null,
                name: [from.first_name, from.last_name].filter(Boolean).join(" ") || null,
              },
              { onConflict: "telegram_id" },
            )
            .select("*")
            .single();
          if (error || !created) throw new Error(error?.message ?? "Falha ao criar usuário");
          return created;
        }

        try {
          /* ----------------------------- Messages ----------------------------- */
          if (update.message) {
            const msg = update.message;
            const chatId = msg.chat.id;
            const text: string = msg.text ?? "";
            const user = await ensureUser(msg.from);
            const target: Target = { chatId };

            const ageGate: InlineKeyboard = [
              [{ text: "✅ Tenho 18 anos ou mais", callback_data: "confirm_age" }],
              [{ text: "❌ Sou menor de idade", callback_data: "deny_age" }],
            ];

            if (text.startsWith("/start")) {
              if (!user?.is_adult_confirmed) {
                await sendMessage(
                  chatId,
                  `🔞 <b>Conteúdo adulto (+18)</b>\n\nEste serviço é exclusivo para maiores de 18 anos. Confirme que você é maior de idade para continuar.`,
                  ageGate,
                );
              } else {
                await sendWelcome(chatId);
              }
            } else if (!user?.is_adult_confirmed) {
              await sendMessage(chatId, "Confirme sua maioridade primeiro com /start.", ageGate);
            } else if (text.startsWith("/planos")) {
              await showPlans(target);
            } else if (text.startsWith("/meusacessos")) {
              await showAccess(target, user.id);
            } else if (text.startsWith("/suporte")) {
              await showSupport(target);
            } else if (text.startsWith("/termos")) {
              await showTerms(target);
            } else {
              await sendMessage(chatId, "Use /start para abrir o menu.", mainMenu);
            }

            return Response.json({ ok: true });
          }

          /* ------------------------- Callback buttons ------------------------- */
          if (update.callback_query) {
            const cq = update.callback_query;
            const chatId = cq.message.chat.id;
            const messageId = cq.message.message_id;
            const data: string = cq.data ?? "";
            const user = await ensureUser(cq.from);
            const target: Target = { chatId, messageId };
            await answerCallbackQuery(cq.id);

            if (data === "confirm_age") {
              await sb.from("users").update({ is_adult_confirmed: true }).eq("id", user.id);
              await render(target, settings?.welcome_message ?? "Bem-vindo(a)!", mainMenu);
            } else if (data === "deny_age") {
              await render(target, "Acesso permitido apenas para maiores de 18 anos. 🔞");
            } else if (!user?.is_adult_confirmed) {
              await render(target, "Confirme sua maioridade primeiro com /start.");
            } else if (data === "menu") {
              await render(target, settings?.welcome_message ?? "Menu", mainMenu);
            } else if (data === "plans") {
              await showPlans(target);
            } else if (data === "contents") {
              await showContents(target);
            } else if (data === "myaccess") {
              await showAccess(target, user.id);
            } else if (data === "support") {
              await showSupport(target);
            } else if (data === "terms") {
              await showTerms(target);
            } else if (data.startsWith("plan_")) {
              await showPlanDetail(target, data.replace("plan_", ""));
            } else if (data.startsWith("content_")) {
              await showContentDetail(target, data.replace("content_", ""));
            } else if (data.startsWith("buy_plan_")) {
              await createOrder(target, user.id, { plan_id: data.replace("buy_plan_", "") });
            } else if (data.startsWith("buy_content_")) {
              await createOrder(target, user.id, { content_id: data.replace("buy_content_", "") });
            }

            return Response.json({ ok: true });
          }

          return Response.json({ ok: true, ignored: true });
        } catch (err) {
          console.error("[telegram-webhook]", err);
          if (Number.isFinite(updateId)) {
            await (sb as any).from("telegram_updates").delete().eq("update_id", updateId);
          }
          return new Response("Falha temporária", { status: 500 });
        }

        /* ------------------------------ Helpers ------------------------------ */
        async function showPlans(target: Target) {
          const { data: plans } = await sb
            .from("plans")
            .select("*")
            .eq("is_active", true)
            .order("price");
          if (!plans?.length) {
            await render(target, "Nenhum plano disponível no momento.", backMenu);
            return;
          }
          const keyboard: InlineKeyboard = plans.map((p: any) => [
            { text: `💎 ${p.name} — ${fmtPrice(p.price)}`, callback_data: `plan_${p.id}` },
          ]);
          keyboard.push([{ text: "⬅️ Menu", callback_data: "menu" }]);
          await render(
            target,
            "💎 <b>Planos disponíveis</b>\n\nEscolha um plano para ver os detalhes:",
            keyboard,
          );
        }

        async function showPlanDetail(target: Target, planId: string) {
          const { data: p } = await sb.from("plans").select("*").eq("id", planId).single();
          if (!p) {
            await render(target, "Plano não encontrado.", [
              [{ text: "⬅️ Planos", callback_data: "plans" }],
            ]);
            return;
          }
          await render(
            target,
            `💎 <b>${p.name}</b>\n${p.description ?? ""}\n\n⏳ ${p.duration_days} dias\n💰 ${fmtPrice(p.price)}`,
            [
              [{ text: `✅ Comprar — ${fmtPrice(p.price)}`, callback_data: `buy_plan_${p.id}` }],
              [{ text: "⬅️ Planos", callback_data: "plans" }],
            ],
          );
        }

        async function showContents(target: Target) {
          const { data: contents } = await sb
            .from("contents")
            .select("*")
            .eq("is_active", true)
            .order("price");
          if (!contents?.length) {
            await render(target, "Nenhum conteúdo avulso disponível.", backMenu);
            return;
          }
          const icon: Record<string, string> = { foto: "🖼️", video: "🎬", pacote: "📦" };
          const keyboard: InlineKeyboard = contents.map((c: any) => [
            {
              text: `${icon[c.type] ?? "🖼️"} ${c.title} — ${fmtPrice(c.price)}`,
              callback_data: `content_${c.id}`,
            },
          ]);
          keyboard.push([{ text: "⬅️ Menu", callback_data: "menu" }]);
          await render(
            target,
            "🖼️ <b>Conteúdos avulsos</b>\n\nEscolha um item para ver os detalhes:",
            keyboard,
          );
        }

        async function showContentDetail(target: Target, contentId: string) {
          const { data: c } = await sb.from("contents").select("*").eq("id", contentId).single();
          if (!c) {
            await render(target, "Conteúdo não encontrado.", [
              [{ text: "⬅️ Conteúdos", callback_data: "contents" }],
            ]);
            return;
          }
          const icon: Record<string, string> = { foto: "🖼️", video: "🎬", pacote: "📦" };
          const caption = `${icon[c.type] ?? "🖼️"} <b>${c.title}</b>\n${c.description ?? ""}\n\n💰 ${fmtPrice(c.price)}`;
          const keyboard: InlineKeyboard = [
            [{ text: `✅ Comprar — ${fmtPrice(c.price)}`, callback_data: `buy_content_${c.id}` }],
            [{ text: "⬅️ Conteúdos", callback_data: "contents" }],
          ];
          // Show the image as a preview (like a description) when available.
          if ((c as any).preview_url) {
            await sendPhoto(target.chatId, (c as any).preview_url, caption, keyboard);
          } else {
            await render(target, caption, keyboard);
          }
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

        async function createOrder(
          target: Target,
          userId: string,
          ref: { plan_id?: string; content_id?: string },
        ) {
          let amount = 0;
          let label = "";
          let description: string | null = null;
          if (ref.plan_id) {
            const { data: p } = await sb
              .from("plans")
              .select("name, description, price")
              .eq("id", ref.plan_id)
              .eq("is_active", true)
              .single();
            if (!p) throw new Error("Plano indisponível");
            amount = Number(p?.price ?? 0);
            label = p?.name ?? "Plano";
            description = p.description;
          } else if (ref.content_id) {
            const { data: c } = await sb
              .from("contents")
              .select("title, description, price, file_url")
              .eq("id", ref.content_id)
              .eq("is_active", true)
              .single();
            if (!c?.file_url) throw new Error("Conteúdo indisponível para entrega");
            amount = Number(c?.price ?? 0);
            label = c?.title ?? "Conteúdo";
            description = c.description;
          }

          if (amount <= 0) throw new Error("O valor do produto deve ser maior que zero");

          const { data: order } = await sb
            .from("orders")
            .insert({
              user_id: userId,
              plan_id: ref.plan_id ?? null,
              content_id: ref.content_id ?? null,
              amount,
              status: "pending",
            })
            .select("id")
            .single();

          if (!order) throw new Error("Falha ao criar pedido");
          const publicBaseUrl = process.env.PUBLIC_BASE_URL;
          if (!publicBaseUrl) throw new Error("PUBLIC_BASE_URL não configurado");

          try {
            const { createPaymentPreference } = await import("@/lib/mercado-pago.server");
            const preference = await createPaymentPreference({
              orderId: order.id,
              title: label,
              description,
              amount,
              publicBaseUrl,
            });
            const { error: paymentError } = await (sb as any).from("payments").insert({
              order_id: order.id,
              provider: "mercado_pago",
              provider_preference_id: preference.preferenceId,
              payment_url: preference.paymentUrl,
              amount,
              status: "pending",
            });
            if (paymentError) throw new Error(paymentError.message);

            await render(
              target,
              `🧾 <b>Pedido criado</b>\n${label}\n💰 ${fmtPrice(amount)}\n\nO acesso será liberado automaticamente após a aprovação.`,
              [
                [{ text: "💳 Pagar no Mercado Pago", url: preference.paymentUrl }],
                [{ text: "⬅️ Menu", callback_data: "menu" }],
              ],
            );
          } catch (error) {
            await sb.from("orders").delete().eq("id", order.id);
            throw error;
          }
        }

        async function showAccess(target: Target, userId: string) {
          const nowIso = new Date().toISOString();
          const { data: subs } = await sb
            .from("subscriptions")
            .select("status, end_date, plans(name)")
            .eq("user_id", userId)
            .order("end_date", { ascending: false });

          const active = (subs ?? []).filter(
            (s: any) => s.status === "active" && s.end_date > nowIso,
          );
          if (!active.length) {
            await render(target, "Você ainda não tem acessos ativos.", [
              [{ text: "💎 Ver planos", callback_data: "plans" }],
              [{ text: "⬅️ Menu", callback_data: "menu" }],
            ]);
            return;
          }
          const link = settings?.private_group_link
            ? `\n\n🔗 Grupo privado: ${settings.private_group_link}`
            : "";
          const lines = active
            .map(
              (s: any) =>
                `✅ ${s.plans?.name ?? "Plano"} — válido até ${new Date(s.end_date).toLocaleDateString("pt-BR")}`,
            )
            .join("\n");
          await render(target, `🔑 <b>Seus acessos</b>\n\n${lines}${link}`, backMenu);
        }
      },
    },
  },
});
