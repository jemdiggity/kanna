import { describe, expect, it } from "vitest";
import {
  shouldDelayConnectUntilAfterInitialLayout,
  formatAttachFailureMessage,
  getTaskTerminalEnv,
  getTerminalRecoveryMode,
  getReconnectRedrawPolicy,
  getReconnectKeyboardPush,
  shouldPersistTerminalStateOnUnmount,
  shouldEnableKittyKeyboard,
  shouldPushKittyKeyboardOnFreshAttach,
  shouldRestoreCachedTerminalState,
  shouldResetTerminalOnReconnect,
  shouldSupportKittyKeyboard,
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

describe("shouldRestoreCachedTerminalState", () => {
  it("restores cached state for attach-only task terminals", () => {
    expect(
      shouldRestoreCachedTerminalState(
        { cwd: "/tmp/task", prompt: "do work", spawnFn: async () => {} },
        { agentProvider: "codex", worktreePath: "/tmp/task" },
      )
    ).toBe(true);
  });

  it("does not restore cached state for shell terminals", () => {
    expect(
      shouldRestoreCachedTerminalState(
        { cwd: "/tmp/repo", prompt: "", spawnFn: async () => {} },
        undefined,
      )
    ).toBe(false);
  });
});

describe("shouldPersistTerminalStateOnUnmount", () => {
  it("persists state for attach-only task terminals", () => {
    expect(
      shouldPersistTerminalStateOnUnmount(
        { cwd: "/tmp/task", prompt: "do work", spawnFn: async () => {} },
        { agentProvider: "claude", worktreePath: "/tmp/task" },
      )
    ).toBe(true);
  });
});

describe("shouldEnableKittyKeyboard", () => {
  it("enables kitty keyboard for Claude and Copilot task terminals", () => {
    expect(shouldEnableKittyKeyboard({ agentProvider: "claude" })).toBe(true);
    expect(shouldEnableKittyKeyboard({ agentProvider: "copilot" })).toBe(true);
  });

  it("disables kitty keyboard for Codex and unknown providers", () => {
    expect(shouldEnableKittyKeyboard({ agentProvider: "codex" })).toBe(false);
    expect(shouldEnableKittyKeyboard()).toBe(false);
  });
});

describe("shouldSupportKittyKeyboard", () => {
  it("enables kitty keyboard protocol support for all agent task terminals", () => {
    expect(shouldSupportKittyKeyboard({ agentProvider: "claude" })).toBe(true);
    expect(shouldSupportKittyKeyboard({ agentProvider: "copilot" })).toBe(true);
    expect(shouldSupportKittyKeyboard({ agentProvider: "codex" })).toBe(true);
  });

  it("disables kitty keyboard protocol support when no provider is set", () => {
    expect(shouldSupportKittyKeyboard()).toBe(false);
  });
});

describe("shouldPushKittyKeyboardOnFreshAttach", () => {
  it("pushes kitty keyboard mode for fresh Claude sessions", () => {
    expect(shouldPushKittyKeyboardOnFreshAttach({ agentProvider: "claude" })).toBe(true);
  });

  it("does not push kitty keyboard mode for Copilot or Codex", () => {
    expect(shouldPushKittyKeyboardOnFreshAttach({ agentProvider: "copilot" })).toBe(false);
    expect(shouldPushKittyKeyboardOnFreshAttach({ agentProvider: "codex" })).toBe(false);
    expect(shouldPushKittyKeyboardOnFreshAttach()).toBe(false);
  });
});

describe("shouldResetTerminalOnReconnect", () => {
  it("keeps reset behavior for Claude and Copilot reconnects", () => {
    expect(shouldResetTerminalOnReconnect({ agentProvider: "claude" })).toBe(true);
    expect(shouldResetTerminalOnReconnect({ agentProvider: "copilot" })).toBe(true);
  });

  it("avoids resetting xterm state for Codex reconnects", () => {
    expect(shouldResetTerminalOnReconnect({ agentProvider: "codex" })).toBe(false);
  });
});

describe("getReconnectKeyboardPush", () => {
  it("re-pushes kitty keyboard mode for Codex reconnects", () => {
    expect(getReconnectKeyboardPush({ agentProvider: "codex" })).toBe("\x1b[>1u");
  });

  it("re-pushes kitty keyboard mode when kitty keyboard is enabled", () => {
    expect(getReconnectKeyboardPush({ agentProvider: "claude", kittyKeyboard: true })).toBe("\x1b[>1u");
    expect(getReconnectKeyboardPush({ agentProvider: "copilot", kittyKeyboard: true })).toBe("\x1b[>1u");
  });

  it("does not push keyboard mode when not needed", () => {
    expect(getReconnectKeyboardPush({ agentProvider: "copilot", kittyKeyboard: false })).toBe(null);
    expect(getReconnectKeyboardPush()).toBe(null);
  });
});

describe("getTaskTerminalEnv", () => {
  it("uses a plain xterm environment for Codex", () => {
    expect(getTaskTerminalEnv("codex")).toEqual({
      TERM: "xterm-256color",
    });
  });

  it("keeps the vscode terminal program hint for other providers", () => {
    expect(getTaskTerminalEnv("claude")).toEqual({
      TERM: "xterm-256color",
      TERM_PROGRAM: "vscode",
    });
    expect(getTaskTerminalEnv("copilot")).toEqual({
      TERM: "xterm-256color",
      TERM_PROGRAM: "vscode",
    });
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
