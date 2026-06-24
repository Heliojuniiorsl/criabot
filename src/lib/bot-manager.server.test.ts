import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let database: typeof import("./database.server");
let manager: typeof import("./bot-manager.server");
let salesBotRegistry: typeof import("./sales-bot-registry.server");
let testDirectory: string;
let fetchMock: ReturnType<typeof vi.fn>;

function telegramResponse(result: unknown) {
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeAll(async () => {
  testDirectory = mkdtempSync(join(tmpdir(), "bot-manager-"));
  vi.stubEnv("DATABASE_PATH", join(testDirectory, "test.sqlite"));
  vi.stubEnv("MEDIA_DIR", join(testDirectory, "media"));
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:sales-token");
  vi.stubEnv("DANI_MILLER_BOT_TOKEN", "");
  vi.stubEnv("IMAGE_BOT_TOKEN", "");
  vi.stubEnv("PUBLIC_BASE_URL", "https://bot.example.com");
  vi.resetModules();
  database = await import("./database.server");
  salesBotRegistry = await import("./sales-bot-registry.server");
  manager = await import("./bot-manager.server");
});

beforeEach(() => {
  fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://bot.example.com") {
      return new Response("", { status: 200 });
    }
    if (url.endsWith("/getMe")) {
      if (url.includes("777777:dani-token")) {
        return telegramResponse({
          id: 777777,
          first_name: "Dani Miller",
          username: "danimiller_bot",
        });
      }
      return telegramResponse({ id: 123456, first_name: "Bot Vendas", username: "vendas_bot" });
    }
    if (url.endsWith("/getWebhookInfo")) {
      if (url.includes("654321:image-token")) {
        return telegramResponse({
          url: "https://bot.example.com/api/public/telegram/image-webhook",
          pending_update_count: 0,
        });
      }
      return telegramResponse({
        url: "https://bot.example.com/api/public/telegram/webhook",
        pending_update_count: 2,
      });
    }
    if (url.endsWith("/getUserProfilePhotos")) {
      return telegramResponse({ total_count: 0, photos: [] });
    }
    if (
      url.endsWith("/deleteWebhook") ||
      url.endsWith("/setWebhook") ||
      url.endsWith("/setMyCommands") ||
      url.endsWith("/setChatMenuButton")
    ) {
      return telegramResponse(true);
    }
    throw new Error(`Chamada inesperada: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterAll(() => {
  database.sqlite.close();
  salesBotRegistry.closeSalesBotRegistry();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(testDirectory, { recursive: true, force: true });
});

describe("gerenciador de bots", () => {
  it("consulta identidade, foto e status sem misturar os dois bots", async () => {
    const bots = await manager.listManagedBots();

    expect(bots).toHaveLength(2);
    expect(bots[0]).toMatchObject({
      key: "sales",
      display_name: "Bot Vendas",
      telegram_name: "Bot Vendas",
      username: "vendas_bot",
      panel_path: "/vendas_bot/dashboard",
      status: "online",
      pending_updates: 2,
    });
    expect(bots[1]).toMatchObject({
      key: "images",
      display_name: "Bot de imagens",
      configured: false,
      status: "not_configured",
    });
  });

  it("reinicia removendo e registrando novamente o webhook correto", async () => {
    await manager.controlManagedBot("sales", "restart");

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/deleteWebhook");
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://bot.example.com");
    expect(String(fetchMock.mock.calls[2][0])).toContain("/setWebhook");
    expect(String(fetchMock.mock.calls[3][0])).toContain("/setMyCommands");
    expect(String(fetchMock.mock.calls[4][0])).toContain("/setChatMenuButton");
    expect(String(fetchMock.mock.calls[5][0])).toContain("/getWebhookInfo");
    const body = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(body.url).toBe("https://bot.example.com/api/public/telegram/webhook");
    expect(body.allowed_updates).toEqual([
      "message",
      "channel_post",
      "callback_query",
      "my_chat_member",
      "chat_join_request",
    ]);
    const commandsBody = JSON.parse(String(fetchMock.mock.calls[3][1]?.body));
    expect(commandsBody.commands.map((command: any) => command.command)).toEqual([
      "start",
      "planos",
      "ofertas",
      "meus_acessos",
      "suporte",
      "termos",
    ]);
    const menuBody = JSON.parse(String(fetchMock.mock.calls[4][1]?.body));
    expect(menuBody.menu_button.type).toBe("commands");
  });

  it("registra eventos de grupo no webhook do bot de imagens", async () => {
    vi.stubEnv("IMAGE_BOT_TOKEN", "654321:image-token");

    await manager.controlManagedBot("images", "restart");

    const body = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(body.url).toBe("https://bot.example.com/api/public/telegram/image-webhook");
    expect(body.allowed_updates).toEqual(["message", "callback_query", "my_chat_member"]);
    const commandsBody = JSON.parse(String(fetchMock.mock.calls[3][1]?.body));
    expect(commandsBody.commands.map((command: any) => command.command)).toEqual([
      "start",
      "videos",
      "favoritos",
      "premium",
      "idioma",
    ]);
  });

  it("mostra o Dani Miller quando o token proprio esta configurado", async () => {
    vi.stubEnv("DANI_MILLER_BOT_TOKEN", "777777:dani-token");

    const bots = await manager.listManagedBots();

    expect(bots).toContainEqual(
      expect.objectContaining({
        key: "sales-clone:danimiller-bot",
        kind: "sales",
        is_clone: true,
        display_name: "Dani Miller",
        username: "danimiller_bot",
        panel_path: "/danimiller_bot/dashboard",
        status: "online",
      }),
    );
  });
});
