# Toll 3-minute demo

1. **Agent boots** — identity `toll-agent-chad.eth`, payer balance, live policy
   (`spend.dailyCap`, `spend.maxPerRequest`, `spend.allowedTools`).
   Scene: "this is who it is, what it holds, what it's allowed to buy."
2. **Task**: "Find the best USDC lending opportunity."
3. **Staged purchases** — 402 → policy approved → pay → data (The Graph), repeated
   (snapshot, then deep-dive; each settles on Hedera, receipts on HashScan testnet).
4. **Answer + `total spent`** in HBAR, grounded in live APY/liquidity/utilization.
5. **ENS beat** — operator tightens `spend.maxPerRequest` to 0.001 HBAR
   (`npx tsx scripts/update-policy.ts spend.maxPerRequest=100000`); rerun; agent stops
   mid-task: "Budget policy exceeded. Requested 200000, allowed 100000. STOPPING."
   Restore with `spend.maxPerRequest=2000000`.

Tightening command reference (run from `agent-client/`):
```bash
npx tsx scripts/update-policy.ts spend.maxPerRequest=100000   # break it
npx tsx scripts/update-policy.ts spend.maxPerRequest=2000000  # restore it
```
