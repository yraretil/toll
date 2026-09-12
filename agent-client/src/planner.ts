// LLM planner (T4.1). Decides which paid datasets to buy next.
// The LLM never signs and never touches money: it outputs strict JSON,
// and a deterministic x402 purchase function executes approved buys.

export type PlannerAction = "snapshot" | "history" | "deep-dive" | "price" | "recommend";

export interface PlannerDecision {
  action: PlannerAction;
  reason: string;
  /** Optional market symbol for symbol-aware tools (deep-dive, history). */
  symbol?: MarketSymbol;
}

export type MarketSymbol = "USDC" | "DAI" | "USDT";

const SYMBOLS: MarketSymbol[] = ["USDC", "DAI", "USDT"];

const ACTIONS: PlannerAction[] = ["snapshot", "history", "deep-dive", "price", "recommend"];

export const MAX_PURCHASES = 4;
const MAX_PARSE_RETRIES = 2;

export function parseDecision(raw: string): PlannerDecision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`planner output is not JSON: ${raw.slice(0, 200)}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("planner output must be a JSON object");
  }
  const { action, reason, symbol } = parsed as Record<string, unknown>;
  if (typeof action !== "string" || !(ACTIONS as string[]).includes(action)) {
    throw new Error(`invalid action: ${String(action)}`);
  }
  if (typeof reason !== "string" || reason.length === 0) {
    throw new Error("planner output must include a non-empty reason");
  }
  let normalizedSymbol: MarketSymbol | undefined;
  if (symbol !== undefined) {
    if (typeof symbol !== "string" || !(SYMBOLS as string[]).includes(symbol.toUpperCase())) {
      throw new Error(`invalid symbol: ${String(symbol)} (want one of ${SYMBOLS.join(",")})`);
    }
    normalizedSymbol = symbol.toUpperCase() as MarketSymbol;
  }
  return { action: action as PlannerAction, reason, symbol: normalizedSymbol };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type LlmCall = (messages: ChatMessage[]) => Promise<string>;

export interface ToolSpec {
  /** Path template; {symbol} is substituted when the tool takes a symbol. */
  path: string;
  priceTinybar: number;
  /** Default symbol when the decision omits one (undefined = tool takes no symbol). */
  defaultSymbol?: MarketSymbol;
}

export function pathFor(spec: ToolSpec, symbol?: MarketSymbol): string {
  const sym = symbol ?? spec.defaultSymbol;
  if (sym && spec.path.includes("{symbol}")) return spec.path.replace("{symbol}", sym);
  return spec.path;
}

export type PurchaseFn = (
  tool: string,
  path: string,
) => Promise<{ settlement: unknown; body: unknown }>;

export interface Purchase {
  tool: string;
  path: string;
  symbol?: MarketSymbol;
  amountTinybar: number;
  body: unknown;
}

export interface PlannerResult {
  answer: string;
  totalSpentTinybar: number;
  purchases: Purchase[];
  stopped: string | null;
}

function systemPrompt(
  task: string,
  budgetTinybar: number,
  tools: Record<string, ToolSpec>,
): string {
  const catalog = Object.entries(tools)
    .map(([name, spec]) => {
      const symbols = spec.defaultSymbol ? ` (symbols: ${SYMBOLS.join(",")})` : "";
      return `- ${name}: ${spec.path}${symbols} (price ${spec.priceTinybar} tinybar)`;
    })
    .join("\n");
  return [
    `You are Toll, an AI agent that buys live on-chain data to answer: "${task}".`,
    `You have a budget of ${budgetTinybar} tinybar (1 HBAR = 100000000 tinybar).`,
    "Purchasable datasets:",
    catalog,
    'Reply with STRICT JSON only: {"action": "snapshot" | "history" | "deep-dive" | "price" | "recommend", "reason": "string", "symbol": "optional USDC|DAI|USDT for history/deep-dive/price"}.',
    'Choose "recommend" with your final grounded answer in `reason` when you have enough data.',
    'If the task needs no market data (a greeting, chit-chat, or anything off-topic), choose "recommend" immediately with a brief reply — never buy data you do not need.',
    'If the task asks only for a token price, buy "price" for that symbol directly — do not buy lending datasets first.',
    'Stop the moment the task is answered: never gather extra context beyond what was asked.',
    'Example — task "what is the USDC dollar price right now": first',
    '{"action":"price","reason":"need current USDC price","symbol":"USDC"}, then',
    '{"action":"recommend","reason":"USDC is $1.00"} — done, 200000 tinybar total.',
  ].join("\n");
}

export type PlannerEvent =
  | { type: "decision"; decision: PlannerDecision }
  | { type: "purchase"; purchase: Purchase; spentTinybar: number }
  | { type: "stopped"; reason: string }
  | { type: "answer"; answer: string };

export async function runPlannerLoop(opts: {
  task: string;
  budgetTinybar: number;
  tools: Record<string, ToolSpec>;
  llmCall: LlmCall;
  purchase: PurchaseFn;
  maxPurchases?: number;
  onEvent?: (event: PlannerEvent) => void;
}): Promise<PlannerResult> {
  const maxPurchases = opts.maxPurchases ?? MAX_PURCHASES;
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(opts.task, opts.budgetTinybar, opts.tools) },
    { role: "user", content: `Task: ${opts.task}. What do you buy first?` },
  ];
  const purchases: Purchase[] = [];
  let spent = 0;
  let parseFailures = 0;

  for (;;) {
    const raw = await opts.llmCall(messages);
    let decision: PlannerDecision;
    try {
      decision = parseDecision(raw);
    } catch (err) {
      parseFailures += 1;
      if (parseFailures > MAX_PARSE_RETRIES) {
        const reason = `stopped: LLM output malformed ${parseFailures} times (${String(err)})`;
        opts.onEvent?.({ type: "stopped", reason });
        return { answer: "", totalSpentTinybar: spent, purchases, stopped: reason };
      }
      messages.push({ role: "assistant", content: raw });
      messages.push({
        role: "user",
        content: `That was not valid. ${String(err)}. Reply with strict JSON only.`,
      });
      continue;
    }
    parseFailures = 0;
    messages.push({ role: "assistant", content: raw });
    opts.onEvent?.({ type: "decision", decision });

    if (decision.action === "recommend") {
      opts.onEvent?.({ type: "answer", answer: decision.reason });
      return { answer: decision.reason, totalSpentTinybar: spent, purchases, stopped: null };
    }
    if (purchases.length >= maxPurchases) {
      const reason = `stopped: purchase cap (${maxPurchases}) reached`;
      opts.onEvent?.({ type: "stopped", reason });
      return { answer: "", totalSpentTinybar: spent, purchases, stopped: reason };
    }
    const spec = opts.tools[decision.action];
    if (!spec) {
      const reason = `stopped: tool not offered: ${decision.action}`;
      opts.onEvent?.({ type: "stopped", reason });
      return { answer: "", totalSpentTinybar: spent, purchases, stopped: reason };
    }
    if (spent + spec.priceTinybar > opts.budgetTinybar) {
      const reason =
        `stopped: budget exceeded (spent ${spent}, ` +
        `${decision.action} costs ${spec.priceTinybar}, budget ${opts.budgetTinybar})`;
      opts.onEvent?.({ type: "stopped", reason });
      return { answer: "", totalSpentTinybar: spent, purchases, stopped: reason };
    }
    let body: unknown;
    try {
      ({ body } = await opts.purchase(decision.action, pathFor(spec, decision.symbol)));
    } catch (err) {
      // Rejected pre-payment (no settlement, no spend): stop with the reason.
      const reason = `stopped: purchase failed (${String(err)})`;
      opts.onEvent?.({ type: "stopped", reason });
      return { answer: "", totalSpentTinybar: spent, purchases, stopped: reason };
    }
    spent += spec.priceTinybar;
    purchases.push({
      tool: decision.action,
      path: pathFor(spec, decision.symbol),
      symbol: decision.symbol ?? spec.defaultSymbol,
      amountTinybar: spec.priceTinybar,
      body,
    });
    opts.onEvent?.({
      type: "purchase",
      purchase: purchases[purchases.length - 1],
      spentTinybar: spent,
    });
    messages.push({
      role: "user",
      content:
        `Purchased ${decision.action}${decision.symbol ? ` (${decision.symbol})` : ""} ` +
        `for ${spec.priceTinybar} tinybar ` +
        `(spent ${spent}/${opts.budgetTinybar}). Result: ${JSON.stringify(body).slice(0, 2000)}` +
        ` What next?`,
    });
  }
}

/** OpenAI-compatible chat-completions call (Groq, OpenAI, OpenRouter, local, ...). */
export function makeLlmCall(baseUrl: string, apiKey: string, model: string): LlmCall {
  return async (messages: ChatMessage[]) => {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM returned no content");
    return content;
  };
}
