import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { validateMercadoPagoSignature } from "./mercado-pago.server";

describe("validateMercadoPagoSignature", () => {
  it("accepts an authentic, recent notification", () => {
    const secret = "webhook-secret";
    const dataId = "123456";
    const requestId = "request-abc";
    const now = Date.now();
    const ts = String(now);
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const signature = createHmac("sha256", secret).update(manifest).digest("hex");

    expect(
      validateMercadoPagoSignature({
        dataId,
        requestId,
        signature: `ts=${ts},v1=${signature}`,
        secret,
        now,
      }),
    ).toBe(true);
  });

  it("rejects stale or modified notifications", () => {
    const now = Date.now();
    expect(
      validateMercadoPagoSignature({
        dataId: "123",
        requestId: "request",
        signature: `ts=${now - 11 * 60_000},v1=invalid`,
        secret: "secret",
        now,
      }),
    ).toBe(false);
  });
});
