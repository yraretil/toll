// Live Aave V3 (Ethereum mainnet) subgraph queries via The Graph gateway.
// Endpoint: https://gateway.thegraph.com/api/<GRAPH_API_KEY>/subgraphs/id/<AAVE_V3_SUBGRAPH_ID>
// Canonical subgraph: Cd2gEDVeqnjBn1hSeqFMitw8Q1iiyV9FYUZkLNRcL87g (aave/protocol-subgraphs).

const GRAPH_API_KEY = process.env.GRAPH_API_KEY ?? "";
const SUBGRAPH_ID =
  process.env.AAVE_V3_SUBGRAPH_ID ??
  "Cd2gEDVeqnjBn1hSeqFMitw8Q1iiyV9FYUZkLNRcL87g";

function endpoint(): string {
  if (!GRAPH_API_KEY) throw new Error("GRAPH_API_KEY must be set in .env");
  return `https://gateway.thegraph.com/api/${GRAPH_API_KEY}/subgraphs/id/${SUBGRAPH_ID}`;
}

async function graphQuery<T>(query: string): Promise<T> {
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) {
    throw new Error(`subgraph query failed: ${body.errors[0].message}`);
  }
  if (!body.data) throw new Error("subgraph query returned no data");
  return body.data;
}

/** Aave rates are ray (1e27 = 100%). Divide by 1e25 → percent. */
export function rayToPct(ray: string): number {
  return Number(ray) / 1e25;
}

/** Raw token amount → human units via the reserve's decimals. */
export function scaledAmount(raw: string, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

export interface MarketSnapshot {
  symbol: string;
  name: string;
  supplyApyPct: number;
  totalLiquidity: number;
  utilizationPct: number;
}

interface ReserveRow {
  symbol: string;
  name: string;
  decimals: number;
  liquidityRate: string;
  totalLiquidity: string;
  utilizationRate: string;
}

/** Top-N markets by total liquidity (snapshot tool). */
export async function queryMarkets(topN: number): Promise<MarketSnapshot[]> {
  const data = await graphQuery<{ reserves: ReserveRow[] }>(`{
    reserves(first: ${topN}, orderBy: totalLiquidity, orderDirection: desc, where: {isActive: true}) {
      symbol name decimals liquidityRate totalLiquidity utilizationRate
    }
  }`);
  return data.reserves.map((r) => ({
    symbol: r.symbol,
    name: r.name,
    supplyApyPct: rayToPct(r.liquidityRate),
    totalLiquidity: scaledAmount(r.totalLiquidity, r.decimals),
    utilizationPct: Number(r.utilizationRate) * 100,
  }));
}

export interface HistoryPoint {
  timestamp: number;
  supplyApyPct: number;
  utilizationPct: number;
}

/** APY + utilization history for one reserve (history tool). */
export async function queryHistory(symbol: string, points = 25): Promise<HistoryPoint[]> {
  const data = await graphQuery<{
    reserveParamsHistoryItems: { liquidityRate: string; utilizationRate: string; timestamp: number }[];
  }>(`{
    reserveParamsHistoryItems(first: ${points}, orderBy: timestamp, orderDirection: desc, where: {reserve_: {symbol: "${symbol}"}}) {
      liquidityRate utilizationRate timestamp
    }
  }`);
  return data.reserveParamsHistoryItems.map((h) => ({
    timestamp: h.timestamp,
    supplyApyPct: rayToPct(h.liquidityRate),
    utilizationPct: Number(h.utilizationRate) * 100,
  }));
}

export interface MarketDetail extends MarketSnapshot {
  underlyingAsset: string;
  availableLiquidity: number;
  variableBorrowApyPct: number;
  stableBorrowApyPct: number;
  isActive: boolean;
  isFrozen: boolean;
}

/** Per-market full detail (deep-dive tool). */
export async function queryMarketDetail(symbol: string): Promise<MarketDetail> {
  const data = await graphQuery<{
    reserves: (ReserveRow & {
      underlyingAsset: string;
      availableLiquidity: string;
      variableBorrowRate: string;
      stableBorrowRate: string;
      isActive: boolean;
      isFrozen: boolean;
    })[];
  }>(`{
    reserves(where: {symbol: "${symbol}"}) {
      symbol name decimals underlyingAsset liquidityRate utilizationRate
      totalLiquidity availableLiquidity variableBorrowRate stableBorrowRate
      isActive isFrozen
    }
  }`);
  const r = data.reserves[0];
  if (!r) throw new Error(`unknown market: ${symbol}`);
  return {
    symbol: r.symbol,
    name: r.name,
    supplyApyPct: rayToPct(r.liquidityRate),
    totalLiquidity: scaledAmount(r.totalLiquidity, r.decimals),
    utilizationPct: Number(r.utilizationRate) * 100,
    underlyingAsset: r.underlyingAsset,
    availableLiquidity: scaledAmount(r.availableLiquidity, r.decimals),
    variableBorrowApyPct: rayToPct(r.variableBorrowRate),
    stableBorrowApyPct: rayToPct(r.stableBorrowRate),
    isActive: r.isActive,
    isFrozen: r.isFrozen,
  };
}
