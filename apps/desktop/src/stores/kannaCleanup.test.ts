import { describe, expect, it } from "bun:test";
import {
  closePipelineItemAndClearCachedTerminalState,
  isTeardownSessionId,
  isMissingDaemonSessionError,
  isSessionAlreadyExistsError,
  reportCloseSessionError,
  reportPrewarmSessionError,
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

  it("treats missing daemon sessions as idempotent close errors", () => {
    expect(isMissingDaemonSessionError(new Error("session not found: abc123"))).toBe(true);
    expect(isMissingDaemonSessionError("session not found: abc123")).toBe(true);
    expect(isMissingDaemonSessionError(new Error("permission denied"))).toBe(false);
  });

  it("treats existing sessions as idempotent prewarm errors", () => {
    expect(isSessionAlreadyExistsError(new Error("session already exists: shell-wt-abc123"))).toBe(true);
    expect(isSessionAlreadyExistsError("session already exists: shell-wt-abc123")).toBe(true);
    expect(isSessionAlreadyExistsError(new Error("permission denied"))).toBe(false);
  });

  it("suppresses logging for missing daemon sessions during close", () => {
    const calls: unknown[][] = [];
    const logger = (...args: unknown[]) => {
      calls.push(args);
    };

    reportCloseSessionError("[store] kill agent session failed:", new Error("session not found: abc123"), logger);
    reportCloseSessionError("[store] kill agent session failed:", new Error("permission denied"), logger);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("[store] kill agent session failed:");
    expect(calls[0]?.[1]).toBeInstanceOf(Error);
    expect((calls[0]?.[1] as Error).message).toBe("permission denied");
  });

  it("suppresses logging for existing sessions during prewarm", () => {
    const calls: unknown[][] = [];
    const logger = (...args: unknown[]) => {
      calls.push(args);
    };

    reportPrewarmSessionError("[store] shell pre-warm failed:", new Error("session already exists: shell-wt-abc123"), logger);
    reportPrewarmSessionError("[store] shell pre-warm failed:", new Error("permission denied"), logger);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("[store] shell pre-warm failed:");
    expect(calls[0]?.[1]).toBeInstanceOf(Error);
    expect((calls[0]?.[1] as Error).message).toBe("permission denied");
  });
});
