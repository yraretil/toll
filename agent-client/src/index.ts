// Toll agent: LLM planner over metered x402 data (T4.2).
// With LLM_API_KEY set → planner loop (Groq/OpenAI-compatible).
// Without → deterministic fallback (buys every dataset once).
import "dotenv/config";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { createClientHederaSigner } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { PrivateKey } from "@x402/hedera";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import {
  makeLlmCall,
  runPlannerLoop,
  type PurchaseFn,
  type ToolSpec,
} from "./planner.js";

const UNIVERSAL_RESOLVER = "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe" as const;
const TASK = "Find the best USDC lending opportunity on Aave V3.";

const TOOLS: Record<string, ToolSpec> = {
  snapshot: { path: "/data/snapshot", priceTinybar: 200_000 },
  history: { path: "/data/history?symbol={symbol}", priceTinybar: 800_000, defaultSymbol: "USDC" },
  "deep-dive": { path: "/data/deep-dive?symbol={symbol}", priceTinybar: 200_000, defaultSymbol: "USDC" },
};

function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(...args);
}

/** Planner budget = spend.dailyCap from the agent's ENS records (fallback: 2M). */
async function readBudgetTinybar(): Promise<number> {
  const name = process.env.ENS_AGENT_NAME ?? "";
  if (!name) {
    log("ENS_AGENT_NAME unset — budget defaults to 2000000 tinybar");
    return 2_000_000;
  }
  try {
    const client = createPublicClient({
      chain: sepolia,
      transport: http(
        process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
      ),
    });
    const cap = await client.getEnsText({
      name,
      key: "spend.dailyCap",
      universalResolverAddress: UNIVERSAL_RESOLVER,
    });
    if (cap && Number(cap) > 0) {
      log(`budget from ${name}: spend.dailyCap=${cap} tinybar`);
      return Number(cap);
    }
  } catch (err) {
    log(`ENS budget read failed (${String(err)}) — defaulting to 2000000 tinybar`);
  }
  return 2_000_000;
}

async function main(): Promise<void> {
  const accountId = process.env.HEDERA_ACCOUNT_ID;
  const privateKey = process.env.HEDERA_PRIVATE_KEY;
  const serverUrl = process.env.RESOURCE_SERVER_URL ?? "http://localhost:4021";
  if (!accountId || !privateKey) {
    throw new Error("HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY must be set in .env");
  }

  const signer = createClientHederaSigner(
    accountId,
    PrivateKey.fromStringECDSA(privateKey),
    { network: "hedera:testnet" },
  );
  // HBAR (0.0.0) is NOT in @x402/hedera's default-asset table (USDC only),
  // so opt it in explicitly via spendControls.
  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: "hedera:*",
        client: new ExactHederaScheme(signer),
      },
    ],
    spendControls: {
      allowedAssets: [{ network: "hedera:testnet", asset: "0.0.0" }],
    },
  });

  // Deterministic x402 executor — the only thing that ever moves money.
  const purchase: PurchaseFn = async (tool, path) => {
    const res = await fetchWithPayment(`${serverUrl}${path}`, { method: "GET" });
    const body = (await res.json()) as unknown;
    const paymentResponse = res.headers.get("PAYMENT-RESPONSE");
    const settlement = paymentResponse
      ? decodePaymentResponseHeader(paymentResponse)
      : null;
    log(`${path} settlement tx:`, JSON.stringify(settlement));
    return { settlement, body };
  };

  const llmKey = process.env.LLM_API_KEY ?? "";
  if (!llmKey) {
    log("LLM_API_KEY unset — deterministic fallback: buying every dataset once");
    let spent = 0;
    for (const [tool, spec] of Object.entries(TOOLS)) {
      const { body } = await purchase(tool, spec.path);
      spent += spec.priceTinybar;
      log(`${spec.path} response:`, JSON.stringify(body).slice(0, 300));
    }
    log(`total spent: ${(spent / 100_000_000).toFixed(6)} HBAR`);
    return;
  }

  const llmCall = makeLlmCall(
    process.env.LLM_BASE_URL ?? "https://api.groq.com/openai/v1",
    llmKey,
    process.env.LLM_MODEL ?? "llama-3.3-70b-versatile",
  );
  const budget = await readBudgetTinybar();
  const result = await runPlannerLoop({
    task: TASK,
    budgetTinybar: budget,
    tools: TOOLS,
    llmCall,
    purchase,
  });
  log("---");
  for (const p of result.purchases) {
    log(`bought ${p.tool} for ${p.amountTinybar} tinybar`);
  }
  if (result.stopped) log(result.stopped);
  log(`answer: ${result.answer}`);
  log(`total spent: ${(result.totalSpentTinybar / 100_000_000).toFixed(6)} HBAR`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
