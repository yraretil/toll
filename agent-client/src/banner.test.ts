import { describe, expect, it } from "vitest";
import { BANNER, BANNER_WIDTH } from "./banner.js";

describe("BANNER", () => {
  it("fits the centered fixed-width box (wider rows shift when centered)", () => {
    for (const line of BANNER) {
      expect([...line].length).toBeLessThanOrEqual(BANNER_WIDTH);
    }
  });
});
