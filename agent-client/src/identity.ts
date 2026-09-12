// Shared agent identity + ENS budget reads (used by index.ts and the TUI).
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";

const UNIVERSAL_RESOLVER = "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe" as const;
const SEPOLIA_RPC_URL =
  process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const MIRROR_NODE = "https://testnet.mirrornode.hedera.com";

export interface AgentIdentity {
  name: string;
  address: string;
  payerAccount: string;
  balanceTinybar: number;
  dailyCapTinybar: number;
  maxPerRequestTinybar: number;
  allowedTools: string;
  riskTier: string;
}

function sepoliaClient() {
  return createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC_URL) });
}

/** Live identity: ENS records (Sepolia) + payer balance (mirror node). */
export async function loadIdentity(): Promise<AgentIdentity> {
  const name = process.env.ENS_AGENT_NAME ?? "";
  const payerAccount = process.env.HEDERA_ACCOUNT_ID ?? "";
  const client = sepoliaClient();
  const [address, dailyCap, maxPerRequest, allowedTools, riskTier] = name
    ? await Promise.all([
        client.getEnsAddress({ name, universalResolverAddress: UNIVERSAL_RESOLVER }),
        client.getEnsText({ name, key: "spend.dailyCap", universalResolverAddress: UNIVERSAL_RESOLVER }),
        client.getEnsText({ name, key: "spend.maxPerRequest", universalResolverAddress: UNIVERSAL_RESOLVER }),
        client.getEnsText({ name, key: "spend.allowedTools", universalResolverAddress: UNIVERSAL_RESOLVER }),
        client.getEnsText({ name, key: "toll.riskTier", universalResolverAddress: UNIVERSAL_RESOLVER }),
      ])
    : ["", null, null, null, null];
  let balanceTinybar = 0;
  if (payerAccount) {
    try {
      const res = await fetch(`${MIRROR_NODE}/api/v1/accounts/${payerAccount}`);
      const body = (await res.json()) as { balance?: { balance?: number } };
      balanceTinybar = body.balance?.balance ?? 0;
    } catch {
      balanceTinybar = 0;
    }
  }
  return {
    name,
    address: address ?? "",
    payerAccount,
    balanceTinybar,
    dailyCapTinybar: Number(dailyCap ?? "2000000"),
    maxPerRequestTinybar: Number(maxPerRequest ?? "2000000"),
    allowedTools: allowedTools ?? "snapshot,history,deep-dive",
    riskTier: riskTier ?? "research",
  };
}

/** HashScan testnet URL for an x402 settlement id ("0.0.x@sss.nnn"). */
export function hashscanUrl(transaction: string): string {
  const [id = "", t = ""] = transaction.split("@");
  return `https://hashscan.io/testnet/transaction/${id}-${t.replace(".", "-")}`;
}

export function tinybarToHbar(tinybar: number): string {
  return (tinybar / 100_000_000).toFixed(6);
}
