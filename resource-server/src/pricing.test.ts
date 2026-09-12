import { describe, expect, it } from "vitest";
import { HBAR_ASSET, priceForTool, tinybarToHbar } from "./pricing.js";

describe("price schedule", () => {
  it("prices snapshot at 0.002 HBAR (200_000 tinybar)", () => {
    expect(priceForTool("snapshot")).toEqual({
      tool: "snapshot",
      amountTinybar: 200_000,
      asset: HBAR_ASSET,
    });
  });

  it("prices history at 0.008 HBAR (800_000 tinybar)", () => {
    expect(priceForTool("history").amountTinybar).toBe(800_000);
  });

  it("prices deep-dive at 0.002 HBAR (200_000 tinybar)", () => {
    expect(priceForTool("deep-dive").amountTinybar).toBe(200_000);
  });

  it("prices price at 0.002 HBAR (200_000 tinybar)", () => {
    expect(priceForTool("price").amountTinybar).toBe(200_000);
  });

  it("rejects unknown tools", () => {
    // @ts-expect-error intentional: unknown tool must throw
    expect(() => priceForTool("everything")).toThrow(/unknown tool/);
  });

  it("converts tinybar to HBAR", () => {
    expect(tinybarToHbar(200_000)).toBeCloseTo(0.002);
  });
});
