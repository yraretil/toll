import { describe, expect, it } from "vitest";
import { ethPriceToUsd, rayToPct, scaledAmount } from "./subgraph.js";

describe("rayToPct", () => {
  it("converts ray (1e27 = 100%) to percent", () => {
    // ~3.55% USDC supply APY observed live
    expect(rayToPct("35508902062211465511490969")).toBeCloseTo(3.5509, 3);
    expect(rayToPct("0")).toBe(0);
  });
});

describe("scaledAmount", () => {
  it("scales raw amounts by token decimals", () => {
    expect(scaledAmount("1977317191267167", 6)).toBeCloseTo(1977317191.267167, 6);
    expect(scaledAmount("595041602196232513775661746", 18)).toBeCloseTo(595041602.196, 3);
  });
});

describe("ethPriceToUsd", () => {
  it("multiplies derivedETH by bundle ETH price (live USDC numbers ≈ $1.00)", () => {
    expect(
      ethPriceToUsd("0.0003975879180436403891329243642117857", "2515.166972177049742743727946207856"),
    ).toBeCloseTo(1.0, 2);
  });
});
