import { describe, expect, it } from "vitest";
import { hashscanUrl, tinybarToHbar } from "./identity.js";

describe("hashscanUrl", () => {
  it("converts 0.0.x@sss.nnn to the HashScan dash form", () => {
    expect(hashscanUrl("0.0.7162784@1789167050.968771317")).toBe(
      "https://hashscan.io/testnet/transaction/0.0.7162784-1789167050-968771317",
    );
  });
});

describe("tinybarToHbar", () => {
  it("formats HBAR with 6 decimals", () => {
    expect(tinybarToHbar(400_000)).toBe("0.004000");
  });
});
