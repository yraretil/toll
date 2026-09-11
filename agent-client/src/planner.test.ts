// LLM planner (T4.1). Decides which paid datasets to buy next.
// The LLM never signs and never touches money: it outputs strict JSON,
// and a deterministic x402 purchase function executes approved buys.
import { describe, expect, it, vi } from "vitest";
import {
  MAX_PURCHASES,
  parseDecision,
  runPlannerLoop,
  type LlmCall,
  type PurchaseFn,
  type ToolSpec,
} from "./planner.js";

const TOOLS: Record<string, ToolSpec> = {
  snapshot: { path: "/data/snapshot", priceTinybar: 200_000 },
  history: { path: "/data/history?symbol=USDC", priceTinybar: 800_000 },
  "deep-dive": { path: "/data/deep-dive?symbol=USDC", priceTinybar: 200_000 },
};

function llmReturning(outputs: string[]): LlmCall {
  let i = 0;
  return async () => outputs[Math.min(i++, outputs.length - 1)];
}

function mockPurchase(): PurchaseFn & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (tool: string, path: string) => {
    calls.push(tool);
    return { settlement: { success: true }, body: { paid: true, path } };
  }) as PurchaseFn & { calls: string[] };
  fn.calls = calls;
  return fn;
}

describe("parseDecision", () => {
  it("accepts valid JSON", () => {
    expect(parseDecision('{"action":"snapshot","reason":"need top markets"}')).toEqual({
      action: "snapshot",
      reason: "need top markets",
    });
  });

  it("rejects malformed JSON", () => {
    expect(() => parseDecision("not json")).toThrow(/not JSON/);
  });

  it("rejects unknown actions", () => {
    expect(() => parseDecision('{"action":"buy-everything","reason":"x"}')).toThrow(
      /invalid action/,
    );
  });

  it("rejects missing reason", () => {
    expect(() => parseDecision('{"action":"snapshot"}')).toThrow(/reason/);
  });
});

describe("runPlannerLoop", () => {
  it("stops on recommend and reports spend", async () => {
    const purchase = mockPurchase();
    const result = await runPlannerLoop({
      task: "task",
      budgetTinybar: 2_000_000,
      tools: TOOLS,
      llmCall: llmReturning([
        '{"action":"snapshot","reason":"first look"}',
        '{"action":"recommend","reason":"USDC at 3.5%"}',
      ]),
      purchase,
    });
    expect(purchase.calls).toEqual(["snapshot"]);
    expect(result.totalSpentTinybar).toBe(200_000);
    expect(result.answer).toContain("USDC at 3.5%");
    expect(result.stopped).toBeNull();
  });

  it("caps purchases at MAX_PURCHASES", async () => {
    const purchase = mockPurchase();
    const result = await runPlannerLoop({
      task: "task",
      budgetTinybar: 100_000_000,
      tools: TOOLS,
      llmCall: llmReturning(['{"action":"snapshot","reason":"more"}']),
      purchase,
    });
    expect(purchase.calls.length).toBe(MAX_PURCHASES);
    expect(result.stopped).toMatch(/purchase cap/);
  });

  it("refuses purchases that exceed budget", async () => {
    const purchase = mockPurchase();
    const result = await runPlannerLoop({
      task: "task",
      budgetTinybar: 100_000,
      tools: TOOLS,
      llmCall: llmReturning(['{"action":"history","reason":"want it"}']),
      purchase,
    });
    expect(purchase.calls).toEqual([]);
    expect(result.totalSpentTinybar).toBe(0);
    expect(result.stopped).toMatch(/budget/);
  });

  it("stops after repeated malformed LLM output without spending", async () => {
    const purchase = mockPurchase();
    const result = await runPlannerLoop({
      task: "task",
      budgetTinybar: 2_000_000,
      tools: TOOLS,
      llmCall: llmReturning(["garbage", "still garbage", "garbage"]),
      purchase,
    });
    expect(purchase.calls).toEqual([]);
    expect(result.stopped).toMatch(/malformed/);
  });

  it("stops without spending when the tool is not offered", async () => {
    const purchase = mockPurchase();
    const { "deep-dive": _dropped, ...offered } = TOOLS;
    const result = await runPlannerLoop({
      task: "task",
      budgetTinybar: 2_000_000,
      tools: offered,
      llmCall: llmReturning(['{"action":"deep-dive","reason":"want detail"}']),
      purchase,
    });
    expect(purchase.calls).toEqual([]);
    expect(result.totalSpentTinybar).toBe(0);
    expect(result.stopped).toMatch(/not offered/);
  });
});
