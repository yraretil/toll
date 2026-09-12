import { describe, expect, it } from "vitest";
import { cycleHistory, pushHistory } from "./history.js";

describe("pushHistory", () => {
  it("appends and drops consecutive duplicates", () => {
    expect(pushHistory([], "  ")).toEqual([]);
    expect(pushHistory([], "a")).toEqual(["a"]);
    expect(pushHistory(["a"], "a")).toEqual(["a"]);
    expect(pushHistory(["a"], "b")).toEqual(["a", "b"]);
  });
});

describe("cycleHistory", () => {
  const history = ["first", "second"];
  it("walks up to older entries and down back to the draft", () => {
    let s = cycleHistory(history, "draft", 2, "up");
    expect(s).toEqual({ value: "second", index: 1 });
    s = cycleHistory(history, "draft", s.index, "up");
    expect(s).toEqual({ value: "first", index: 0 });
    s = cycleHistory(history, "draft", s.index, "up");
    expect(s).toEqual({ value: "first", index: 0 });
    s = cycleHistory(history, "draft", s.index, "down");
    expect(s).toEqual({ value: "second", index: 1 });
    s = cycleHistory(history, "draft", s.index, "down");
    expect(s).toEqual({ value: "draft", index: 2 });
  });

  it("no-ops on empty history", () => {
    expect(cycleHistory([], "draft", 0, "up")).toEqual({ value: "draft", index: 0 });
  });
});
