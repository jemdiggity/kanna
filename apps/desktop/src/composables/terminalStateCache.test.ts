import { describe, expect, it, beforeEach } from "vitest";
import {
  clearCachedTerminalState,
  loadCachedTerminalState,
  saveCachedTerminalState,
} from "./terminalStateCache";

describe("terminalStateCache", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips serialized terminal state by session id", () => {
    saveCachedTerminalState("task-1", {
      serialized: "\u001b[2Jhello",
      cols: 120,
      rows: 40,
      savedAt: 123,
    });

    expect(loadCachedTerminalState("task-1")).toEqual({
      serialized: "\u001b[2Jhello",
      cols: 120,
      rows: 40,
      savedAt: 123,
    });
  });

  it("returns null for missing or malformed entries", () => {
    localStorage.setItem("kanna:terminal-state:task-2", "{bad json");

    expect(loadCachedTerminalState("missing")).toBeNull();
    expect(loadCachedTerminalState("task-2")).toBeNull();
  });

  it("removes cached state by session id", () => {
    saveCachedTerminalState("task-3", {
      serialized: "cached",
      cols: 80,
      rows: 24,
      savedAt: 456,
    });

    clearCachedTerminalState("task-3");

    expect(loadCachedTerminalState("task-3")).toBeNull();
  });
});
