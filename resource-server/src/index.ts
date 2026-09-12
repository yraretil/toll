import "dotenv/config";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { priceForTool, type TollTool } from "./pricing.js";
import { queryHistory, queryMarketDetail, queryMarkets } from "./subgraph.js";
import { enforcePolicy, paymentHeaderFrom } from "./ens-policy.js";

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

const snapshot = priceForTool("snapshot");

const app = express();

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
    },
    resourceServer,
  ),
);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/data/ping", async (req, res) => {
  const price = priceForTool("snapshot");
  const decision = await enforcePolicy("snapshot", price.amountTinybar, paymentHeaderFrom(req));
  if (!decision.ok) {
    res.status(402).json({
      error: "payment rejected — ENS policy exceeded",
      reason: decision.reason,
      policy: decision.policy,
      requestedTinybar: decision.requestedTinybar,
    });
    return;
  }
  res.json({ paid: true, data: "pong", identity: { name: decision.policy?.name, match: true } });
});

app.get("/data/snapshot", async (req, res) => {
  const price = priceForTool("snapshot");
  const decision = await enforcePolicy("snapshot", price.amountTinybar, paymentHeaderFrom(req));
  if (!decision.ok) {
    res.status(402).json({
      error: "payment rejected — ENS policy exceeded",
      reason: decision.reason,
      policy: decision.policy,
      requestedTinybar: decision.requestedTinybar,
    });
    return;
  }
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
  const price = priceForTool("history");
  const decision = await enforcePolicy("history", price.amountTinybar, paymentHeaderFrom(req));
  if (!decision.ok) {
    res.status(402).json({
      error: "payment rejected — ENS policy exceeded",
      reason: decision.reason,
      policy: decision.policy,
      requestedTinybar: decision.requestedTinybar,
    });
    return;
  }
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
  const price = priceForTool("deep-dive");
  const decision = await enforcePolicy("deep-dive", price.amountTinybar, paymentHeaderFrom(req));
  if (!decision.ok) {
    res.status(402).json({
      error: "payment rejected — ENS policy exceeded",
      reason: decision.reason,
      policy: decision.policy,
      requestedTinybar: decision.requestedTinybar,
    });
    return;
  }
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

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Toll resource server listening on http://localhost:${PORT}`);
});
