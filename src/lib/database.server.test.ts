import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let database: typeof import("./database.server");
let botTokenStore: typeof import("./bot-token-store.server");
let testDirectory: string;

beforeAll(async () => {
  testDirectory = mkdtempSync(join(tmpdir(), "criabot-"));
  vi.stubEnv("DATABASE_PATH", join(testDirectory, "test.sqlite"));
  vi.stubEnv("MEDIA_DIR", join(testDirectory, "media"));
  vi.resetModules();
  database = await import("./database.server");
  botTokenStore = await import("./bot-token-store.server");
});

afterAll(() => {
  database.closeSalesBotCloneDatabases();
  botTokenStore.closeBotTokenStore();
  database.sqlite.close();
  vi.unstubAllEnvs();
  rmSync(testDirectory, { recursive: true, force: true });
});

describe("SQLite local", () => {
  it("isola os clientes de um clone do bot de vendas", async () => {
    const clonePath = join(testDirectory, "clone.sqlite");
    await database.clonePrimarySalesDatabase(clonePath);
    const { runWithSalesBotRuntime } = await import("./sales-bot-runtime.server");

    await runWithSalesBotRuntime(
      {
        id: "clone-test",
        key: "sales-clone:clone-test",
        token: "123456:clone-token",
        databasePath: clonePath,
        username: "clone_bot",
        isPrimary: false,
      },
      async () => {
        const before = await database.localDb.from("users").select("*");
        expect(before.data).toHaveLength(0);
        await database.localDb
          .from("users")
          .insert({ telegram_id: 987654, telegram_username: "somente_clone" });
      },
    );

    const primary = await database.localDb
      .from("users")
      .select("*")
      .eq("telegram_id", 987654)
      .maybeSingle();
    expect(primary.data).toBeNull();
  });

  it("atualiza o cliente do Telegram sem trocar seu id", async () => {
    const first = await database.localDb
      .from("users")
      .upsert({ telegram_id: 123, telegram_username: "primeiro", name: "Cliente" })
      .select("*")
      .single();
    const second = await database.localDb
      .from("users")
      .upsert({ telegram_id: 123, telegram_username: "atualizado", name: "Cliente" })
      .select("*")
      .single();

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(second.data.id).toBe(first.data.id);
    expect(second.data.telegram_username).toBe("atualizado");
  });

  it("confirma pagamento e cria uma assinatura de forma transacional", async () => {
    const user = await database.localDb.from("users").select("*").eq("telegram_id", 123).single();
    const plan = await database.localDb
      .from("plans")
      .insert({ name: "Mensal", price: 29.9, duration_days: 30, is_active: true })
      .select("*")
      .single();
    const order = await database.localDb
      .from("orders")
      .insert({
        user_id: user.data.id,
        plan_id: plan.data.id,
        amount: 29.9,
        status: "pending",
      })
      .select("*")
      .single();

    const confirmation = await database.localDb.rpc("confirm_mercado_pago_payment", {
      p_order_id: order.data.id,
      p_provider_payment_id: "mp-test-1",
      p_provider_status: "accredited",
      p_paid_at: new Date().toISOString(),
      p_amount: 29.9,
    });
    const paidOrder = await database.localDb
      .from("orders")
      .select("*")
      .eq("id", order.data.id)
      .single();
    const subscriptions = await database.localDb
      .from("subscriptions")
      .select("*")
      .eq("user_id", user.data.id);

    expect(confirmation).toEqual({ data: true, error: null });
    expect(paidOrder.data.status).toBe("paid");
    expect(subscriptions.data).toHaveLength(1);
    expect(subscriptions.data[0].status).toBe("active");
  });

  it("confirma pagamento de plano vitalicio sem vencimento real", async () => {
    const user = await database.localDb.from("users").select("*").eq("telegram_id", 123).single();
    const plan = await database.localDb
      .from("plans")
      .insert({
        name: "Vitalicio",
        price: 55,
        access_type: "lifetime",
        duration_days: 30,
        renewal_enabled: true,
        is_active: true,
      })
      .select("*")
      .single();
    const order = await database.localDb
      .from("orders")
      .insert({
        user_id: user.data.id,
        plan_id: plan.data.id,
        amount: 55,
        status: "pending",
        auto_renew: true,
      })
      .select("*")
      .single();

    const confirmation = await database.localDb.rpc("confirm_mercado_pago_payment", {
      p_order_id: order.data.id,
      p_provider_payment_id: "mp-lifetime-1",
      p_provider_status: "accredited",
      p_paid_at: new Date().toISOString(),
      p_amount: 55,
    });
    const subscription = await database.localDb
      .from("subscriptions")
      .select("*")
      .eq("user_id", user.data.id)
      .eq("plan_id", plan.data.id)
      .single();

    expect(confirmation).toEqual({ data: true, error: null });
    expect(subscription.data.status).toBe("active");
    expect(subscription.data.end_date).toMatch(/^9999-/);
    expect(Number(subscription.data.auto_renew)).toBe(0);
  });

  it("confirma um combo e libera todos os planos incluidos", async () => {
    const user = await database.localDb.from("users").select("*").eq("telegram_id", 123).single();
    const plan = await database.localDb
      .from("plans")
      .insert({ name: "Combo VIP", price: 49.9, duration_days: 15, is_active: true })
      .select("*")
      .single();
    const offer = await database.localDb
      .from("offers")
      .insert({
        name: "Oferta VIP",
        price: 39.9,
        plan_ids: [plan.data.id],
        content_ids: [],
        is_active: true,
      })
      .select("*")
      .single();
    const order = await database.localDb
      .from("orders")
      .insert({ user_id: user.data.id, offer_id: offer.data.id, amount: 39.9, status: "pending" })
      .select("*")
      .single();

    const confirmation = await database.localDb.rpc("confirm_mercado_pago_payment", {
      p_order_id: order.data.id,
      p_provider_payment_id: "mp-combo-1",
      p_provider_status: "accredited",
      p_amount: 39.9,
    });
    const subscriptions = await database.localDb
      .from("subscriptions")
      .select("*")
      .eq("user_id", user.data.id)
      .eq("plan_id", plan.data.id);

    expect(confirmation.error).toBeNull();
    expect(subscriptions.data).toHaveLength(1);
    expect(subscriptions.data[0].status).toBe("active");
  });

  it("mantem o estado temporario do bot em JSON", async () => {
    const user = await database.localDb.from("users").select("*").eq("telegram_id", 123).single();
    const session = await database.localDb
      .from("bot_sessions")
      .upsert({
        user_id: user.data.id,
        state: "awaiting_email",
        payload: { ref: { plan_id: "plan-test" } },
      })
      .select("*")
      .single();

    expect(session.error).toBeNull();
    expect(session.data.payload.ref.plan_id).toBe("plan-test");
  });

  it("registra entrada, atividade e saida do bot em grupos", () => {
    database.upsertTelegramGroup({
      telegramChatId: -1001234567890,
      title: "Grupo de clientes",
      username: "clientes_teste",
      type: "supergroup",
      botStatus: "administrator",
      isActive: true,
      memberCount: 42,
    });
    database.upsertTelegramGroup({
      telegramChatId: -1001234567890,
      title: "Grupo VIP",
      type: "supergroup",
      botStatus: "left",
      isActive: false,
    });

    const groups = database.getTelegramGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      telegram_chat_id: -1001234567890,
      title: "Grupo VIP",
      bot_status: "left",
      is_active: false,
      member_count: 42,
    });
    expect(groups[0].left_at).toBeTruthy();
  });

  it("registra canais do bot de vendas na mesma listagem de grupos", () => {
    database.upsertTelegramGroup({
      telegramChatId: -1009876543210,
      title: "Canal VIP",
      username: "canal_vip_teste",
      type: "channel",
      botStatus: "administrator",
      isActive: true,
      memberCount: 120,
    });

    const channel = database
      .getTelegramGroups()
      .find((item) => item.telegram_chat_id === -1009876543210);
    expect(channel).toMatchObject({
      title: "Canal VIP",
      username: "canal_vip_teste",
      type: "channel",
      bot_status: "administrator",
      is_active: true,
      member_count: 120,
    });
  });

  it("consolida um grupo migrado para supergrupo sem perder automacoes", async () => {
    database.upsertTelegramGroup({
      telegramChatId: -55667788,
      title: "Grupo migrado",
      type: "group",
      botStatus: "member",
      isActive: true,
      memberCount: 12,
    });
    const oldGroup = database
      .getTelegramGroups()
      .find((item) => item.telegram_chat_id === -55667788)!;
    await database.localDb.from("group_broadcasts").insert({
      group_id: oldGroup.id,
      title: "Mensagem preservada",
      message: "A automacao deve acompanhar o supergrupo.",
      interval_minutes: 10,
      is_active: false,
    });

    expect(database.migrateTelegramGroupChatId(-55667788, -10055667788)).toBe(true);

    const groups = database.getTelegramGroups().filter((item) => item.title === "Grupo migrado");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      telegram_chat_id: -10055667788,
      type: "supergroup",
    });
    const broadcasts = await database.localDb
      .from("group_broadcasts")
      .select("*")
      .eq("group_id", groups[0].id);
    expect(broadcasts.data).toHaveLength(1);
    expect(broadcasts.data[0].title).toBe("Mensagem preservada");
  });

  it("remove registros antigos duplicados quando o supergrupo ja existe", () => {
    database.upsertTelegramGroup({
      telegramChatId: -44556677,
      title: "Mesmo grupo",
      type: "group",
      botStatus: "member",
      isActive: true,
      memberCount: 8,
    });
    database.upsertTelegramGroup({
      telegramChatId: -10044556677,
      title: "Mesmo grupo",
      type: "supergroup",
      botStatus: "administrator",
      isActive: true,
      memberCount: 8,
    });

    const matchingGroups = database
      .getTelegramGroups()
      .filter((item) => item.title === "Mesmo grupo");
    expect(matchingGroups).toHaveLength(1);
    expect(matchingGroups[0]).toMatchObject({
      telegram_chat_id: -10044556677,
      type: "supergroup",
    });
  });

  it("libera mensagens automaticas de grupos pelo intervalo em minutos", async () => {
    database.upsertTelegramGroup({
      telegramChatId: -1001234567891,
      title: "Grupo ativo",
      type: "supergroup",
      botStatus: "administrator",
      isActive: true,
    });
    const group = database
      .getTelegramGroups()
      .find((item) => item.telegram_chat_id === -1001234567891)!;
    const message = await database.localDb
      .from("group_broadcasts")
      .insert({
        group_id: group.id,
        title: "Aviso do grupo",
        message: "Mensagem automatica",
        buttons: [
          { label: "Abrir site", kind: "link", url: "https://example.com" },
          { label: "Ver planos", kind: "plans", url: null },
        ],
        interval_minutes: 5,
        is_active: true,
        last_sent_at: new Date(Date.now() - 4 * 60_000).toISOString(),
      })
      .select("*")
      .single();

    const early = await database.localDb.rpc("claim_due_group_broadcasts");
    expect(early.data).toHaveLength(0);

    await database.localDb
      .from("group_broadcasts")
      .update({ last_sent_at: new Date(Date.now() - 6 * 60_000).toISOString() })
      .eq("id", message.data.id);
    const due = await database.localDb.rpc("claim_due_group_broadcasts");

    expect(due.error).toBeNull();
    expect(due.data).toHaveLength(1);
    expect(due.data[0].group_id).toBe(group.id);
    expect(due.data[0].buttons).toEqual([
      { label: "Abrir site", kind: "link", url: "https://example.com" },
      { label: "Ver planos", kind: "plans", url: null },
    ]);
  });

  it("envia botoes configurados na mensagem automatica do grupo", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:test-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { message_id: 2 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const plan = await database.localDb
      .from("plans")
      .insert({
        name: "Plano da automacao",
        price: 9.9,
        duration_days: 30,
        is_active: true,
      })
      .select("*")
      .single();
    const group = database
      .getTelegramGroups()
      .find((item) => item.telegram_chat_id === -1001234567891)!;
    const message = await database.localDb
      .from("group_broadcasts")
      .insert({
        group_id: group.id,
        title: "Mensagem com botoes",
        message: "Escolha uma opcao",
        buttons: [
          { label: "Site", kind: "link", url: "https://example.com" },
          { label: "Abrir bot", kind: "bot", url: "@brunabbgg_bot" },
          { label: "Planos", kind: "plans", url: null },
          { label: "Plano escolhido", kind: "plan", plan_id: plan.data.id, url: null },
        ],
        interval_minutes: 60,
        is_active: false,
      })
      .select("*")
      .single();
    const { sendGroupBroadcast } = await import("./broadcast.server");

    await sendGroupBroadcast(database.localDb, message.data);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.chat_id).toBe(-1001234567891);
    expect(body.reply_markup.inline_keyboard).toEqual([
      [{ text: "Site", url: "https://example.com" }],
      [{ text: "Abrir bot", url: "https://t.me/brunabbgg_bot" }],
      [{ text: "Planos", callback_data: "auto_plans" }],
      [{ text: "Plano escolhido", callback_data: `auto_plan_${plan.data.id}` }],
    ]);
    vi.unstubAllGlobals();
  });

  it("impede envio de botao de grupo com link invalido antes do Telegram", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:test-token");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const group = database
      .getTelegramGroups()
      .find((item) => item.telegram_chat_id === -1001234567891)!;
    const message = await database.localDb
      .from("group_broadcasts")
      .insert({
        group_id: group.id,
        title: "Link invalido",
        message: "Nao deve ser enviada",
        buttons: [{ label: "Abrir", kind: "link", url: "sem-protocolo" }],
        interval_minutes: 60,
        is_active: false,
      })
      .select("*")
      .single();
    const { sendGroupBroadcast } = await import("./broadcast.server");

    await expect(sendGroupBroadcast(database.localDb, message.data)).rejects.toThrow(
      "precisa de um link completo",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("envia video nas mensagens automaticas de grupos", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:test-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const group = database
      .getTelegramGroups()
      .find((item) => item.telegram_chat_id === -1001234567891)!;
    const message = await database.localDb
      .from("group_broadcasts")
      .insert({
        group_id: group.id,
        title: "Video automatico",
        message: "",
        image_url: "https://example.com/video.mp4",
        buttons: [],
        interval_minutes: 60,
        is_active: false,
      })
      .select("*")
      .single();
    const { sendGroupBroadcast } = await import("./broadcast.server");

    await sendGroupBroadcast(database.localDb, message.data);

    expect(String(fetchMock.mock.calls[0][0])).toContain("/sendVideo");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.video).toBe("https://example.com/video.mp4");
    vi.unstubAllGlobals();
  });

  it("envia video nas mensagens automaticas privadas", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:test-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const broadcast = await database.localDb
      .from("broadcasts")
      .insert({
        title: "Video privado",
        message: "Legenda do video",
        image_url: "https://example.com/campanha.webm",
        buttons: [],
        interval_minutes: 60,
        audience_type: "all",
        audience_value: null,
        activity_days: 30,
        is_active: false,
      })
      .select("*")
      .single();
    const { sendBroadcast } = await import("./broadcast.server");

    const sent = await sendBroadcast(database.localDb, broadcast.data);

    expect(sent).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.length).toBe(sent);
    expect(fetchMock.mock.calls.every((call) => String(call[0]).includes("/sendVideo"))).toBe(true);
    vi.unstubAllGlobals();
  });

  it("libera campanhas pelo intervalo configurado em minutos", async () => {
    const broadcast = await database.localDb
      .from("broadcasts")
      .insert({
        title: "Aviso rapido",
        message: "Mensagem automatica",
        interval_minutes: 3,
        is_active: true,
        last_sent_at: new Date(Date.now() - 2 * 60_000).toISOString(),
      })
      .select("*")
      .single();

    const early = await database.localDb.rpc("claim_due_broadcasts");
    expect(early.data).toHaveLength(0);

    await database.localDb
      .from("broadcasts")
      .update({ last_sent_at: new Date(Date.now() - 4 * 60_000).toISOString() })
      .eq("id", broadcast.data.id);
    const due = await database.localDb.rpc("claim_due_broadcasts");

    expect(due.error).toBeNull();
    expect(due.data).toHaveLength(1);
    expect(due.data[0].interval_minutes).toBe(3);
  });

  it("nao transforma preco sem promocao em zero", async () => {
    const { effectivePlanPrice } = await import("./sales.server");

    expect(effectivePlanPrice({ price: 10, promo_price: null })).toBe(10);
    expect(effectivePlanPrice({ price: 1, promo_price: null })).toBe(1);
  });

  it("usa o preco promocional somente dentro do prazo", async () => {
    const { effectivePlanPrice } = await import("./sales.server");
    const now = Date.parse("2026-06-14T12:00:00.000Z");
    const plan = {
      price: 10,
      promo_price: 7,
      promo_starts_at: "2026-06-14T11:00:00.000Z",
      promo_ends_at: "2026-06-14T13:00:00.000Z",
    };

    expect(effectivePlanPrice(plan, now)).toBe(7);
    expect(effectivePlanPrice(plan, Date.parse("2026-06-15T12:00:00.000Z"))).toBe(10);
  });

  it("envia Pix copia e cola como texto e deixa QR Code em um botao", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:test-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { sendPixOrder } = await import("./sales.server");
    const pixCode = "00020101021226850014br.gov.bcb.pix-test-code";

    await sendPixOrder(123, {
      orderId: "11111111-1111-4111-8111-111111111111",
      product: {
        label: "Plano mensal",
        description: null,
        amount: 10,
        ref: { plan_id: "22222222-2222-4222-8222-222222222222" },
      },
      paymentId: "123",
      status: "pending",
      qrCode: pixCode,
      qrCodeBase64: "cG5n",
      ticketUrl: "https://mercadopago.test/pix/123",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const keyboard = body.reply_markup;
    expect(body.text).toContain(pixCode);
    expect(keyboard.inline_keyboard[0][0]).toEqual({
      text: "📋 Copiar Pix copia e cola",
      copy_text: { text: pixCode },
    });
    expect(keyboard.inline_keyboard[1][0]).toEqual({
      text: "✅ Verificar pagamento",
      callback_data: "pix_check:11111111-1111-4111-8111-111111111111",
    });
    expect(keyboard.inline_keyboard[2][0]).toEqual({
      text: "Ver QR Code",
      callback_data: "pix_qr:11111111-1111-4111-8111-111111111111",
    });
    vi.unstubAllGlobals();
  });

  it("consulta o pagamento pendente no Mercado Pago sem liberar acesso", async () => {
    vi.stubEnv("MERCADO_PAGO_ACCESS_TOKEN", "TEST-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 9191,
          status: "pending",
          status_detail: "pending_waiting_payment",
          external_reference: "33333333-3333-4333-8333-333333333333",
          transaction_amount: 8,
          currency_id: "BRL",
          date_approved: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = await database.localDb
      .from("users")
      .upsert({
        telegram_id: 919191,
        name: "Cliente verificacao",
        email: "verificacao@example.com",
      })
      .select("*")
      .single();
    const plan = await database.localDb
      .from("plans")
      .insert({
        name: "Plano verificacao",
        access_chat_id: -1001234500000,
        price: 8,
        duration_days: 7,
        is_active: true,
      })
      .select("*")
      .single();
    const orderId = "33333333-3333-4333-8333-333333333333";
    await database.localDb.from("orders").insert({
      id: orderId,
      user_id: user.data.id,
      plan_id: plan.data.id,
      amount: 8,
      status: "pending",
    });
    await database.localDb.from("payments").insert({
      order_id: orderId,
      provider: "mercado_pago",
      provider_payment_id: "9191",
      status: "pending",
      amount: 8,
    });
    const { checkSalesOrderPayment } = await import("./sales.server");

    const result = await checkSalesOrderPayment({ orderId, userId: user.data.id });

    expect(result).toEqual({ status: "pending", alreadyDelivered: false });
    const order = await database.localDb.from("orders").select("*").eq("id", orderId).single();
    expect(order.data.status).toBe("pending");
    vi.unstubAllGlobals();
  });

  it("reutiliza Pix pendente recente para o mesmo produto", async () => {
    vi.stubEnv("PUBLIC_BASE_URL", "https://example.com");
    vi.stubEnv("MERCADO_PAGO_ACCESS_TOKEN", "TEST-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 777,
          status: "pending",
          point_of_interaction: {
            transaction_data: {
              qr_code: "000201-pix-reutilizado",
              qr_code_base64: "cG5n",
              ticket_url: "https://mercadopago.test/pix/777",
            },
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = await database.localDb
      .from("users")
      .upsert({
        telegram_id: 778899,
        name: "Cliente Pix",
        email: "cliente-pix@example.com",
      })
      .select("*")
      .single();
    const plan = await database.localDb
      .from("plans")
      .insert({ name: "Plano Reuso", price: 12.5, duration_days: 7, is_active: true })
      .select("*")
      .single();
    const { createPixOrder } = await import("./sales.server");

    const first = await createPixOrder({ userId: user.data.id, ref: { plan_id: plan.data.id } });
    const second = await createPixOrder({ userId: user.data.id, ref: { plan_id: plan.data.id } });

    expect(second.reused).toBe(true);
    expect(second.orderId).toBe(first.orderId);
    expect(second.qrCode).toBe(first.qrCode);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("aceita apenas referencias validas para entrega de conteudo", async () => {
    const { isDeliverableMediaReference, isTelegramAccessLink, postPurchaseKeyboard } =
      await import("./fulfillment.server");

    expect(isDeliverableMediaReference("private://private/arquivo.jpg")).toBe(true);
    expect(isDeliverableMediaReference("https://example.com/arquivo.jpg")).toBe(true);
    expect(isDeliverableMediaReference("teste")).toBe(false);
    expect(isDeliverableMediaReference("")).toBe(false);
    expect(isTelegramAccessLink("https://t.me/+convite-do-canal")).toBe(true);
    expect(isTelegramAccessLink("https://example.com/foto.jpg")).toBe(false);
    expect(postPurchaseKeyboard("contents", "https://t.me/+convite-do-canal")).toEqual([
      [{ text: "🔓 Entrar no canal", url: "https://t.me/+convite-do-canal" }],
      [{ text: "🛍️ Comprar novamente", callback_data: "contents_new" }],
      [{ text: "🏠 Menu inicial", callback_data: "menu_new" }],
      [{ text: "Ver ofertas", callback_data: "offers_new" }],
    ]);
  });

  it("cria convite de canal que exige aprovacao do bot", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:test-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: { invite_link: "https://t.me/+convite-individual" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { createChatJoinRequestInvite } = await import("./telegram.server");
    const expiresAt = new Date("2026-06-16T12:00:00.000Z");

    const invite = await createChatJoinRequestInvite(-1001234567890, "Pedido teste", expiresAt);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(invite.invite_link).toBe("https://t.me/+convite-individual");
    expect(body).toMatchObject({
      chat_id: -1001234567890,
      name: "Pedido teste",
      expire_date: Math.floor(expiresAt.getTime() / 1000),
      creates_join_request: true,
    });
    vi.unstubAllGlobals();
  });

  it("entrega um convite temporario do grupo configurado no plano", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:test-token");
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const result = String(url).endsWith("/createChatInviteLink")
        ? { invite_link: "https://t.me/+vip-individual" }
        : { message_id: 90 };
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, result }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = await database.localDb
      .from("users")
      .upsert({
        telegram_id: 445566,
        name: "Cliente VIP",
        email: "cliente-vip@example.com",
      })
      .select("*")
      .single();
    const plan = await database.localDb
      .from("plans")
      .insert({
        name: "VIP 30 dias",
        description: "Acesso ao grupo VIP",
        description_mode: "custom",
        access_chat_id: -1009988776655,
        price: 10,
        duration_days: 30,
        is_active: true,
      })
      .select("*")
      .single();
    const order = await database.localDb
      .from("orders")
      .insert({
        user_id: user.data.id,
        plan_id: plan.data.id,
        amount: 10,
        status: "pending",
      })
      .select("*")
      .single();
    const { fulfillOrder } = await import("./fulfillment.server");

    await fulfillOrder(database.localDb, {
      orderId: order.data.id,
      providerPaymentId: "mp-vip-1",
      providerStatus: "accredited",
      paidAt: new Date().toISOString(),
      amount: 10,
    });

    const inviteCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/createChatInviteLink"),
    );
    const inviteBody = JSON.parse(String(inviteCall?.[1]?.body));
    expect(inviteBody).toMatchObject({
      chat_id: -1009988776655,
      creates_join_request: true,
    });
    expect(inviteBody.expire_date).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const grant = database.sqlite
      .prepare(
        "SELECT telegram_user_id, chat_id, invite_link, status FROM telegram_access_grants WHERE order_id = ?",
      )
      .get(order.data.id) as Record<string, unknown>;
    expect(grant).toMatchObject({
      telegram_user_id: 445566,
      chat_id: -1009988776655,
      invite_link: "https://t.me/+vip-individual",
      status: "pending",
    });
    vi.unstubAllGlobals();
  });

  it("envia a mensagem do bot de imagens usando o segundo token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { message_id: 10 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { sendMessageWithToken } = await import("./telegram.server");

    await sendMessageWithToken("token-do-bot-de-imagens", 123, "Bem-vindo");

    expect(String(fetchMock.mock.calls[0][0])).toContain("/bottoken-do-bot-de-imagens/sendMessage");
    vi.unstubAllGlobals();
  });

  it("envia menu fixo de categorias no bot de imagens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { message_id: 11 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { sendMessageWithTokenReplyKeyboard } = await import("./telegram.server");

    await sendMessageWithTokenReplyKeyboard("token-imagens", 123, "Escolha", {
      keyboard: [[{ text: "Hétero" }, { text: "Trans" }]],
      resize_keyboard: true,
      one_time_keyboard: false,
      is_persistent: true,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.reply_markup).toEqual({
      keyboard: [[{ text: "Hétero" }, { text: "Trans" }]],
      resize_keyboard: true,
      one_time_keyboard: false,
      is_persistent: true,
    });
    vi.unstubAllGlobals();
  });

  it("atualiza a origem de midias locais para a URL publica atual", async () => {
    const { resolveTelegramFileReference } = await import("./telegram.server");
    const currentBase = "https://tunnel-atual.trycloudflare.com";

    expect(resolveTelegramFileReference("/api/public/media/public/foto.jpg", currentBase)).toBe(
      `${currentBase}/api/public/media/public/foto.jpg`,
    );
    expect(
      resolveTelegramFileReference(
        "https://tunnel-antigo.trycloudflare.com/api/public/media/public/foto.jpg",
        currentBase,
      ),
    ).toBe(`${currentBase}/api/public/media/public/foto.jpg`);
  });
});
