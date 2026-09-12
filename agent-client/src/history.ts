// Session prompt history (up/down recall in the TUI task box).
// Pure logic kept separate so it stays unit-testable.

/** Append a task, dropping consecutive duplicates, capping length. */
export function pushHistory(history: string[], task: string, cap = 50): string[] {
  const trimmed = task.trim();
  if (!trimmed) return history;
  const next = [...history];
  if (next[next.length - 1] !== trimmed) next.push(trimmed);
  return next.slice(-cap);
}

export interface CycleState {
  value: string;
  index: number;
}

/**
 * Step through history. `index` is the cursor: history.length means
 * "fresh line" (draft). Returns the visible value + new cursor.
 */
export function cycleHistory(
  history: string[],
  draft: string,
  index: number,
  direction: "up" | "down",
): CycleState {
  if (history.length === 0) return { value: draft, index };
  if (direction === "up") {
    const next = Math.max(0, Math.min(index, history.length) - 1);
    return { value: history[next], index: next };
  }
  const next = Math.min(index + 1, history.length);
  return { value: next === history.length ? draft : history[next], index: next };
}
