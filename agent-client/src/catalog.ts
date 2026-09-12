// Shared purchasable catalog (index.ts + TUI). Prices mirror the server
// schedule in resource-server/src/pricing.ts (server is source of truth).
import type { ToolSpec } from "./planner.js";

export const DEFAULT_TASK = "Which stablecoin — USDC, DAI or USDT — has the best lending opportunity on Aave V3?";

export const LEGACY_TASK = "Find the best USDC lending opportunity on Aave V3.";

export const TOOLS: Record<string, ToolSpec> = {
  snapshot: { path: "/data/snapshot", priceTinybar: 200_000 },
  history: { path: "/data/history?symbol={symbol}", priceTinybar: 800_000, defaultSymbol: "USDC" },
  "deep-dive": { path: "/data/deep-dive?symbol={symbol}", priceTinybar: 200_000, defaultSymbol: "USDC" },
};
