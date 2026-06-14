import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let database: typeof import("./database.server");
let testDirectory: string;

beforeAll(async () => {
  testDirectory = mkdtempSync(join(tmpdir(), "botvendassl-"));
  vi.stubEnv("DATABASE_PATH", join(testDirectory, "test.sqlite"));
  vi.stubEnv("MEDIA_DIR", join(testDirectory, "media"));
  vi.resetModules();
  database = await import("./database.server");
});

afterAll(() => {
  database.sqlite.close();
  vi.unstubAllEnvs();
  rmSync(testDirectory, { recursive: true, force: true });
});

describe("SQLite local", () => {
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
});
