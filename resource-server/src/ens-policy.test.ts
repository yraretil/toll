import { describe, expect, it } from "vitest";
import { payerFromPaymentHeader, paymentHeaderFrom } from "./ens-policy.js";

function reqWith(headers: Record<string, string>) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { header: (name: string) => lower[name.toLowerCase()] };
}

describe("paymentHeaderFrom", () => {
  it("prefers PAYMENT-SIGNATURE (x402 v2)", () => {
    expect(
      paymentHeaderFrom(reqWith({ "PAYMENT-SIGNATURE": "v2", "X-PAYMENT": "v1" })),
    ).toBe("v2");
  });

  it("falls back to X-PAYMENT (x402 v1)", () => {
    expect(paymentHeaderFrom(reqWith({ "X-PAYMENT": "v1" }))).toBe("v1");
  });

  it("returns null when both headers are missing (must not recurse)", () => {
    expect(paymentHeaderFrom(reqWith({}))).toBeNull();
  });
});

describe("payerFromPaymentHeader", () => {
  it("returns null for missing/garbage headers", () => {
    expect(payerFromPaymentHeader(null)).toBeNull();
    expect(payerFromPaymentHeader(undefined)).toBeNull();
    expect(payerFromPaymentHeader("not-base64-json")).toBeNull();
  });
});
