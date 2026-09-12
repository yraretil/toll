import "dotenv/config";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { priceForTool, type TollTool } from "./pricing.js";
import { queryHistory, queryMarketDetail, queryMarkets, queryRiskScan, queryTokenPriceUsd, queryWhales } from "./subgraph.js";
import { enforcePolicy, paymentHeaderFrom, spendStatus } from "./ens-policy.js";
import type { PolicyDecision } from "./ens-policy.js";

const PORT = Number(process.env.PORT ?? 4021);
// Verified T0.4: testnet base has NO /v1 suffix. Routes: /supported, /verify, /settle.
const FACILITATOR_URL =
  process.env.FACILITATOR_URL ?? "https://api.testnet.blocky402.com";
const NETWORK = "hedera:testnet";
// Set via T1.1 (scripts/create-payto-account.ts). Placeholder fails closed.
const PAY_TO = process.env.PAY_TO_ACCOUNT ?? "0.0.0";

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  "hedera:*",
  new ExactHederaScheme(),
);

function acceptsFor(tool: TollTool) {
  const price = priceForTool(tool);
  return {
    scheme: "exact",
    price: { amount: String(price.amountTinybar), asset: price.asset },
    network: NETWORK,
    payTo: PAY_TO,
  } as const;
}

const app = express();

// Raw-terminal proof log: every /data hit, before the paywall sees it.
app.use("/data", (req, _res, next) => {
  const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  // eslint-disable-next-line no-console
  console.log(
    `→ ${req.method} ${req.baseUrl}${req.path}${query} ${req.header("PAYMENT-SIGNATURE") || req.header("X-PAYMENT") ? "(paid retry)" : "(quote)"}`,
  );
  next();
});

function slog(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(...args);
}

/** Enforce + log. Returns the decision, or null after sending the 402. */
async function checkPolicy(
  req: { header: (name: string) => string | undefined },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
  },
  tool: TollTool,
): Promise<PolicyDecision | null> {
  const price = priceForTool(tool);
  const decision = await enforcePolicy(tool, price.amountTinybar, paymentHeaderFrom(req));
  if (!decision.ok) {
    slog(
      `✕ ${tool} ${price.amountTinybar} tinybar payer=${decision.payerAccount ?? "?"} rejected: ${decision.reason}`,
    );
    res.status(402).json({
      error: "payment rejected — ENS policy exceeded",
      reason: decision.reason,
      policy: decision.policy,
      requestedTinybar: decision.requestedTinybar,
    });
    return null;
  }
  slog(
    `✓ ${tool} ${price.amountTinybar} tinybar payer=${decision.payerAccount} ` +
      `identity=${decision.policy?.name} day=${decision.daySpentTinybar}/${decision.policy?.dailyCapTinybar}`,
  );
  return decision;
}

app.use(
  paymentMiddleware(
    {
      "GET /data/ping": {
        accepts: acceptsFor("snapshot"),
        description: "Toll smoke endpoint (Phase 1 deterministic e2e)",
      },
      "GET /data/snapshot": {
        accepts: acceptsFor("snapshot"),
        description: "Top-5 Aave V3 markets (paid via x402)",
      },
      "GET /data/history": {
        accepts: acceptsFor("history"),
        description: "APY + utilization history for one market (paid via x402)",
      },
      "GET /data/deep-dive": {
        accepts: acceptsFor("deep-dive"),
        description: "Per-market full detail (paid via x402)",
      },
      "GET /data/price": {
        accepts: acceptsFor("price"),
        description: "Live USD price via Uniswap V3 (paid via x402)",
      },
      "GET /data/risk-scan": {
        accepts: acceptsFor("risk-scan"),
        description: "High-utilization / frozen / paused flags (paid via x402)",
      },
      "GET /data/whales": {
        accepts: acceptsFor("whale-watch"),
        description: "Top suppliers per market (paid via x402)",
      },
    },
    resourceServer,
  ),
);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Unpaid: live cap + today's spend for a payer (powers the TUI budget card).
app.get("/status", async (req, res) => {
  try {
    const payer = String(req.query.payer ?? "");
    if (!payer) {
      res.status(400).json({ error: "missing ?payer=0.0.x" });
      return;
    }
    res.json(await spendStatus(payer));
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

app.get("/data/ping", async (req, res) => {
  const decision = await checkPolicy(req, res, "snapshot");
  if (!decision) return;
  res.json({ paid: true, data: "pong", identity: { name: decision.policy?.name, match: true } });
});

app.get("/data/snapshot", async (req, res) => {
  const decision = await checkPolicy(req, res, "snapshot");
  if (!decision) return;
  try {
    const markets = await queryMarkets(5);
    res.json({
      paid: true,
      markets,
      identity: { name: decision.policy?.name, match: true },
    });
  } catch (err) {
    res.status(502).json({ paid: true, error: String(err) });
  }
});

app.get("/data/history", async (req, res) => {
  const decision = await checkPolicy(req, res, "history");
  if (!decision) return;
  try {
    const symbol = String(req.query.symbol ?? "USDC");
    const history = await queryHistory(symbol);
    res.json({
      paid: true,
      symbol,
      history,
      identity: { name: decision.policy?.name, match: true },
    });
  } catch (err) {
    res.status(502).json({ paid: true, error: String(err) });
  }
});

app.get("/data/deep-dive", async (req, res) => {
  const decision = await checkPolicy(req, res, "deep-dive");
  if (!decision) return;
  try {
    const symbol = String(req.query.symbol ?? "USDC");
    const market = await queryMarketDetail(symbol);
    res.json({
      paid: true,
      market,
      identity: { name: decision.policy?.name, match: true },
    });
  } catch (err) {
    res.status(502).json({ paid: true, error: String(err) });
  }
});

app.get("/data/price", async (req, res) => {
  const decision = await checkPolicy(req, res, "price");
  if (!decision) return;
  try {
    const symbol = String(req.query.symbol ?? "USDC");
    const price = await queryTokenPriceUsd(symbol);
    res.json({
      paid: true,
      price,
      identity: { name: decision.policy?.name, match: true },
    });
  } catch (err) {
    res.status(502).json({ paid: true, error: String(err) });
  }
});

app.get("/data/risk-scan", async (req, res) => {
  const decision = await checkPolicy(req, res, "risk-scan");
  if (!decision) return;
  try {
    const risks = await queryRiskScan();
    res.json({
      paid: true,
      risks,
      identity: { name: decision.policy?.name, match: true },
    });
  } catch (err) {
    res.status(502).json({ paid: true, error: String(err) });
  }
});

app.get("/data/whales", async (req, res) => {
  const decision = await checkPolicy(req, res, "whale-watch");
  if (!decision) return;
  try {
    const symbol = String(req.query.symbol ?? "USDC");
    const whales = await queryWhales(symbol);
    res.json({
      paid: true,
      symbol: symbol.toUpperCase(),
      whales,
      identity: { name: decision.policy?.name, match: true },
    });
  } catch (err) {
    res.status(502).json({ paid: true, error: String(err) });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Toll resource server listening on http://localhost:${PORT}`);
});
