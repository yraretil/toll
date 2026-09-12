// T3.2: register the agent name on ENSv2 (Sepolia) via commit-reveal.
// - Deploys the agent's own Permissioned Resolver via the VerifiableFactory.
// - Pays the fee in MockUSDC (free-mintable on Sepolia).
// - Address record = EVM address derived from the agent's Hedera ECDSA key.
// - Sets the spend.* policy text records (T3.3).
import "dotenv/config";
import { randomBytes } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  namehash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  ETH_REGISTRAR,
  MOCK_USDC,
  PERMISSIONED_RESOLVER_IMPL,
  SEPOLIA_RPC_URL,
  UNIVERSAL_RESOLVER,
  VERIFIABLE_FACTORY,
  ZERO_ADDRESS,
  ZERO_HASH,
  erc20Abi,
  factoryAbi,
  registrarAbi,
  resolverAbi,
} from "./ensv2.js";

const MAX_UINT256 = 2n ** 256n - 1n;
// EAC nybble-packed roles: bit 0 of every nybble = every role + admin variant.
// (type(uint256).max is INVALID here — _checkRoleBitmap reverts.)
const ALL_EAC_ROLES = BigInt("0x1111111111111111111111111111111111111111111111111111111111111111");
const ONE_YEAR = 365n * 24n * 60n * 60n;

const POLICY_RECORDS: [string, string][] = [
  ["spend.dailyCap", "2000000"],
  ["spend.maxPerRequest", "2000000"],
  ["spend.allowedTools", "snapshot,history,deep-dive,price,risk-scan,whale-watch"],
  ["toll.riskTier", "research"],
];

async function main(): Promise<void> {
  const sepoliaKey = process.env.SEPOLIA_PRIVATE_KEY as `0x${string}` | undefined;
  const hederaKey = process.env.HEDERA_PRIVATE_KEY as string | undefined;
  const agentName = process.env.ENS_AGENT_NAME;
  if (!sepoliaKey || !hederaKey || !agentName) {
    throw new Error("SEPOLIA_PRIVATE_KEY, HEDERA_PRIVATE_KEY and ENS_AGENT_NAME must be set");
  }
  const label = agentName.endsWith(".eth") ? agentName.slice(0, -4) : agentName;
  const node = namehash(agentName);

  // Agent EVM address derived from its Hedera ECDSA key (identity link).
  const { privateKeyToAccount: hederaKeyToAccount } = await import("viem/accounts");
  const agentEvmAddress = hederaKeyToAccount(hederaKey as `0x${string}`).address;

  const account = privateKeyToAccount(sepoliaKey);
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(SEPOLIA_RPC_URL),
  });
  const wallet = createWalletClient({
    account,
    chain: sepolia,
    transport: http(SEPOLIA_RPC_URL),
  });
  console.log(`owner: ${account.address}`);
  console.log(`agent EVM address: ${agentEvmAddress}`);

  const available = (await publicClient.readContract({
    address: ETH_REGISTRAR,
    abi: registrarAbi,
    functionName: "isAvailable",
    args: [label],
  })) as boolean;
  console.log(`available: ${available}`);
  if (!available) throw new Error(`${agentName} is already registered`);

  // 1. Deploy the agent's own resolver (owner holds every role).
  const initData = encodeFunctionData({
    abi: [
      {
        type: "function",
        name: "initialize",
        inputs: [
          { name: "admin", type: "address" },
          { name: "roleBitmap", type: "uint256" },
          { name: "setters", type: "bytes[]" },
        ],
        outputs: [],
      },
    ] as const,
    functionName: "initialize",
    args: [account.address, ALL_EAC_ROLES, []],
  });
  const salt = BigInt(`0x${randomBytes(32).toString("hex")}`);
  const { result: resolver } = await publicClient.simulateContract({
    account,
    address: VERIFIABLE_FACTORY,
    abi: factoryAbi,
    functionName: "deployProxy",
    args: [PERMISSIONED_RESOLVER_IMPL, salt, initData],
  });
  console.log(`resolver (predicted): ${resolver}`);
  const deployHash = await wallet.writeContract({
    address: VERIFIABLE_FACTORY,
    abi: factoryAbi,
    functionName: "deployProxy",
    args: [PERMISSIONED_RESOLVER_IMPL, salt, initData],
  });
  await publicClient.waitForTransactionReceipt({ hash: deployHash });
  console.log(`resolver deployed: ${deployHash}`);

  // 2. Price + mint MockUSDC + approve.
  const [base, premium] = (await publicClient.readContract({
    address: ETH_REGISTRAR,
    abi: registrarAbi,
    functionName: "getRegisterPrice",
    args: [label, ONE_YEAR, MOCK_USDC],
  })) as [bigint, bigint];
  const price = base + premium;
  console.log(`price (MockUSDC): ${price}`);
  const mintHash = await wallet.writeContract({
    address: MOCK_USDC,
    abi: erc20Abi,
    functionName: "mint",
    args: [account.address, price * 2n],
  });
  await publicClient.waitForTransactionReceipt({ hash: mintHash });
  const approveHash = await wallet.writeContract({
    address: MOCK_USDC,
    abi: erc20Abi,
    functionName: "approve",
    args: [ETH_REGISTRAR, price],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  console.log("MockUSDC minted + approved");

  // 3. Commit → wait 70s → register.
  const secret = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
  const commitment = (await publicClient.readContract({
    address: ETH_REGISTRAR,
    abi: registrarAbi,
    functionName: "makeCommitment",
    args: [label, account.address, secret, ZERO_ADDRESS, resolver, ONE_YEAR, ZERO_HASH],
  })) as `0x${string}`;
  const commitHash = await wallet.writeContract({
    address: ETH_REGISTRAR,
    abi: registrarAbi,
    functionName: "commit",
    args: [commitment],
  });
  await publicClient.waitForTransactionReceipt({ hash: commitHash });
  console.log(`committed (${commitHash}), waiting 70s...`);
  await new Promise((r) => setTimeout(r, 70_000));
  const registerHash = await wallet.writeContract({
    address: ETH_REGISTRAR,
    abi: registrarAbi,
    functionName: "register",
    args: [label, account.address, secret, ZERO_ADDRESS, resolver, ONE_YEAR, MOCK_USDC, ZERO_HASH],
  });
  await publicClient.waitForTransactionReceipt({ hash: registerHash });
  console.log(`registered: ${registerHash}`);

  // 4. Records: address + policy, batched via multicall.
  const setAddr = encodeFunctionData({
    abi: resolverAbi,
    functionName: "setAddr",
    args: [node, agentEvmAddress],
  });
  const setTexts = POLICY_RECORDS.map(([key, value]) =>
    encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [node, key, value] }),
  );
  const recordsHash = await wallet.writeContract({
    address: resolver,
    abi: resolverAbi,
    functionName: "multicall",
    args: [[setAddr, ...setTexts]],
  });
  await publicClient.waitForTransactionReceipt({ hash: recordsHash });
  console.log(`records set: ${recordsHash}`);

  // 5. Verify: resolve back through the v2 Universal Resolver.
  const resolved = await publicClient.getEnsAddress({
    name: agentName,
    universalResolverAddress: UNIVERSAL_RESOLVER,
  });
  console.log(`resolved: ${resolved}`);
  if (resolved?.toLowerCase() !== agentEvmAddress.toLowerCase()) {
    throw new Error(`resolution mismatch: ${resolved} != ${agentEvmAddress}`);
  }
  console.log(`OK: ${agentName} -> ${agentEvmAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
