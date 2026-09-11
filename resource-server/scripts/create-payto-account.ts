// T1.1: create the payTo (receiving) account on Hedera testnet.
// Operator = portal account from agent-client/.env (HEDERA_ACCOUNT_ID / HEDERA_PRIVATE_KEY).
// Prints PAY_TO_ACCOUNT=0.0.XXXXX — set it in resource-server/.env.
import "dotenv/config";
import {
  AccountCreateTransaction,
  AccountId,
  Client,
  Hbar,
  PrivateKey,
} from "@hiero-ledger/sdk";

async function main(): Promise<void> {
  const operatorId = process.env.HEDERA_ACCOUNT_ID;
  const operatorKey = process.env.HEDERA_PRIVATE_KEY;
  if (!operatorId || !operatorKey) {
    throw new Error("HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY must be set in .env");
  }

  const client = Client.forTestnet().setOperator(
    AccountId.fromString(operatorId),
    PrivateKey.fromStringECDSA(operatorKey),
  );

  try {
    const newKey = PrivateKey.generateECDSA();
    const tx = await new AccountCreateTransaction()
      .setKey(newKey.publicKey)
      .setInitialBalance(new Hbar(0.1))
      .execute(client);
    const receipt = await tx.getReceipt(client);
    const accountId = receipt.accountId;
    if (!accountId) throw new Error("account creation returned no account id");
    // eslint-disable-next-line no-console
    console.log(`PAY_TO_ACCOUNT=${accountId.toString()}`);
    // eslint-disable-next-line no-console
    console.log(`PAY_TO_PRIVATE_KEY=${newKey.toString()} (store securely; server only receives)`);
  } finally {
    client.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
