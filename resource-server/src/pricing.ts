// Per-dataset price schedule (PLAN.md canonical contract).
// Payments in HBAR, asset "0.0.0", amounts in tinybar (1 HBAR = 1e8 tinybar).

export const HBAR_ASSET = "0.0.0";
export const TINYBAR_PER_HBAR = 100_000_000;

export type TollTool = "snapshot" | "history" | "deep-dive" | "price" | "risk-scan";

export interface ToolPrice {
  tool: TollTool;
  amountTinybar: number;
  asset: string;
}

const SCHEDULE: Record<TollTool, number> = {
  // market/snapshot: top-5 markets — 0.002 HBAR
  snapshot: 200_000,
  // market/history: APY + utilization — 0.008 HBAR
  history: 800_000,
  // market/deep-dive: per-market detail — 0.002 HBAR
  "deep-dive": 200_000,
  // price: live USD price via Uniswap V3 — 0.002 HBAR
  price: 200_000,
  // risk-scan: high-utilization / frozen / paused flags — 0.002 HBAR
  "risk-scan": 200_000,
};

const TOOLS: TollTool[] = ["snapshot", "history", "deep-dive", "price", "risk-scan"];

export function isTollTool(tool: string): tool is TollTool {
  return (TOOLS as string[]).includes(tool);
}

export function priceForTool(tool: TollTool): ToolPrice {
  if (!isTollTool(tool)) {
    throw new Error(`unknown tool: ${tool}`);
  }
  return { tool, amountTinybar: SCHEDULE[tool], asset: HBAR_ASSET };
}

export function tinybarToHbar(tinybar: number): number {
  return tinybar / TINYBAR_PER_HBAR;
}
