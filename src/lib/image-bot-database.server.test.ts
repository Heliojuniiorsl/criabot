import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let database: typeof import("./image-bot-database.server");
let testDirectory: string;
let databasePath: string;

beforeAll(async () => {
  testDirectory = mkdtempSync(join(tmpdir(), "upmidias-"));
  databasePath = join(testDirectory, "upmidias.sqlite");
  vi.stubEnv("IMAGE_BOT_DATABASE_PATH", databasePath);
  vi.resetModules();
  database = await import("./image-bot-database.server");
});

afterAll(() => {
  database.imageBotSqlite.close();
  vi.unstubAllEnvs();
  rmSync(testDirectory, { recursive: true, force: true });
});

describe("banco independente do UpMidias", () => {
  it("cria um arquivo SQLite proprio e salva as configuracoes", () => {
    const current = database.getImageBotSettings();
    database.updateImageBotSettings({
      id: current.id,
      welcome_message: "Bem-vindo ao UpMidias",
      welcome_image_url: "https://example.com/welcome.jpg",
      auto_message_plan_mode: "single",
      auto_message_plan_id: "11111111-1111-4111-8111-111111111111",
    });

    expect(existsSync(databasePath)).toBe(true);
    expect(database.getImageBotSettings()).toMatchObject({
      welcome_message: "Bem-vindo ao UpMidias",
      welcome_image_url: "https://example.com/welcome.jpg",
      auto_message_plan_mode: "single",
      auto_message_plan_id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("classifica os grupos e salva fotos e videos pelos IDs do Telegram", () => {
    database.upsertImageBotGroup({
      telegramChatId: -1001,
      title: "Grupo Hétero",
      type: "supergroup",
      botStatus: "administrator",
      memberCount: 20,
    });
    database.upsertImageBotGroup({
      telegramChatId: -1002,
      title: "Grupo Trans",
      type: "supergroup",
      botStatus: "administrator",
      memberCount: 15,
    });

    expect(database.getImageBotGroups()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ telegram_chat_id: -1001, category: "hetero" }),
        expect.objectContaining({ telegram_chat_id: -1002, category: "trans" }),
      ]),
    );

    expect(
      database.saveImageBotMedia({
        telegramChatId: -1001,
        telegramMessageId: 10,
        category: "hetero",
        mediaType: "photo",
        fileId: "photo-file-id",
        fileUniqueId: "photo-unique-id",
      }),
    ).toEqual({ saved: true });
    expect(
      database.saveImageBotMedia({
        telegramChatId: -1002,
        telegramMessageId: 11,
        category: "trans",
        mediaType: "video",
        fileId: "video-file-id",
        fileUniqueId: "video-unique-id",
      }),
    ).toEqual({ saved: true });
  });

  it("ignora midia duplicada e calcula a visao geral por tipo", () => {
    const duplicate = database.saveImageBotMedia({
      telegramChatId: -1001,
      telegramMessageId: 12,
      category: "hetero",
      mediaType: "photo",
      fileId: "photo-file-id-new-reference",
      fileUniqueId: "photo-unique-id",
    });

    expect(duplicate).toEqual({ saved: false });
    expect(database.getImageBotDashboardStats()).toEqual({
      total: 2,
      photos: 1,
      videos: 1,
      hetero: { total: 1, photos: 1, videos: 0 },
      trans: { total: 1, photos: 0, videos: 1 },
    });
  });

  it("preserva as midias quando um grupo vira supergrupo", () => {
    expect(database.migrateImageBotGroupChatId(-1001, -1001001)).toBe(true);

    const migratedGroup = database
      .getImageBotGroups()
      .find((group) => group.telegram_chat_id === -1001001);
    const migratedMedia = database.imageBotSqlite
      .prepare("SELECT telegram_chat_id FROM media WHERE file_unique_id = ?")
      .get("photo-unique-id") as { telegram_chat_id: number };

    expect(migratedGroup).toMatchObject({
      telegram_chat_id: -1001001,
      type: "supergroup",
      category: "hetero",
    });
    expect(migratedMedia.telegram_chat_id).toBe(-1001001);
  });

  it("suporta lotes com mais de cem midias", () => {
    for (let index = 0; index < 150; index += 1) {
      const isPhoto = index < 100;
      const result = database.saveImageBotMedia({
        telegramChatId: isPhoto ? -1001001 : -1002,
        telegramMessageId: 1000 + index,
        category: isPhoto ? "hetero" : "trans",
        mediaType: isPhoto ? "photo" : "video",
        fileId: `bulk-file-${index}`,
        fileUniqueId: `bulk-unique-${index}`,
        mediaGroupId: `album-${Math.floor(index / 10)}`,
      });
      expect(result.saved).toBe(true);
    }

    expect(database.getImageBotDashboardStats()).toEqual({
      total: 152,
      photos: 101,
      videos: 51,
      hetero: { total: 101, photos: 101, videos: 0 },
      trans: { total: 51, photos: 0, videos: 51 },
    });
  });

  it("sorteia midias de automacao de grupo sem repetir no ciclo", () => {
    const group = database
      .getImageBotGroups()
      .find((item) => item.category === "hetero" && item.is_active);
    expect(group).toBeTruthy();
    if (!group) return;

    const automation = database.upsertImageBotGroupAutomation({
      groupId: group.id,
      title: "Sorteio hetero",
      message: "",
      contentKind: "saved_media",
      randomMediaCategory: "hetero",
      mediaBatchSize: 3,
      buttons: [
        { label: "Planos Premium", kind: "premium_plans" },
        {
          label: "Plano escolhido",
          kind: "premium_plan",
          plan_id: "11111111-1111-4111-8111-111111111111",
        },
        {
          label: "Abrir bot",
          kind: "bot_link",
          url: "https://t.me/upmidias_bot",
        },
      ],
      intervalMinutes: 5,
      isActive: true,
    });
    expect(automation?.random_media_category).toBe("hetero");
    expect(automation?.buttons).toEqual([
      { label: "Planos Premium", kind: "premium_plans" },
      {
        label: "Plano escolhido",
        kind: "premium_plan",
        plan_id: "11111111-1111-4111-8111-111111111111",
      },
      {
        label: "Abrir bot",
        kind: "bot_link",
        url: "https://t.me/upmidias_bot",
      },
    ]);

    const first = database.claimImageBotGroupAutomationMedia({
      automationId: automation!.id,
      category: "hetero",
      count: 3,
    });
    const second = database.claimImageBotGroupAutomationMedia({
      automationId: automation!.id,
      category: "hetero",
      count: 3,
    });

    expect(first).toHaveLength(3);
    expect(second).toHaveLength(3);
    expect(new Set(first.map((media) => media.id)).size).toBe(3);
    expect(new Set(second.map((media) => media.id)).size).toBe(3);
    expect(second.some((media) => first.some((previous) => previous.id === media.id))).toBe(false);
  });

  it("entrega midia aleatoria com limite contra flood por usuario", () => {
    const first = database.claimImageBotMedia({
      telegramUserId: 777,
      category: "hetero",
      deliveryType: "photo",
      nowMs: 100_000,
    });
    const flooded = database.claimImageBotMedia({
      telegramUserId: 777,
      category: "hetero",
      deliveryType: "random",
      nowMs: 101_000,
    });
    const afterCooldown = database.claimImageBotMedia({
      telegramUserId: 777,
      category: "hetero",
      deliveryType: "random",
      nowMs: 103_001,
    });

    expect(first.status).toBe("ok");
    expect(flooded).toEqual({ status: "rate_limited", retryAfterSeconds: 2 });
    expect(afterCooldown.status).toBe("ok");
    if (first.status === "ok" && afterCooldown.status === "ok") {
      expect(afterCooldown.media.id).not.toBe(first.media.id);
      expect(database.getImageBotMedia().find((item) => item.id === first.media.id)).toMatchObject({
        delivery_count: first.media.delivery_count + 1,
        is_active: true,
      });

      expect(database.setImageBotMediaActive([first.media.id], false)).toBe(1);
      expect(database.getImageBotMedia().find((item) => item.id === first.media.id)).toMatchObject({
        is_active: false,
      });
      expect(database.setImageBotMediaActive([first.media.id], true)).toBe(1);
    }
  });

  it("aplica recursos do plano Premium sem remover a protecao por minuto", () => {
    const plan = database.saveImageBotPremiumPlan({
      name: "Premium rapido sem favoritos",
      description: "Reduz o intervalo, mas nao libera favoritos",
      price: 7,
      accessType: "days",
      accessDays: 30,
      allowFavorites: false,
      mediaCooldownSeconds: 1,
      dailyMediaLimit: 25,
      isActive: true,
    });
    database.upsertImageBotUser({
      telegramUserId: 778,
      firstName: "Premium",
      started: true,
    });
    database.grantImageBotPremiumAccess({
      telegramUserId: 778,
      planId: plan.id,
      source: "manual",
    });

    const first = database.claimImageBotMedia({
      telegramUserId: 778,
      category: "hetero",
      deliveryType: "random",
      nowMs: 300_000,
    });
    const afterOneSecond = database.claimImageBotMedia({
      telegramUserId: 778,
      category: "hetero",
      deliveryType: "random",
      nowMs: 301_001,
    });

    expect(first.status).toBe("ok");
    expect(afterOneSecond.status).toBe("ok");
    expect(database.hasImageBotFavoriteAccess(778)).toBe(false);
    expect(database.getImageBotPremiumFeatures(778)).toMatchObject({
      active: true,
      daily_media_limit: 25,
    });
  });

  it("aplica a cota diaria do Premium e bloqueia quando os creditos acabam", () => {
    const plan = database.saveImageBotPremiumPlan({
      name: "Premium com creditos",
      price: 8,
      accessType: "days",
      accessDays: 30,
      mediaCooldownSeconds: 0,
      dailyMediaLimit: 2,
      isActive: true,
    });
    database.upsertImageBotUser({
      telegramUserId: 779,
      firstName: "Premium limitado",
      started: true,
    });
    database.grantImageBotPremiumAccess({
      telegramUserId: 779,
      planId: plan.id,
      source: "manual",
    });

    const nowMs = Date.now();
    expect(
      database.claimImageBotMedia({
        telegramUserId: 779,
        category: "hetero",
        deliveryType: "photo",
        nowMs,
      }).status,
    ).toBe("ok");
    expect(
      database.claimImageBotMedia({
        telegramUserId: 779,
        category: "hetero",
        deliveryType: "photo",
        nowMs: nowMs + 1,
      }).status,
    ).toBe("ok");
    expect(
      database.claimImageBotMedia({
        telegramUserId: 779,
        category: "hetero",
        deliveryType: "photo",
        nowMs: nowMs + 2,
      }).status,
    ).toBe("daily_limited");
  });

  it("limita menus repetidos e doze entregas por minuto", () => {
    expect(
      database.allowImageBotInteraction({
        telegramUserId: 999,
        action: "category:hetero",
        cooldownMs: 3_000,
        nowMs: 10_000,
      }),
    ).toBe(true);
    expect(
      database.allowImageBotInteraction({
        telegramUserId: 999,
        action: "category:hetero",
        cooldownMs: 3_000,
        nowMs: 11_000,
      }),
    ).toBe(false);

    for (let index = 0; index < 12; index += 1) {
      expect(
        database.claimImageBotMedia({
          telegramUserId: 888,
          category: "trans",
          deliveryType: "random",
          nowMs: 200_000 + index * 3_001,
        }).status,
      ).toBe("ok");
    }
    expect(
      database.claimImageBotMedia({
        telegramUserId: 888,
        category: "trans",
        deliveryType: "random",
        nowMs: 200_000 + 12 * 3_001,
      }).status,
    ).toBe("rate_limited");
  });

  it("salva a categoria escolhida para o submenu fixo", () => {
    expect(database.getImageBotUserCategory(321)).toBeNull();
    database.setImageBotUserCategory(321, "trans");
    expect(database.getImageBotUserCategory(321)).toBe("trans");
    database.setImageBotUserCategory(321, null);
    expect(database.getImageBotUserCategory(321)).toBeNull();
  });

  it("detecta e preserva o idioma escolhido pelo usuario", () => {
    database.upsertImageBotUser({
      telegramUserId: 330,
      firstName: "Visitor",
      languageCode: "en-US",
      started: true,
    });
    expect(database.getImageBotUserLanguage(330)).toBe("en");

    expect(database.setImageBotUserLanguage(330, "es")).toBe(true);
    database.upsertImageBotUser({
      telegramUserId: 330,
      languageCode: "en-US",
    });

    expect(database.getImageBotUserLanguage(330)).toBe("es");
    expect(database.getImageBotUsers().find((user) => user.telegram_user_id === 330)).toMatchObject(
      {
        language_code: "en-US",
        preferred_language: "es",
      },
    );
  });

  it("lista somente usuarios que ja deram start", () => {
    database.upsertImageBotUser({
      telegramUserId: 10001,
      username: "usuario_start",
      firstName: "Usuário",
      languageCode: "pt-br",
      isTelegramPremium: true,
      telegramProfile: { id: 10001, username: "usuario_start", is_premium: true },
      started: true,
      activityAt: "2026-06-15T10:00:00.000Z",
    });
    database.upsertImageBotUser({
      telegramUserId: 10002,
      username: "sem_start",
      started: false,
      activityAt: "2026-06-15T11:00:00.000Z",
    });
    database.setImageBotUserCategory(10001, "hetero");

    expect(database.getImageBotUsers()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          telegram_user_id: 10001,
          username: "usuario_start",
          first_name: "Usuário",
          selected_category: "hetero",
          language_code: "pt-br",
          is_telegram_premium: true,
          start_count: 1,
        }),
      ]),
    );
    expect(database.getImageBotUsers().some((user) => user.telegram_user_id === 10002)).toBe(false);
  });

  it("promove um usuario do UpMidias a administrador", () => {
    expect(database.isImageBotUserAdmin(10001)).toBe(false);
    expect(database.setImageBotUserAdmin(10001, true)).toBe(true);
    expect(database.isImageBotUserAdmin(10001)).toBe(true);
    expect(
      database.getImageBotUsers().find((user) => user.telegram_user_id === 10001)?.is_admin,
    ).toBe(true);
    expect(database.getImageBotAdminPermission(10001)).toMatchObject({
      telegram_user_id: 10001,
      role: "owner",
      can_delete_media: true,
      can_restore_media: true,
      can_manage_users: true,
      can_manage_settings: true,
      can_view_stats: true,
    });
  });

  it("reutiliza a mensagem do menu Premium por usuario", () => {
    expect(database.getImageBotPremiumMessageId(10001)).toBeNull();
    database.setImageBotPremiumMessageId(10001, 9876);
    expect(database.getImageBotPremiumMessageId(10001)).toBe(9876);
    database.setImageBotPremiumMessageId(10001, null);
    expect(database.getImageBotPremiumMessageId(10001)).toBeNull();
  });

  it("favorita a ultima midia, lista favoritos e exclui a midia", () => {
    const delivery = database.claimImageBotMedia({
      telegramUserId: 10001,
      category: "hetero",
      deliveryType: "photo",
      nowMs: 500_000,
    });
    expect(delivery.status).toBe("ok");
    expect(database.favoriteLastImageBotMedia(10001, "hetero")).toEqual({
      status: "favorited",
    });

    const favorite = database.claimImageBotMedia({
      telegramUserId: 10001,
      category: "hetero",
      deliveryType: "favorite",
      nowMs: 503_001,
    });
    expect(favorite.status).toBe("ok");
    if (favorite.status === "ok") {
      expect(
        database.getImageBotMedia().find((item) => item.id === favorite.media.id),
      ).toMatchObject({ favorite_count: 1 });
      expect(database.deleteImageBotMedia(favorite.media.id)).toBe(true);
      expect(database.getImageBotMedia().some((item) => item.id === favorite.media.id)).toBe(false);
    }
  });

  it("favorita uma midia pelo botao inline e navega nos favoritos", () => {
    const delivered = database.claimImageBotMedia({
      telegramUserId: 10001,
      category: "trans",
      deliveryType: "video",
      nowMs: 600_000,
    });
    expect(delivered.status).toBe("ok");
    if (delivered.status !== "ok") return;

    expect(database.favoriteImageBotMedia(10001, delivered.media.id)).toEqual({
      status: "favorited",
    });
    expect(database.favoriteImageBotMedia(10001, delivered.media.id)).toEqual({
      status: "already_favorited",
    });
    expect(database.removeImageBotFavorite(10001, delivered.media.id)).toEqual({
      status: "removed",
    });
    expect(database.removeImageBotFavorite(10001, delivered.media.id)).toEqual({
      status: "not_favorited",
    });
    database.favoriteImageBotMedia(10001, delivered.media.id);

    const secondDelivery = database.claimImageBotMedia({
      telegramUserId: 10001,
      category: "trans",
      deliveryType: "video",
      nowMs: 603_001,
    });
    expect(secondDelivery.status).toBe("ok");
    if (secondDelivery.status !== "ok") return;
    expect(secondDelivery.media.id).not.toBe(delivered.media.id);
    database.favoriteImageBotMedia(10001, secondDelivery.media.id);

    const first = database.getImageBotFavoritePage({
      telegramUserId: 10001,
      category: "trans",
    });
    expect(first).toMatchObject({ status: "ok", index: 1, total: 2 });
    if (first.status !== "ok") return;

    const next = database.getImageBotFavoritePage({
      telegramUserId: 10001,
      currentMediaId: first.media.id,
      direction: "next",
    });
    expect(next).toMatchObject({ status: "ok", index: 2, total: 2 });
    if (next.status === "ok") expect(next.media.id).not.toBe(first.media.id);
  });

  it("mantem a navegacao de favoritos dentro da categoria atual", () => {
    const hetero = database.claimImageBotMedia({
      telegramUserId: 10001,
      category: "hetero",
      deliveryType: "photo",
      nowMs: 606_002,
    });
    expect(hetero.status).toBe("ok");
    if (hetero.status !== "ok") return;
    database.favoriteImageBotMedia(10001, hetero.media.id);

    const trans = database.getImageBotFavoritePage({
      telegramUserId: 10001,
      category: "trans",
    });
    expect(trans.status).toBe("ok");
    if (trans.status !== "ok") return;

    const next = database.getImageBotFavoritePage({
      telegramUserId: 10001,
      currentMediaId: trans.media.id,
      direction: "next",
    });
    expect(next).toMatchObject({
      status: "ok",
      media: { category: "trans" },
      total: 2,
    });
  });

  it("bloqueia usuarios, aplica o limite global e registra o historico", () => {
    database.upsertImageBotUser({
      telegramUserId: 20001,
      firstName: "Limite",
      started: true,
      activityAt: "2026-06-15T12:00:00.000Z",
    });
    const settings = database.getImageBotSettings();
    database.updateImageBotSettings({
      id: settings.id,
      flood_limit_per_minute: 2,
    });
    expect(database.setImageBotUserDeliveryLimit(20001, 1)).toBe(true);

    expect(
      database.claimImageBotMedia({
        telegramUserId: 20001,
        category: "hetero",
        deliveryType: "photo",
        nowMs: 700_000,
      }).status,
    ).toBe("ok");
    expect(
      database.claimImageBotMedia({
        telegramUserId: 20001,
        category: "hetero",
        deliveryType: "random",
        nowMs: 703_001,
      }).status,
    ).toBe("ok");
    expect(
      database.claimImageBotMedia({
        telegramUserId: 20001,
        category: "hetero",
        deliveryType: "photo",
        nowMs: 706_002,
      }).status,
    ).toBe("rate_limited");

    const details = database.getImageBotUserDetails(20001);
    expect(details?.user).toMatchObject({
      delivery_limit_per_minute: 1,
      media_delivered_count: 2,
      history_count: 2,
      is_blocked: false,
    });
    expect(details?.history).toHaveLength(2);
    expect(details?.activity.filter((item) => item.action === "media_delivered")).toHaveLength(2);
    database.updateImageBotSettings({
      id: settings.id,
      flood_limit_per_minute: settings.flood_limit_per_minute,
    });

    expect(database.setImageBotUserBlocked(20001, true)).toBe(true);
    expect(database.isImageBotUserBlocked(20001)).toBe(true);
    expect(
      database.claimImageBotMedia({
        telegramUserId: 20001,
        category: "hetero",
        deliveryType: "random",
        nowMs: 709_003,
      }),
    ).toEqual({ status: "blocked" });
    expect(database.setImageBotUserBlocked(20001, false)).toBe(true);
  });

  it("aplica o bonus de limite pela validade configurada sem duplicar o pedido", () => {
    const current = database.getImageBotSettings();
    database.updateImageBotSettings({
      id: current.id,
      daily_media_limit: 1,
      flood_cooldown_seconds: 0,
      flood_limit_per_minute: 120,
    });

    const telegramUserId = 30001;
    const nowMs = Date.UTC(2026, 5, 17, 12, 0, 0);
    expect(
      database.claimImageBotMedia({
        telegramUserId,
        category: "hetero",
        deliveryType: "photo",
        nowMs,
      }).status,
    ).toBe("ok");
    expect(
      database.claimImageBotMedia({
        telegramUserId,
        category: "hetero",
        deliveryType: "photo",
        nowMs: nowMs + 1,
      }).status,
    ).toBe("daily_limited");

    const orderId = "33333333-3333-4333-8333-333333333333";
    const nowIso = new Date(nowMs).toISOString();
    database.imageBotSqlite
      .prepare(
        `INSERT INTO limit_payment_orders
         (id, telegram_user_id, amount, bonus_count, status, access_type, access_days,
          created_at, updated_at)
         VALUES (?, ?, 5, 2, 'paid', 'days', 2, ?, ?)`,
      )
      .run(orderId, telegramUserId, nowIso, nowIso);

    const granted = database.grantImageBotDailyLimitBoost({
      telegramUserId,
      orderId,
      bonusCount: 2,
      accessType: "days",
      accessDays: 2,
      now: new Date(nowMs),
    });
    expect(granted.bonusCount).toBe(2);
    expect(granted.expiresAt).toBe(new Date(nowMs + 2 * 86_400_000).toISOString());

    database.grantImageBotDailyLimitBoost({
      telegramUserId,
      orderId,
      bonusCount: 2,
      accessType: "days",
      accessDays: 2,
      now: new Date(nowMs),
    });
    const boosts = database.imageBotSqlite
      .prepare("SELECT COUNT(*) AS total FROM daily_limit_boosts WHERE order_id = ?")
      .get(orderId) as { total: number };
    expect(boosts.total).toBe(1);

    expect(
      database.claimImageBotMedia({
        telegramUserId,
        category: "hetero",
        deliveryType: "photo",
        nowMs: nowMs + 2,
      }).status,
    ).toBe("ok");
    expect(
      database.claimImageBotMedia({
        telegramUserId,
        category: "hetero",
        deliveryType: "photo",
        nowMs: nowMs + 3,
      }).status,
    ).toBe("ok");
    expect(
      database.claimImageBotMedia({
        telegramUserId,
        category: "hetero",
        deliveryType: "photo",
        nowMs: nowMs + 4,
      }).status,
    ).toBe("daily_limited");

    database.updateImageBotSettings({
      id: current.id,
      daily_media_limit: current.daily_media_limit,
      flood_cooldown_seconds: current.flood_cooldown_seconds,
      flood_limit_per_minute: current.flood_limit_per_minute,
    });
  });

  it("nao aplica cooldown, limite por minuto ou limite diario aos administradores", () => {
    const current = database.getImageBotSettings();
    database.updateImageBotSettings({
      id: current.id,
      daily_media_limit: 1,
      flood_cooldown_seconds: 60,
      flood_limit_per_minute: 1,
    });

    const telegramUserId = 40001;
    database.upsertImageBotUser({
      telegramUserId,
      firstName: "Admin sem limites",
      started: true,
    });
    expect(database.setImageBotUserAdmin(telegramUserId, true)).toBe(true);

    const nowMs = Date.UTC(2026, 5, 17, 18, 0, 0);
    expect(
      database.claimImageBotMedia({
        telegramUserId,
        category: "hetero",
        deliveryType: "photo",
        nowMs,
      }).status,
    ).toBe("ok");
    expect(
      database.claimImageBotMedia({
        telegramUserId,
        category: "hetero",
        deliveryType: "photo",
        nowMs,
      }).status,
    ).toBe("ok");
    expect(
      database.claimImageBotMedia({
        telegramUserId,
        category: "hetero",
        deliveryType: "photo",
        nowMs,
      }).status,
    ).toBe("ok");

    expect(
      database.allowImageBotInteraction({
        telegramUserId,
        action: "admin-unlimited-test",
        cooldownMs: 60_000,
        nowMs,
      }),
    ).toBe(true);
    expect(
      database.allowImageBotInteraction({
        telegramUserId,
        action: "admin-unlimited-test",
        cooldownMs: 60_000,
        nowMs,
      }),
    ).toBe(true);

    database.updateImageBotSettings({
      id: current.id,
      daily_media_limit: current.daily_media_limit,
      flood_cooldown_seconds: current.flood_cooldown_seconds,
      flood_limit_per_minute: current.flood_limit_per_minute,
    });
  });

  it("permite conceder e remover Premium manualmente", () => {
    database.upsertImageBotUser({
      telegramUserId: 45099,
      firstName: "Premium manual",
      started: true,
    });
    const plan = database.saveImageBotPremiumPlan({
      name: "Plano manual",
      price: 12,
      accessType: "lifetime",
      accessDays: 1,
      isActive: true,
      actor: "test",
    });

    database.grantImageBotPremiumAccess({
      telegramUserId: 45099,
      planId: plan.id,
      source: "manual",
      actor: "test",
    });
    expect(database.hasActiveImageBotPremiumAccess(45099)).toBe(true);
    expect(database.hasLifetimeImageBotPremiumAccess(45099)).toBe(true);
    expect(
      database.getImageBotUsers().find((user) => user.telegram_user_id === 45099),
    ).toMatchObject({
      is_premium: true,
      has_lifetime_premium_access: true,
      active_premium_access_count: 1,
    });

    expect(database.revokeAllImageBotPremiumAccess(45099, "test")).toBe(true);
    expect(database.hasActiveImageBotPremiumAccess(45099)).toBe(false);
    expect(database.hasLifetimeImageBotPremiumAccess(45099)).toBe(false);
  });

  it("agenda um unico aviso antes do vencimento do Premium", () => {
    const settings = database.getImageBotSettings();
    database.updateImageBotSettings({
      id: settings.id,
      premium_expiry_warning_days: 2,
      premium_expiry_warning_message:
        "{{nome}}, seu plano {{plano}} vence em {{dias}} dias, em {{data}}.",
      premium_expiry_repeat_count: 2,
      premium_expiry_repeat_interval_minutes: 60,
    });
    database.upsertImageBotUser({
      telegramUserId: 45100,
      firstName: "Avisado",
      started: true,
    });
    const plan = database.saveImageBotPremiumPlan({
      name: "Premium aviso",
      price: 10,
      accessType: "days",
      accessDays: 30,
      isActive: true,
    });
    database.grantImageBotPremiumAccess({
      telegramUserId: 45100,
      planId: plan.id,
      source: "manual",
    });

    const now = new Date("2026-06-18T12:00:00.000Z");
    const expiresAt = new Date(now.getTime() + 36 * 60 * 60 * 1000).toISOString();
    database.imageBotSqlite
      .prepare("UPDATE premium_access SET starts_at = ?, expires_at = ? WHERE telegram_user_id = ?")
      .run(new Date(now.getTime() - 60_000).toISOString(), expiresAt, 45100);

    const due = database.getDueImageBotPremiumExpiryReminders(now);
    expect(due).toEqual([
      expect.objectContaining({
        telegram_user_id: 45100,
        plan_name: "Premium aviso",
        expires_at: expiresAt,
      }),
    ]);
    expect(database.markImageBotPremiumExpiryReminderSent(due[0], now)).toBe(true);
    expect(database.getDueImageBotPremiumExpiryReminders(now)).toEqual([]);
    const secondRun = new Date(now.getTime() + 61 * 60_000);
    const repeated = database.getDueImageBotPremiumExpiryReminders(secondRun);
    expect(repeated).toHaveLength(1);
    expect(database.markImageBotPremiumExpiryReminderSent(repeated[0], secondRun)).toBe(true);
    expect(
      database.getDueImageBotPremiumExpiryReminders(new Date(secondRun.getTime() + 61 * 60_000)),
    ).toEqual([]);
  });
});
