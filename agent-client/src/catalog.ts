// Shared purchasable catalog (index.ts + TUI). Prices mirror the server
// schedule in resource-server/src/pricing.ts (server is source of truth).
import type { ToolSpec } from "./planner.js";

export const DEFAULT_TASK = "Which stablecoin — USDC, DAI or USDT — has the best lending opportunity on Aave V3?";

export const LEGACY_TASK = "Find the best USDC lending opportunity on Aave V3.";

export const TOOLS: Record<string, ToolSpec> = {
  snapshot: { path: "/data/snapshot", priceTinybar: 200_000 },
  history: { path: "/data/history?symbol={symbol}", priceTinybar: 800_000, defaultSymbol: "USDC" },
  "deep-dive": { path: "/data/deep-dive?symbol={symbol}", priceTinybar: 200_000, defaultSymbol: "USDC" },
  price: { path: "/data/price?symbol={symbol}", priceTinybar: 200_000, defaultSymbol: "USDC" },
  "risk-scan": { path: "/data/risk-scan", priceTinybar: 200_000 },
  "whale-watch": { path: "/data/whales?symbol={symbol}", priceTinybar: 200_000, defaultSymbol: "USDC" },
};

/** Human blurbs for the TUI tools panel (display only — planner never sees these). */
export const TOOL_BLURBS: Record<string, string> = {
  snapshot: "top-5 Aave V3 markets — supply/borrow APY, liquidity, utilization",
  history: "25-point APY/borrow/utilization series per stablecoin",
  "deep-dive": "full per-market detail — caps, reserve factor, liquidation params",
  price: "live USD price per stablecoin via Uniswap V3",
  "risk-scan": "flags markets over 85% utilization, frozen or paused",
  "whale-watch": "top suppliers per market with approx supplied",
};
