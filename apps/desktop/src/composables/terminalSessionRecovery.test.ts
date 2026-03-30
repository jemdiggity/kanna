import { describe, expect, it } from "vitest";
import {
  shouldDelayConnectUntilAfterInitialLayout,
  formatAttachFailureMessage,
  getTerminalRecoveryMode,
  getReconnectRedrawPolicy,
  shouldSkipReconnect,
  shouldForceDoubleResizeOnReconnect,
  shouldReattachOnDaemonReady,
} from "./terminalSessionRecovery";

describe("getTerminalRecoveryMode", () => {
  const spawnFn = async () => {};

  it("uses attach-only recovery for task PTY terminals", () => {
    expect(
      getTerminalRecoveryMode(
        { cwd: "/tmp/task", prompt: "do work", spawnFn },
        { agentProvider: "claude", worktreePath: "/tmp/task" },
      )
    ).toBe("attach-only");
  });

  it("uses spawn-on-missing recovery for shell terminals", () => {
    expect(
      getTerminalRecoveryMode(
        { cwd: "/tmp/repo", prompt: "", spawnFn },
        undefined,
      )
    ).toBe("spawn-on-missing");
  });
});

describe("formatAttachFailureMessage", () => {
  it("surfaces a visible reconnect failure for task terminals", () => {
    const message = formatAttachFailureMessage("session not found");
    expect(message).toContain("Failed to reconnect");
    expect(message).toContain("session not found");
  });
});

describe("shouldReattachOnDaemonReady", () => {
  const spawnFn = async () => {};

  it("re-attaches mounted task PTY terminals after daemon restart", () => {
    expect(
      shouldReattachOnDaemonReady(
        { cwd: "/tmp/task", prompt: "do work", spawnFn },
        { agentProvider: "copilot", worktreePath: "/tmp/task" },
      )
    ).toBe(true);
  });

  it("does not re-attach shell terminals after daemon restart", () => {
    expect(
      shouldReattachOnDaemonReady(
        { cwd: "/tmp/repo", prompt: "", spawnFn },
        undefined,
      )
    ).toBe(false);
  });
});

describe("shouldForceDoubleResizeOnReconnect", () => {
  it("forces double resize churn for Claude reconnects", () => {
    expect(shouldForceDoubleResizeOnReconnect({ agentProvider: "claude" })).toBe(true);
  });

  it("defaults to no forced double resize for other providers", () => {
    expect(shouldForceDoubleResizeOnReconnect({ agentProvider: "copilot" })).toBe(false);
    expect(shouldForceDoubleResizeOnReconnect({ agentProvider: "codex" })).toBe(false);
    expect(shouldForceDoubleResizeOnReconnect()).toBe(false);
  });
});

describe("shouldSkipReconnect", () => {
  it("skips reconnect when an attach is already in flight", () => {
    expect(shouldSkipReconnect(true, false)).toBe(true);
  });

  it("skips reconnect for already attached task terminals", () => {
    expect(shouldSkipReconnect(false, true)).toBe(true);
  });

  it("allows reconnect when not attached and no attach is in flight", () => {
    expect(shouldSkipReconnect(false, false)).toBe(false);
  });
});

describe("shouldDelayConnectUntilAfterInitialLayout", () => {
  const spawnFn = async () => {};

  it("waits for initial layout before connecting task PTY terminals", () => {
    expect(
      shouldDelayConnectUntilAfterInitialLayout(
        { cwd: "/tmp/task", prompt: "do work", spawnFn },
        { agentProvider: "claude", worktreePath: "/tmp/task" },
      )
    ).toBe(true);
  });

  it("does not delay shell terminal connection", () => {
    expect(
      shouldDelayConnectUntilAfterInitialLayout(
        { cwd: "/tmp/repo", prompt: "", spawnFn },
        undefined,
      )
    ).toBe(false);
  });
});

describe("getReconnectRedrawPolicy", () => {
  it("waits for Claude idle, then delays briefly, with a fallback timeout", () => {
    expect(getReconnectRedrawPolicy({ agentProvider: "claude" })).toEqual({
      waitForIdleEvent: "ClaudeIdle",
      settleDelayMs: 200,
      fallbackDelayMs: 2000,
    });
  });

  it("uses immediate redraw policy for other providers", () => {
    expect(getReconnectRedrawPolicy({ agentProvider: "codex" })).toEqual({
      waitForIdleEvent: null,
      settleDelayMs: 0,
      fallbackDelayMs: 0,
    });
  });
});
