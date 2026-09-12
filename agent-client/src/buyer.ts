// The ONLY thing that ever moves money: deterministic x402 buyer.
// Shared by index.ts and the TUI. The LLM never touches this.
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { createClientHederaSigner } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { PrivateKey } from "@x402/hedera";
import type { PurchaseFn } from "./planner.js";

export interface Settlement {
  success: boolean;
  payer: string;
  transaction: string;
  network: string;
}

export function createBuyer(opts: {
  serverUrl: string;
  accountId: string;
  privateKey: string;
  onSettlement?: (tool: string, path: string, settlement: Settlement | null) => void;
}): PurchaseFn {
  const signer = createClientHederaSigner(
    opts.accountId,
    PrivateKey.fromStringECDSA(opts.privateKey),
    { network: "hedera:testnet" },
  );
  // HBAR (0.0.0) is NOT in @x402/hedera's default-asset table (USDC only),
  // so opt it in explicitly via spendControls.
  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: "hedera:*", client: new ExactHederaScheme(signer) }],
    spendControls: { allowedAssets: [{ network: "hedera:testnet", asset: "0.0.0" }] },
  });
  return async (tool: string, path: string) => {
    const res = await fetchWithPayment(`${opts.serverUrl}${path}`, { method: "GET" });
    const body = (await res.json()) as unknown;
    const paymentResponse = res.headers.get("PAYMENT-RESPONSE");
    const settlement = (
      paymentResponse ? decodePaymentResponseHeader(paymentResponse) : null
    ) as Settlement | null;
    opts.onSettlement?.(tool, path, settlement);
    return { settlement, body };
  };
}
