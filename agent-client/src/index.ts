// Toll agent: LLM planner over metered x402 data.
// With LLM_API_KEY set → planner loop (Groq/OpenAI-compatible).
// Without → deterministic fallback (buys every dataset once).
import "dotenv/config";
import {
  makeLlmCall,
  pathFor,
  runPlannerLoop,
} from "./planner.js";
import { createBuyer, type Settlement } from "./buyer.js";
import { hashscanUrl, loadIdentity, loadSpend, tinybarToHbar } from "./identity.js";
import { LEGACY_TASK, TOOLS } from "./catalog.js";

const TASK = LEGACY_TASK;

function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(...args);
}

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

async function main(): Promise<void> {
  const accountId = process.env.HEDERA_ACCOUNT_ID;
  const privateKey = process.env.HEDERA_PRIVATE_KEY;
  const serverUrl = process.env.RESOURCE_SERVER_URL ?? "http://localhost:4021";
  if (!accountId || !privateKey) {
    throw new Error("HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY must be set in .env");
  }

  const identity = await loadIdentity();
  log(`● Toll agent ${identity.name || "(no ENS name)"} · payer ${identity.payerAccount} · balance ${tinybarToHbar(identity.balanceTinybar)} HBAR`);

  const purchase = createBuyer({
    serverUrl,
    accountId,
    privateKey,
    onSettlement: (tool, _path, settlement: Settlement | null) => {
      if (settlement) {
        log(`  ↳ settled ${settlement.transaction} → ${hashscanUrl(settlement.transaction)}`);
      } else {
        log(`  ↳ no settlement (rejected before payment)`);
      }
      void tool;
    },
  });

  const llmKey = process.env.LLM_API_KEY ?? "";
  const spendNow = await loadSpend(serverUrl, accountId);
  const remaining = spendNow?.remainingTinybar ?? identity.dailyCapTinybar;
  if (remaining <= 0) {
    log(
      `day budget exhausted on the server (spent ${spendNow?.spentTinybar}/${identity.dailyCapTinybar}) — restart the server to reset the ledger, or raise spend.dailyCap`,
    );
    return;
  }
  if (!llmKey) {
    log("LLM_API_KEY unset — deterministic fallback: buying every dataset once");
    let spent = 0;
    for (const [tool, spec] of Object.entries(TOOLS)) {
      const path = pathFor(spec);
      log(`▸ buying ${tool} (${spec.priceTinybar} tinybar)…`);
      await purchase(tool, path);
      spent += spec.priceTinybar;
    }
    log(`total spent: ${tinybarToHbar(spent)} HBAR`);
    return;
  }

  const llmCall = makeLlmCall(
    process.env.LLM_BASE_URL ?? "https://api.groq.com/openai/v1",
    llmKey,
    process.env.LLM_MODEL ?? "openai/gpt-oss-120b",
  );
  log(`task: ${TASK}`);
  const budget = Math.min(identity.dailyCapTinybar, remaining);
  log(`budget this run: ${budget} tinybar (cap ${identity.dailyCapTinybar}, server has ${remaining} left)`);
  const result = await runPlannerLoop({
    task: TASK,
    budgetTinybar: budget,
    tools: TOOLS,
    llmCall,
    purchase,
    onEvent: (e) => {
      if (e.type === "decision" && e.decision.action !== "recommend") {
        const sym = e.decision.symbol ? ` ${e.decision.symbol}` : "";
        log(`▸ planner wants ${e.decision.action}${sym} — ${e.decision.reason}`);
      } else if (e.type === "purchase") {
        log(`  ✓ bought ${e.purchase.tool} for ${e.purchase.amountTinybar} tinybar (spent ${e.spentTinybar})`);
      } else if (e.type === "stopped") {
        log(`  ✕ ${e.reason}`);
      }
    },
  });
  log("---");
  log(`answer: ${result.answer}`);
  if (result.stopped) log(result.stopped);
  log(`total spent: ${tinybarToHbar(result.totalSpentTinybar)} HBAR`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
