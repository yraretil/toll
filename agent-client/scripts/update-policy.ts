// Update policy text records on the agent's resolver.
// Usage: npx tsx scripts/update-policy.ts spend.maxPerRequest=100000 [key=value ...]
import "dotenv/config";
import { createPublicClient, createWalletClient, http, namehash } from "viem";
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

async function main(): Promise<void> {
  const sepoliaKey = process.env.SEPOLIA_PRIVATE_KEY as `0x${string}` | undefined;
  const agentName = process.env.ENS_AGENT_NAME;
  const pairs = process.argv.slice(2);
  if (!sepoliaKey || !agentName || pairs.length === 0) {
    throw new Error("SEPOLIA_PRIVATE_KEY, ENS_AGENT_NAME and at least one key=value required");
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
  console.log(`resolver: ${resolver}`);

  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const hash = await wallet.writeContract({
      address: resolver,
      abi: resolverAbi,
      functionName: "setText",
      args: [node, key, value],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`set ${key}=${value} (${hash})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
