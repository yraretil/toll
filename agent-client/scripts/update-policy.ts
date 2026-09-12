// Update policy text records on the agent's resolver.
// Usage: npx tsx scripts/update-policy.ts spend.maxPerRequest=100000 [key=value ...]
import "dotenv/config";
import { policyClients, setPolicyRecord } from "./policy.js";

async function main(): Promise<void> {
  const pairs = process.argv.slice(2);
  if (pairs.length === 0) {
    throw new Error("at least one key=value required");
  }
  const clients = await policyClients();
  console.log(`resolver: ${clients.resolver}`);
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    const hash = await setPolicyRecord(clients, pair.slice(0, eq), pair.slice(eq + 1));
    console.log(`set ${pair} (${hash})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
