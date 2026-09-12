import { describe, expect, it } from "vitest";
import { fmtCompact, hashscanUrl, tinybarToHbar } from "./identity.js";

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

describe("fmtCompact", () => {
  it("compacts billions/millions/thousands", () => {
    expect(fmtCompact(1_979_949_054)).toBe("1.98B");
    expect(fmtCompact(169_400_653)).toBe("169.40M");
    expect(fmtCompact(2500)).toBe("2.5K");
    expect(fmtCompact(600_000)).toBe("600K");
    expect(fmtCompact(2_000_000)).toBe("2M");
    expect(fmtCompact(91.43)).toBe("91.43");
  });
});
