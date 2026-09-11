// LLM planner (T4.1). Decides which paid datasets to buy next.
// The LLM never signs and never touches money: it outputs strict JSON,
// and a deterministic x402 purchase function executes approved buys.

export type PlannerAction = "snapshot" | "history" | "deep-dive" | "recommend";

export interface PlannerDecision {
  action: PlannerAction;
  reason: string;
}

const ACTIONS: PlannerAction[] = ["snapshot", "history", "deep-dive", "recommend"];

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
  const { action, reason } = parsed as Record<string, unknown>;
  if (typeof action !== "string" || !(ACTIONS as string[]).includes(action)) {
    throw new Error(`invalid action: ${String(action)}`);
  }
  if (typeof reason !== "string" || reason.length === 0) {
    throw new Error("planner output must include a non-empty reason");
  }
  return { action: action as PlannerAction, reason };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type LlmCall = (messages: ChatMessage[]) => Promise<string>;

export interface ToolSpec {
  path: string;
  priceTinybar: number;
}

export type PurchaseFn = (
  tool: string,
  path: string,
) => Promise<{ settlement: unknown; body: unknown }>;

export interface Purchase {
  tool: string;
  path: string;
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
    .map(([name, spec]) => `- ${name}: ${spec.path} (price ${spec.priceTinybar} tinybar)`)
    .join("\n");
  return [
    `You are Toll, an AI agent that buys live on-chain data to answer: "${task}".`,
    `You have a budget of ${budgetTinybar} tinybar (1 HBAR = 100000000 tinybar).`,
    "Purchasable datasets:",
    catalog,
    'Reply with STRICT JSON only: {"action": "snapshot" | "history" | "deep-dive" | "recommend", "reason": "string"}.',
    'Choose "recommend" with your final grounded answer in `reason` when you have enough data.',
  ].join("\n");
}

export async function runPlannerLoop(opts: {
  task: string;
  budgetTinybar: number;
  tools: Record<string, ToolSpec>;
  llmCall: LlmCall;
  purchase: PurchaseFn;
  maxPurchases?: number;
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
        return {
          answer: "",
          totalSpentTinybar: spent,
          purchases,
          stopped: `stopped: LLM output malformed ${parseFailures} times (${String(err)})`,
        };
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

    if (decision.action === "recommend") {
      return { answer: decision.reason, totalSpentTinybar: spent, purchases, stopped: null };
    }
    if (purchases.length >= maxPurchases) {
      return {
        answer: "",
        totalSpentTinybar: spent,
        purchases,
        stopped: `stopped: purchase cap (${maxPurchases}) reached`,
      };
    }
    const spec = opts.tools[decision.action];
    if (!spec) {
      return {
        answer: "",
        totalSpentTinybar: spent,
        purchases,
        stopped: `stopped: tool not offered: ${decision.action}`,
      };
    }
    if (spent + spec.priceTinybar > opts.budgetTinybar) {
      return {
        answer: "",
        totalSpentTinybar: spent,
        purchases,
        stopped:
          `stopped: budget exceeded (spent ${spent}, ` +
          `${decision.action} costs ${spec.priceTinybar}, budget ${opts.budgetTinybar})`,
      };
    }
    const { body } = await opts.purchase(decision.action, spec.path);
    spent += spec.priceTinybar;
    purchases.push({
      tool: decision.action,
      path: spec.path,
      amountTinybar: spec.priceTinybar,
      body,
    });
    messages.push({
      role: "user",
      content:
        `Purchased ${decision.action} for ${spec.priceTinybar} tinybar ` +
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
