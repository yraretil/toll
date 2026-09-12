// Toll TUI: the demo surface. Same real planner loop + real x402 purchases
// as index.ts, rendered as a live story (Ink). Nothing here is replayed.
import "dotenv/config";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { makeLlmCall, runPlannerLoop, type PlannerResult } from "./planner.js";
import { createBuyer, type Settlement } from "./buyer.js";
import {
  hashscanUrl,
  loadIdentity,
  loadSpend,
  tinybarToHbar,
  fmtCompact,
  type AgentIdentity,
  type SpendStatus,
} from "./identity.js";
import { DEFAULT_TASK, TOOLS } from "./catalog.js";
import { cycleHistory, pushHistory } from "./history.js";
import { policyClients, setPolicyRecord } from "../scripts/policy.js";

const TIGHT_CAP = "100000";
const OPEN_CAP = "2000000";
const MAX_LINES = 24;

interface MarketLike {
  symbol?: unknown;
  supplyApyPct?: unknown;
  variableBorrowApyPct?: unknown;
  totalLiquidity?: unknown;
  utilizationPct?: unknown;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** One-line "what we learned" digest per purchase (safe against shape drift). */
function digest(tool: string, body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (tool === "snapshot" && Array.isArray(b.markets)) {
    const top = (b.markets as MarketLike[]).slice(0, 3).map((m) => {
      const apy = num(m.supplyApyPct);
      return `${String(m.symbol)} ${apy === null ? "?" : `${apy.toFixed(2)}%`}`;
    });
    return `learned — top: ${top.join(" · ")}`;
  }
  if (tool === "deep-dive" && typeof b.market === "object" && b.market !== null) {
    const m = b.market as MarketLike;
    const apy = num(m.supplyApyPct);
    const borrow = num(m.variableBorrowApyPct);
    const util = num(m.utilizationPct);
    const liq = num(m.totalLiquidity);
    return (
      `learned — ${String(m.symbol)} supply ${apy === null ? "?" : `${apy.toFixed(2)}%}`}` +
      ` · borrow ${borrow === null ? "?" : `${borrow.toFixed(2)}%}`} · util ` +
      `${util === null ? "?" : `${util.toFixed(1)}%}`} · liq ${liq === null ? "?" : fmtCompact(liq)}`
    );
  }
  if (tool === "price" && typeof b.price === "object" && b.price !== null) {
    const p = b.price as { symbol?: unknown; priceUsd?: unknown };
    const usd = num(p.priceUsd);
    return `learned — ${String(p.symbol)} ≈ $${usd === null ? "?" : usd.toFixed(4)}`;
  }
  if (tool === "risk-scan" && Array.isArray(b.risks)) {
    const risks = b.risks as { symbol?: unknown; flags?: unknown }[];
    if (risks.length === 0) return "learned — no flags: top markets look safe";
    return `learned — ${risks.length} flagged: ${risks
      .slice(0, 3)
      .map((r) => `${String(r.symbol)} (${Array.isArray(r.flags) ? r.flags.join(", ") : "?"})`)
      .join(" · ")}`;
  }
  if (tool === "history" && Array.isArray(b.history) && b.history.length > 0) {
    const last = b.history[b.history.length - 1] as MarketLike & { supplyApyPct?: unknown; utilizationPct?: unknown };
    const apy = num((last as { supplyApyPct?: unknown }).supplyApyPct);
    const util = num((last as { utilizationPct?: unknown }).utilizationPct);
    return `learned — ${String(b.symbol)} ${(b.history as unknown[]).length} pts · latest ${apy === null ? "?" : `${apy.toFixed(2)}%`} · util ${util === null ? "?" : `${util.toFixed(1)}%`}`;
  }
  return null;
}

function shortAddr(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
}

type Phase = "boot" | "idle" | "running" | "done";

function App(): React.JSX.Element {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>("boot");
  const [identity, setIdentity] = useState<AgentIdentity | null>(null);
  const [taskDraft, setTaskDraft] = useState(DEFAULT_TASK);
  const [lines, setLines] = useState<string[]>([]);
  const [result, setResult] = useState<PlannerResult | null>(null);
  const [tight, setTight] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(true);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(0);
  const [spend, setSpend] = useState<SpendStatus | null>(null);
  const runningRef = useRef(false);
  const draftRef = useRef<string | null>(null);

  const push = useCallback((line: string) => {
    setLines((prev) => [...prev.slice(-MAX_LINES + 1), line]);
  }, []);

  const refreshIdentity = useCallback(async () => {
    try {
      setIdentity(await loadIdentity());
    } catch (err) {
      push(`identity load failed: ${String(err)}`);
    }
    const serverUrl = process.env.RESOURCE_SERVER_URL ?? "http://localhost:4021";
    const payer = process.env.HEDERA_ACCOUNT_ID ?? "";
    if (payer) setSpend(await loadSpend(serverUrl, payer));
  }, [push]);

  useEffect(() => {
    void (async () => {
      await refreshIdentity();
      setPhase("idle");
    })();
  }, [refreshIdentity]);

  const run = useCallback(
    async (task: string) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setPhase("running");
      setResult(null);
      setLines([]);
      const nh = pushHistory(history, task);
      setHistory(nh);
      setHistIdx(nh.length);
      draftRef.current = null;
      try {
        const accountId = process.env.HEDERA_ACCOUNT_ID;
        const privateKey = process.env.HEDERA_PRIVATE_KEY;
        const serverUrl = process.env.RESOURCE_SERVER_URL ?? "http://localhost:4021";
        if (!accountId || !privateKey) throw new Error("HEDERA keys missing in .env");
        const llmKey = process.env.LLM_API_KEY ?? "";
        if (!llmKey) throw new Error("LLM_API_KEY missing in .env");
        const id = await loadIdentity();
        setIdentity(id);
        const spendNow = await loadSpend(serverUrl, accountId);
        setSpend(spendNow);
        const remaining = spendNow?.remainingTinybar ?? id.dailyCapTinybar;
        if (remaining <= 0) {
          const reason = `day budget exhausted on the server (spent ${spendNow?.spentTinybar}/${id.dailyCapTinybar}) — restart the server to reset the ledger, or raise spend.dailyCap`;
          push(reason);
          setResult({ answer: "", totalSpentTinybar: 0, purchases: [], stopped: reason });
          return;
        }
        const budget = Math.min(id.dailyCapTinybar, remaining);
        push(`task: ${task}`);
        push(`budget this run: ${budget} tinybar (cap ${id.dailyCapTinybar}, server has ${remaining} left)`);
        const purchase = createBuyer({
          serverUrl,
          accountId,
          privateKey,
          onSettlement: (_tool, _path, s: Settlement | null) => {
            push(s ? `  ↳ settled ${s.transaction}` : `  ↳ no settlement (rejected pre-payment)`);
            if (s) push(`    ${hashscanUrl(s.transaction)}`);
          },
        });
        const llmCall = makeLlmCall(
          process.env.LLM_BASE_URL ?? "https://api.groq.com/openai/v1",
          llmKey,
          process.env.LLM_MODEL ?? "openai/gpt-oss-120b",
        );
        const res = await runPlannerLoop({
          task,
          budgetTinybar: budget,
          tools: TOOLS,
          llmCall,
          purchase,
          onEvent: (e) => {
            if (e.type === "decision" && e.decision.action !== "recommend") {
              const sym = e.decision.symbol ? ` ${e.decision.symbol}` : "";
              push(`▸ planner wants ${e.decision.action}${sym} — ${e.decision.reason}`);
            } else if (e.type === "purchase") {
              push(`  ✓ bought ${e.purchase.tool} · ${e.purchase.amountTinybar} tinybar (spent ${e.spentTinybar})`);
              const d = digest(e.purchase.tool, e.purchase.body);
              if (d) push(`    ${d}`);
            } else if (e.type === "stopped") {
              push(`  ✕ ${e.reason}`);
            }
          },
        });
        setResult(res);
        push(`total spent: ${tinybarToHbar(res.totalSpentTinybar)} HBAR`);
      } catch (err) {
        push(`error: ${String(err)}`);
      } finally {
        runningRef.current = false;
        setPhase("done");
        const payer = process.env.HEDERA_ACCOUNT_ID ?? "";
        if (payer) {
          const serverUrl = process.env.RESOURCE_SERVER_URL ?? "http://localhost:4021";
          setSpend(await loadSpend(serverUrl, payer));
        }
      }
    },
    [push, history],
  );

  const toggleCap = useCallback(async () => {
    if (busy || runningRef.current) return;
    setBusy(true);
    try {
      const clients = await policyClients();
      const next = tight ? OPEN_CAP : TIGHT_CAP;
      const hash = await setPolicyRecord(clients, "spend.maxPerRequest", next);
      setTight(!tight);
      push(tight ? `policy restored: maxPerRequest=${next} (${hash.slice(0, 10)}…)` : `policy tightened: maxPerRequest=${next} (${hash.slice(0, 10)}…) — rerun to watch it stop`);
      await refreshIdentity();
    } catch (err) {
      push(`tighten failed (SEPOLIA key?): ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, tight, push, refreshIdentity]);

  useInput((input, key) => {
    if (key.escape) {
      setEditing(false);
      return;
    }
    // While editing, keystrokes go to the task box (Enter submits it,
    // ↑/↓ recall previous prompts).
    if (editing && phase === "idle" && !result) {
      if (key.upArrow || key.downArrow) {
        if (draftRef.current === null && key.upArrow) draftRef.current = taskDraft;
        const s = cycleHistory(
          history,
          draftRef.current ?? taskDraft,
          histIdx,
          key.upArrow ? "up" : "down",
        );
        setTaskDraft(s.value);
        setHistIdx(s.index);
        if (s.index === history.length) draftRef.current = null;
      }
      return;
    }
    if (input === "q") exit();
    if (phase === "done" && (input === "i" || key.return)) {
      setResult(null);
      setLines([]);
      setEditing(true);
      setPhase("idle");
      return;
    }
    if (phase !== "running" && input === "r" && result) void run(taskDraft);
    if (phase !== "running" && input === "t") void toggleCap();
    if (phase !== "running" && input === "i") setEditing(true);
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">
        Toll {identity ? `· ${identity.name}` : ""} {tight ? <Text color="red">[CAPS TIGHT]</Text> : ""}
      </Text>
      {phase === "boot" || !identity ? (
        <Text>
          <Spinner type="dots" /> loading identity + policy from Sepolia…
        </Text>
      ) : (
        <Box flexDirection="column">
          <Text dimColor>
            payer {identity.payerAccount} · {tinybarToHbar(identity.balanceTinybar)} HBAR ·{" "}
            {shortAddr(identity.address)}
          </Text>
          <Text dimColor>
            policy dailyCap {identity.dailyCapTinybar} · maxPerRequest{" "}
            {identity.maxPerRequestTinybar} · tools {identity.allowedTools} · {identity.riskTier}
          </Text>
          <Text dimColor>
            {spend
              ? `today ${fmtCompact(spend.spentTinybar)}/${fmtCompact(spend.dailyCapTinybar)} · left ${fmtCompact(spend.remainingTinybar)} tinybar (server day ledger, all runs)`
              : "today spend: server offline?"}
          </Text>
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        <Text bold>task</Text>
        {phase === "idle" && !result ? (
          <>
            <TextInput
              value={taskDraft}
              onChange={(v) => {
                setTaskDraft(v);
                draftRef.current = null;
                setHistIdx(history.length);
              }}
              onSubmit={(v) => void run(v)}
              focus={editing}
            />
            <Text dimColor>
              {editing
                ? "typing… (Enter: run · ↑/↓: history · Esc: commands)"
                : "commands ([i]: edit task)"}
            </Text>
          </>
        ) : (
          <Text>{taskDraft}</Text>
        )}
      </Box>
      <Box marginTop={1} flexDirection="column">
        {lines.map((l, i) => (
          <Text key={i} wrap="truncate">
            {l}
          </Text>
        ))}
        {phase === "running" && (
          <Text>
            <Spinner type="dots" /> working…
          </Text>
        )}
      </Box>
      {result?.answer ? (
        <Box marginTop={1} flexDirection="column">
          <Text bold>answer</Text>
          <Text wrap="wrap">{result.answer}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>
          [q]uit{result && phase !== "running" ? " · [r]erun" : ""}{" "}
          {phase !== "running" ? "· [t]ighten/restore caps" : ""}
          {phase === "done" ? " · [i]/[Enter] new prompt" : ""}
          {result ? ` · total ${tinybarToHbar(result.totalSpentTinybar)} HBAR` : ""}
        </Text>
      </Box>
      {busy ? (
        <Text>
          <Spinner type="dots" /> writing policy to Sepolia…
        </Text>
      ) : null}
    </Box>
  );
}

render(<App />);
