// Phase 1 deterministic agent (no LLM yet — T1.3).
// Pays for GET /data/ping via x402 and prints the settlement receipt.
import "dotenv/config";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { createClientHederaSigner } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { PrivateKey } from "@x402/hedera";

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

  const paths = [
    "/data/ping",
    "/data/snapshot",
    "/data/history?symbol=USDC",
    "/data/deep-dive?symbol=USDC",
  ];
  for (const path of paths) {
    const res = await fetchWithPayment(`${serverUrl}${path}`, { method: "GET" });
    const body = (await res.json()) as unknown;
    const paymentResponse = res.headers.get("PAYMENT-RESPONSE");
    if (paymentResponse) {
      const decoded = decodePaymentResponseHeader(paymentResponse);
      // eslint-disable-next-line no-console
      console.log(`${path} settlement tx:`, JSON.stringify(decoded));
    }
    // eslint-disable-next-line no-console
    console.log(`${path} response:`, JSON.stringify(body).slice(0, 500));
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
