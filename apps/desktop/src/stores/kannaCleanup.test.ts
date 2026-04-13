import { describe, expect, it } from "vitest";
import {
  closePipelineItemAndClearCachedTerminalState,
  getTaskIdFromTeardownSessionId,
  isTeardownSessionId,
  isMissingDaemonSessionError,
  isSessionAlreadyExistsError,
  reportCloseSessionError,
  reportPrewarmSessionError,
  shouldAutoCloseTaskAfterTeardownExit,
  shouldAutoCloseTaskImmediatelyAfterEnteringTeardown,
  shouldClearCachedTerminalStateOnSessionExit,
} from "./kannaCleanup";
import { AppError } from "../appError";

describe("kannaCleanup", () => {
  it("ignores teardown sessions for cache clearing", () => {
    expect(isTeardownSessionId("td-task-1")).toBe(true);
    expect(shouldClearCachedTerminalStateOnSessionExit("td-task-1")).toBe(false);
    expect(shouldClearCachedTerminalStateOnSessionExit("task-1")).toBe(true);
  });

  it("extracts the task id from teardown session ids", () => {
    expect(getTaskIdFromTeardownSessionId("td-task-1")).toBe("task-1");
    expect(getTaskIdFromTeardownSessionId("task-1")).toBeNull();
    expect(getTaskIdFromTeardownSessionId("td-")).toBeNull();
  });

  it("auto-closes tasks after successful teardown when linger is disabled", () => {
    expect(shouldAutoCloseTaskAfterTeardownExit({ exitCode: 0, lingerEnabled: false })).toBe(true);
  });

  it("keeps tasks in teardown when linger is enabled", () => {
    expect(shouldAutoCloseTaskAfterTeardownExit({ exitCode: 0, lingerEnabled: true })).toBe(false);
  });

  it("keeps tasks in teardown when teardown exits with an error", () => {
    expect(shouldAutoCloseTaskAfterTeardownExit({ exitCode: 1, lingerEnabled: false })).toBe(false);
  });

  it("auto-closes immediately when entering teardown with no teardown commands and linger disabled", () => {
    expect(
      shouldAutoCloseTaskImmediatelyAfterEnteringTeardown({
        teardownCommandCount: 0,
        lingerEnabled: false,
      }),
    ).toBe(true);
  });

  it("does not auto-close immediately when teardown commands exist", () => {
    expect(
      shouldAutoCloseTaskImmediatelyAfterEnteringTeardown({
        teardownCommandCount: 1,
        lingerEnabled: false,
      }),
    ).toBe(false);
  });

  it("does not auto-close immediately when linger is enabled", () => {
    expect(
      shouldAutoCloseTaskImmediatelyAfterEnteringTeardown({
        teardownCommandCount: 0,
        lingerEnabled: true,
      }),
    ).toBe(false);
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
    expect(isMissingDaemonSessionError(new AppError("session not found: abc123", "session_not_found"))).toBe(true);
    expect(isMissingDaemonSessionError(new Error("permission denied"))).toBe(false);
  });

  it("treats existing sessions as idempotent prewarm errors", () => {
    expect(isSessionAlreadyExistsError(new AppError("session already exists: shell-wt-abc123", "session_already_exists"))).toBe(true);
    expect(isSessionAlreadyExistsError(new Error("permission denied"))).toBe(false);
  });

  it("suppresses logging for missing daemon sessions during close", () => {
    const calls: unknown[][] = [];
    const logger = (...args: unknown[]) => {
      calls.push(args);
    };

    reportCloseSessionError("[store] kill agent session failed:", new AppError("session not found: abc123", "session_not_found"), logger);
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

    reportPrewarmSessionError("[store] shell pre-warm failed:", new AppError("session already exists: shell-wt-abc123", "session_already_exists"), logger);
    reportPrewarmSessionError("[store] shell pre-warm failed:", new Error("permission denied"), logger);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("[store] shell pre-warm failed:");
    expect(calls[0]?.[1]).toBeInstanceOf(Error);
    expect((calls[0]?.[1] as Error).message).toBe("permission denied");
  });
});
