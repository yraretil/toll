// Live Aave V3 (Ethereum mainnet) subgraph queries via The Graph gateway.
// Endpoint: https://gateway.thegraph.com/api/<GRAPH_API_KEY>/subgraphs/id/<AAVE_V3_SUBGRAPH_ID>
// Canonical subgraph: Cd2gEDVeqnjBn1hSeqFMitw8Q1iiyV9FYUZkLNRcL87g (aave/protocol-subgraphs).

const GRAPH_API_KEY = process.env.GRAPH_API_KEY ?? "";
const SUBGRAPH_ID =
  process.env.AAVE_V3_SUBGRAPH_ID ??
  "Cd2gEDVeqnjBn1hSeqFMitw8Q1iiyV9FYUZkLNRcL87g";
// Canonical Uniswap V3 (Ethereum mainnet) subgraph (Uniswap docs).
const UNISWAP_V3_SUBGRAPH_ID =
  process.env.UNISWAP_V3_SUBGRAPH_ID ??
  "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV";

function endpointFor(subgraphId: string): string {
  if (!GRAPH_API_KEY) throw new Error("GRAPH_API_KEY must be set in .env");
  return `https://gateway.thegraph.com/api/${GRAPH_API_KEY}/subgraphs/id/${subgraphId}`;
}

function endpoint(): string {
  return endpointFor(SUBGRAPH_ID);
}

async function graphQuery<T>(query: string, subgraphId: string = SUBGRAPH_ID): Promise<T> {
  const res = await fetch(endpointFor(subgraphId), {
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

/** Uniswap derivedETH × bundle ethPriceUSD → token USD price. */
export function ethPriceToUsd(derivedEth: string, ethPriceUsd: string): number {
  return Number(derivedEth) * Number(ethPriceUsd);
}

/** Mainnet token addresses for the price tool. */
const TOKEN_ADDRESSES: Record<string, string> = {
  USDC: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
};

export interface TokenPrice {
  symbol: string;
  priceUsd: number;
  ethPriceUsd: number;
}

/** Live USD price for a stablecoin via Uniswap V3 (price tool). */
export async function queryTokenPriceUsd(symbol: string): Promise<TokenPrice> {
  const address = TOKEN_ADDRESSES[symbol.toUpperCase()];
  if (!address) throw new Error(`no price feed for symbol: ${symbol}`);
  const data = await graphQuery<{
    token: { symbol: string; derivedETH: string } | null;
    bundles: { ethPriceUSD: string }[];
  }>(
    `{
      token(id: "${address.toLowerCase()}") { symbol derivedETH }
      bundles { ethPriceUSD }
    }`,
    UNISWAP_V3_SUBGRAPH_ID,
  );
  if (!data.token || data.bundles.length === 0) {
    throw new Error(`no price data for symbol: ${symbol}`);
  }
  return {
    symbol: data.token.symbol,
    priceUsd: ethPriceToUsd(data.token.derivedETH, data.bundles[0].ethPriceUSD),
    ethPriceUsd: Number(data.bundles[0].ethPriceUSD),
  };
}

export interface MarketSnapshot {
  symbol: string;
  name: string;
  supplyApyPct: number;
  variableBorrowApyPct: number;
  totalLiquidity: number;
  availableLiquidity: number;
  utilizationPct: number;
}

interface ReserveRow {
  symbol: string;
  name: string;
  decimals: number;
  liquidityRate: string;
  variableBorrowRate: string;
  totalLiquidity: string;
  availableLiquidity: string;
  utilizationRate: string;
}

/** Top-N markets by total liquidity (snapshot tool). */
export async function queryMarkets(topN: number): Promise<MarketSnapshot[]> {
  const data = await graphQuery<{ reserves: ReserveRow[] }>(`{
    reserves(first: ${topN}, orderBy: totalLiquidity, orderDirection: desc, where: {isActive: true}) {
      symbol name decimals liquidityRate variableBorrowRate
      totalLiquidity availableLiquidity utilizationRate
    }
  }`);
  return data.reserves.map((r) => ({
    symbol: r.symbol,
    name: r.name,
    supplyApyPct: rayToPct(r.liquidityRate),
    variableBorrowApyPct: rayToPct(r.variableBorrowRate),
    totalLiquidity: scaledAmount(r.totalLiquidity, r.decimals),
    availableLiquidity: scaledAmount(r.availableLiquidity, r.decimals),
    utilizationPct: Number(r.utilizationRate) * 100,
  }));
}

export interface HistoryPoint {
  timestamp: number;
  supplyApyPct: number;
  variableBorrowApyPct: number;
  utilizationPct: number;
}

/** APY + utilization history for one reserve (history tool). */
export async function queryHistory(symbol: string, points = 25): Promise<HistoryPoint[]> {
  const data = await graphQuery<{
    reserveParamsHistoryItems: {
      liquidityRate: string;
      variableBorrowRate: string;
      utilizationRate: string;
      timestamp: number;
    }[];
  }>(`{
    reserveParamsHistoryItems(first: ${points}, orderBy: timestamp, orderDirection: desc, where: {reserve_: {symbol: "${symbol}"}}) {
      liquidityRate variableBorrowRate utilizationRate timestamp
    }
  }`);
  return data.reserveParamsHistoryItems.map((h) => ({
    timestamp: h.timestamp,
    supplyApyPct: rayToPct(h.liquidityRate),
    variableBorrowApyPct: rayToPct(h.variableBorrowRate),
    utilizationPct: Number(h.utilizationRate) * 100,
  }));
}

export interface MarketDetail extends MarketSnapshot {
  underlyingAsset: string;
  stableBorrowApyPct: number;
  /** Raw on-chain risk parameters (units vary — displayed as-is). */
  borrowCap: string;
  supplyCap: string;
  reserveFactor: string;
  liquidationThreshold: string;
  liquidationBonus: string;
  isActive: boolean;
  isFrozen: boolean;
}

/** Per-market full detail (deep-dive tool). */
export async function queryMarketDetail(symbol: string): Promise<MarketDetail> {
  const data = await graphQuery<{
    reserves: (ReserveRow & {
      underlyingAsset: string;
      stableBorrowRate: string;
      borrowCap: string;
      supplyCap: string;
      reserveFactor: string;
      reserveLiquidationThreshold: string;
      reserveLiquidationBonus: string;
      isActive: boolean;
      isFrozen: boolean;
    })[];
  }>(`{
    reserves(where: {symbol: "${symbol}"}) {
      symbol name decimals underlyingAsset liquidityRate utilizationRate
      totalLiquidity availableLiquidity variableBorrowRate stableBorrowRate
      borrowCap supplyCap reserveFactor
      reserveLiquidationThreshold reserveLiquidationBonus
      isActive isFrozen
    }
  }`);
  const r = data.reserves[0];
  if (!r) throw new Error(`unknown market: ${symbol}`);
  return {
    symbol: r.symbol,
    name: r.name,
    supplyApyPct: rayToPct(r.liquidityRate),
    variableBorrowApyPct: rayToPct(r.variableBorrowRate),
    totalLiquidity: scaledAmount(r.totalLiquidity, r.decimals),
    availableLiquidity: scaledAmount(r.availableLiquidity, r.decimals),
    utilizationPct: Number(r.utilizationRate) * 100,
    underlyingAsset: r.underlyingAsset,
    stableBorrowApyPct: rayToPct(r.stableBorrowRate),
    borrowCap: r.borrowCap,
    supplyCap: r.supplyCap,
    reserveFactor: r.reserveFactor,
    liquidationThreshold: r.reserveLiquidationThreshold,
    liquidationBonus: r.reserveLiquidationBonus,
    isActive: r.isActive,
    isFrozen: r.isFrozen,
  };
}
