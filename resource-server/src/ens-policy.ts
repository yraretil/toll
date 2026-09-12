// ENSv2 policy control plane (T3.3).
// The agent's name (ENS_AGENT_NAME on Sepolia) IS its spending policy:
//   spend.dailyCap, spend.maxPerRequest, spend.allowedTools, toll.riskTier.
// Read live from the Sepolia registry at payment time and enforced per request.
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { inspectHederaTransaction } from "@x402/hedera";
import type { TollTool } from "./pricing.js";

const UNIVERSAL_RESOLVER = "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe" as const;
const SEPOLIA_RPC_URL =
  process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const MIRROR_NODE = "https://testnet.mirrornode.hedera.com";

export interface AgentPolicy {
  name: string;
  address: string;
  dailyCapTinybar: number;
  maxPerRequestTinybar: number;
  allowedTools: TollTool[];
  riskTier: string;
}

export interface PolicyDecision {
  ok: boolean;
  reason?: string;
  policy?: AgentPolicy;
  payerAccount?: string;
  payerEvm?: string;
  requestedTinybar?: number;
  daySpentTinybar?: number;
}

function sepoliaClient() {
  return createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC_URL) });
}

/** Read the agent's live policy records from Sepolia. */
export async function readPolicy(agentName: string): Promise<AgentPolicy> {
  const client = sepoliaClient();
  const address =
    (await client.getEnsAddress({
      name: agentName,
      universalResolverAddress: UNIVERSAL_RESOLVER,
    })) ?? "";
  const get = (key: string) =>
    client.getEnsText({ name: agentName, key, universalResolverAddress: UNIVERSAL_RESOLVER });
  const [dailyCap, maxPerRequest, allowedTools, riskTier] = await Promise.all([
    get("spend.dailyCap"),
    get("spend.maxPerRequest"),
    get("spend.allowedTools"),
    get("toll.riskTier"),
  ]);
  return {
    name: agentName,
    address,
    dailyCapTinybar: Number(dailyCap ?? "0"),
    maxPerRequestTinybar: Number(maxPerRequest ?? "0"),
    allowedTools: String(allowedTools ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as TollTool[],
    riskTier: riskTier ?? "",
  };
}

/** Payer Hedera account id from the base64 X-PAYMENT header. */
export function payerFromPaymentHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  try {
    const payload = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
      payload?: { transaction?: string };
    };
    const txBase64 = payload?.payload?.transaction;
    if (!txBase64) return null;
    const inspected = inspectHederaTransaction(txBase64) as {
      hbarTransfers: { accountId: string; amount: string }[];
    };
    let payer: string | null = null;
    let mostNegative = 0n;
    for (const t of inspected.hbarTransfers ?? []) {
      const amount = BigInt(t.amount);
      if (amount < mostNegative) {
        mostNegative = amount;
        payer = t.accountId;
      }
    }
    return payer;
  } catch {
    return null;
  }
}

/** EVM address for a Hedera account id (mirror node). */
export async function evmAddressOf(accountId: string): Promise<string> {
  const res = await fetch(`${MIRROR_NODE}/api/v1/accounts/${accountId}`);
  const body = (await res.json()) as { evm_address?: string };
  return body.evm_address ?? "";
}

// In-memory daily spend ledger, keyed `${UTC-day}:${payer}`.
// Resets on server restart and rolls over at UTC midnight.
const daySpend = new Map<string, number>();

function todayKey(payer: string): string {
  return `${new Date().toISOString().slice(0, 10)}:${payer}`;
}

/** Tinybar spent today by a payer (0 if none). */
export function getDaySpent(payerAccount: string): number {
  return daySpend.get(todayKey(payerAccount)) ?? 0;
}

export interface SpendStatus {
  name: string;
  day: string;
  payer: string;
  dailyCapTinybar: number;
  spentTinybar: number;
  remainingTinybar: number;
}

/** Live cap + spend for a payer (powers GET /status and the TUI card). */
export async function spendStatus(payerAccount: string): Promise<SpendStatus> {
  const agentName = process.env.ENS_AGENT_NAME ?? "";
  const day = new Date().toISOString().slice(0, 10);
  const spent = getDaySpent(payerAccount);
  if (!agentName) return { name: "", day, payer: payerAccount, dailyCapTinybar: 0, spentTinybar: spent, remainingTinybar: 0 };
  const policy = await readPolicy(agentName);
  return {
    name: agentName,
    day,
    payer: payerAccount,
    dailyCapTinybar: policy.dailyCapTinybar,
    spentTinybar: spent,
    remainingTinybar: Math.max(0, policy.dailyCapTinybar - spent),
  };
}

/** x402 v2 sends the payment payload in PAYMENT-SIGNATURE (v1 used X-PAYMENT). */
export function paymentHeaderFrom(req: {
  header: (name: string) => string | undefined;
}): string | null {
  return req.header("PAYMENT-SIGNATURE") ?? req.header("X-PAYMENT") ?? null;
}

/** Enforce the on-chain policy for one paid request. */
export async function enforcePolicy(
  tool: TollTool,
  amountTinybar: number,
  paymentHeader: string | null | undefined,
): Promise<PolicyDecision> {
  const agentName = process.env.ENS_AGENT_NAME ?? "";
  if (!agentName) {
    console.warn("ENS_AGENT_NAME unset — policy enforcement skipped (dev mode)");
    return { ok: true };
  }

  const payerAccount = payerFromPaymentHeader(paymentHeader);
  if (!payerAccount) {
    return { ok: false, reason: "cannot determine payer from payment payload" };
  }
  const payerEvm = (await evmAddressOf(payerAccount)).toLowerCase();
  const policy = await readPolicy(agentName);

  if (!policy.address || policy.address.toLowerCase() !== payerEvm) {
    return {
      ok: false,
      reason: `identity mismatch: payer ${payerAccount} (${payerEvm}) != ${agentName} (${policy.address})`,
      policy,
      payerAccount,
      payerEvm,
    };
  }
  if (!policy.allowedTools.includes(tool)) {
    return {
      ok: false,
      reason: `tool not allowed: ${tool} not in [${policy.allowedTools.join(",")}]`,
      policy,
      payerAccount,
      payerEvm,
      requestedTinybar: amountTinybar,
    };
  }
  if (amountTinybar > policy.maxPerRequestTinybar) {
    return {
      ok: false,
      reason:
        `Budget policy exceeded. Requested ${amountTinybar}, ` +
        `allowed ${policy.maxPerRequestTinybar}. STOPPING.`,
      policy,
      payerAccount,
      payerEvm,
      requestedTinybar: amountTinybar,
    };
  }
  const key = todayKey(payerAccount);
  const spent = daySpend.get(key) ?? 0;
  if (spent + amountTinybar > policy.dailyCapTinybar) {
    return {
      ok: false,
      reason:
        `Daily cap exceeded. Spent ${spent}, requested ${amountTinybar}, ` +
        `cap ${policy.dailyCapTinybar}. STOPPING.`,
      policy,
      payerAccount,
      payerEvm,
      requestedTinybar: amountTinybar,
      daySpentTinybar: spent,
    };
  }
  daySpend.set(key, spent + amountTinybar);
  return { ok: true, policy, payerAccount, payerEvm, requestedTinybar: amountTinybar };
}
