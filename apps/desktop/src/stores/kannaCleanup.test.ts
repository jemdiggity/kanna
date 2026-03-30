import { describe, expect, it } from "bun:test";
import {
  closePipelineItemAndClearCachedTerminalState,
  isTeardownSessionId,
  shouldClearCachedTerminalStateOnSessionExit,
} from "./kannaCleanup";

describe("kannaCleanup", () => {
  it("ignores teardown sessions for cache clearing", () => {
    expect(isTeardownSessionId("td-task-1")).toBe(true);
    expect(shouldClearCachedTerminalStateOnSessionExit("td-task-1")).toBe(false);
    expect(shouldClearCachedTerminalStateOnSessionExit("task-1")).toBe(true);
  });

  it("clears cached state only after a successful close", async () => {
    const calls: string[] = [];

    await closePipelineItemAndClearCachedTerminalState(
      "task-2",
      async (itemId) => {
        calls.push(`close:${itemId}`);
      },
      (sessionId) => {
        calls.push(`clear:${sessionId}`);
      },
    );

    expect(calls).toEqual(["close:task-2", "clear:task-2"]);
  });

  it("does not clear cached state when close fails", async () => {
    const calls: string[] = [];

    await expect(
      closePipelineItemAndClearCachedTerminalState(
        "task-3",
        async (itemId) => {
          calls.push(`close:${itemId}`);
          throw new Error("boom");
        },
        (sessionId) => {
          calls.push(`clear:${sessionId}`);
        },
      ),
    ).rejects.toThrow("boom");

    expect(calls).toEqual(["close:task-3"]);
  });
});
