# Toll

**An AI agent that autonomously buys live on-chain data.** An LLM planner decides
which data it needs, an [x402](https://www.x402.org/) payment handshake moves HBAR
per query on Hedera testnet, [The Graph](https://thegraph.com/) supplies live Aave V3
knowledge, and an [ENSv2](https://docs.ens.domains/ensv2/overview) policy defines what
the agent is allowed to buy.

> What happens when HTTP resources become directly purchasable by autonomous agents?
> x402 gives HTTP a native payment handshake — an agent asks for data, the server
> quotes a price, the agent pays and the answer comes back. No API key, no account,
> no checkout.

## Architecture

```
User task ──▶ Planner (LLM, Groq) ──▶ Toll resource server ──▶ x402/Hedera ──▶ The Graph
                        │                      │
                        │                      ▼
                        │              ENSv2 Sepolia (policy plane, read at payment time)
                        ▼
              answer + total spent
```

- **Planner** (`agent-client/src/planner.ts`) outputs strict JSON
  `{action, reason, symbol?}` — `snapshot` | `history` | `deep-dive` | `price`
  | `risk-scan` | `whale-watch` | `recommend` (symbols USDC/DAI/USDT where applicable).
  It never signs and never touches money; a deterministic x402 client executes buys.
  Guardrails: max 4 purchases, budget = `spend.dailyCap` from the agent's ENS records.
- **Resource server** (`resource-server/src/index.ts`) quotes a fixed per-dataset price,
  answers HTTP 402, verifies + settles via the Blocky402 facilitator, enforces the
  agent's ENS policy, then returns live Aave V3 data.
- **Payments** in HBAR (`asset "0.0.0"`, tinybar) on `hedera:testnet`.

## Price schedule

| Tool | Dataset | Price |
|---|---|---|
| `snapshot` | top-5 markets | 0.002 HBAR (200,000 tinybar) |
| `history` | APY + utilization history (USDC/DAI/USDT) | 0.008 HBAR (800,000 tinybar) |
| `deep-dive` | per-market full detail (USDC/DAI/USDT) | 0.002 HBAR (200,000 tinybar) |
| `price` | live USD price via Uniswap V3 (USDC/DAI/USDT) | 0.002 HBAR (200,000 tinybar) |
| `risk-scan` | high-utilization / frozen / paused flags | 0.002 HBAR (200,000 tinybar) |
| `whale-watch` | top suppliers per market (USDC/DAI/USDT) | 0.002 HBAR (200,000 tinybar) |

Schedule lives in `resource-server/src/pricing.ts` (+ `pricing.test.ts`).

## ENS policy (the authority plane)

The agent's name holds its spending policy as text records, read live at payment time
(`resource-server/src/ens-policy.ts`):

| Record | Value |
|---|---|
| `spend.dailyCap` | `"2000000"` tinybar/day |
| `spend.maxPerRequest` | `"2000000"` tinybar |
| `spend.allowedTools` | `"snapshot,history,deep-dive,price,risk-scan,whale-watch"` |
| `toll.riskTier` | `"research"` |

Over cap/limit, off-allowlist, or identity mismatch → HTTP 402
`payment rejected — ENS policy exceeded` + the numbers. Tighten `spend.maxPerRequest`
below a price (`agent-client/scripts/update-policy.ts`) and the agent stops mid-task.

## Run it

Prereqs (all free/testnet): Hedera testnet account + HBAR (portal.hedera.com),
The Graph Studio key, Groq key, Sepolia wallet + ETH for the ENS name.

```bash
# 1. env
cp resource-server/.env.example resource-server/.env   # + fill in
cp agent-client/.env.example agent-client/.env         # + fill in

# 2. install
cd resource-server && npm install && cd ../agent-client && npm install

# 3. receiving account (prints PAY_TO_ACCOUNT → resource-server/.env)
cd ../resource-server && npm run create-payto-account

# 4. ENS name (registers, sets address + policy records, verifies resolution)
cd ../agent-client && npm run register-ens

# 5. serve + run
cd ../resource-server && npm run dev        # :4021
cd ../agent-client && npm start             # planner loop → answer + total spent
```

Full check: `bash scripts/e2e.sh` from the repo root.

## Environment

| Var | Where | Purpose |
|---|---|---|
| `HEDERA_ACCOUNT_ID` / `HEDERA_PRIVATE_KEY` | both | portal account (operator + payer), ECDSA |
| `PAY_TO_ACCOUNT` | server | receiving account (T1.1) |
| `FACILITATOR_URL` | server | Blocky402 testnet (no `/v1` suffix) |
| `GRAPH_API_KEY` / `AAVE_V3_SUBGRAPH_ID` | server | The Graph gateway + Aave V3 Ethereum |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | agent | OpenAI-compatible planner endpoint |
| `ENS_AGENT_NAME` | both | agent name, e.g. `toll-agent-chad.eth` |
| `SEPOLIA_PRIVATE_KEY` / `SEPOLIA_RPC_URL` | agent | ENS registration wallet |

## Track fit

- **Hedera — AI & Agentic Payments.** Real machine-to-machine HBAR payments per query,
  settled by Blocky402 on `hedera:testnet` (verify any `transaction` on HashScan testnet).
  Money path: `agent-client/src/index.ts` (signer + `wrapFetchWithPaymentFromConfig`),
  server paywall: `resource-server/src/index.ts` (`paymentMiddleware` + `ExactHederaScheme`).
- **The Graph — Best AI Tooling / AI Use Case.** Live Aave V3 data is inside the agent's
  reasoning loop, acquired incrementally over multiple paid queries — not a backend DB.
  See `resource-server/src/subgraph.ts` and the planner loop in `agent-client/src/planner.ts`.
- **ENS — Best Use of ENSv2.** The name's records ARE the spending policy, enforced at
  payment time — identity → policy → autonomy. See `resource-server/src/ens-policy.ts`,
  `agent-client/scripts/register-ens.ts` (`update-policy.ts` drives the demo beat).
