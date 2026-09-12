// Shared ENSv2 policy helpers (used by scripts/update-policy.ts and the TUI).
import { createPublicClient, createWalletClient, http, namehash } from "viem";
import type { Account, Chain, PublicClient, Transport, WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { SEPOLIA_RPC_URL, resolverAbi } from "./ensv2.js";

const ETH_REGISTRY = "0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2" as const;
const registryAbi = [
  {
    type: "function",
    name: "getResolver",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ type: "address" }],
  },
] as const;

export interface PolicyClients {
  agentName: string;
  node: `0x${string}`;
  resolver: `0x${string}`;
  publicClient: PublicClient<Transport, Chain>;
  wallet: WalletClient<Transport, Chain, Account>;
}

export async function policyClients(): Promise<PolicyClients> {
  const sepoliaKey = process.env.SEPOLIA_PRIVATE_KEY as `0x${string}` | undefined;
  const agentName = process.env.ENS_AGENT_NAME;
  if (!sepoliaKey || !agentName) {
    throw new Error("SEPOLIA_PRIVATE_KEY and ENS_AGENT_NAME must be set");
  }
  const label = agentName.endsWith(".eth") ? agentName.slice(0, -4) : agentName;
  const node = namehash(agentName);
  const account = privateKeyToAccount(sepoliaKey);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC_URL) });
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(SEPOLIA_RPC_URL) });
  const resolver = (await publicClient.readContract({
    address: ETH_REGISTRY,
    abi: registryAbi,
    functionName: "getResolver",
    args: [label],
  })) as `0x${string}`;
  return { agentName, node, resolver, publicClient, wallet };
}

/** Set one policy text record; resolves to the tx hash. */
export async function setPolicyRecord(
  clients: PolicyClients,
  key: string,
  value: string,
): Promise<`0x${string}`> {
  const hash = await clients.wallet.writeContract({
    address: clients.resolver,
    abi: resolverAbi,
    functionName: "setText",
    args: [clients.node, key, value],
  });
  await clients.publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
