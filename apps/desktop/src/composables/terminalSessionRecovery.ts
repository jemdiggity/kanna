import type { SpawnOptions, TerminalOptions } from "./useTerminal";

export type TerminalRecoveryMode = "attach-only" | "spawn-on-missing";
export interface ReconnectRedrawPolicy {
  waitForIdleEvent: string | null;
  settleDelayMs: number;
  fallbackDelayMs: number;
}

export interface TaskTerminalEnv {
  TERM: string;
  TERM_PROGRAM?: string;
}

export interface TerminalGeometry {
  cols: number;
  rows: number;
}

const DAEMON_HANDOFF_FAILURE_PREFIX = "session lost during daemon handoff:";

export function getTerminalRecoveryMode(
  spawnOptions?: SpawnOptions,
  options?: TerminalOptions,
): TerminalRecoveryMode {
  const isTaskTerminal = !!spawnOptions && !!options?.worktreePath && !!options?.agentProvider;
  return isTaskTerminal ? "attach-only" : "spawn-on-missing";
}

export function shouldReattachOnDaemonReady(
  spawnOptions?: SpawnOptions,
  _options?: TerminalOptions,
): boolean {
  return !!spawnOptions;
}

export function shouldDelayConnectUntilAfterInitialLayout(
  spawnOptions?: SpawnOptions,
  options?: TerminalOptions,
): boolean {
  return getTerminalRecoveryMode(spawnOptions, options) === "attach-only";
}

export function shouldRestoreRecoveryState(
  spawnOptions?: SpawnOptions,
  _options?: TerminalOptions,
): boolean {
  return !!spawnOptions;
}

export function shouldRunTerminalDispose(alreadyDisposed: boolean): boolean {
  return !alreadyDisposed;
}

export function shouldEnableKittyKeyboard(options?: TerminalOptions): boolean {
  return !!options?.agentProvider && options.agentProvider !== "codex";
}

export function shouldSupportKittyKeyboard(options?: TerminalOptions): boolean {
  return !!options?.agentProvider;
}

export function shouldPushKittyKeyboardOnFreshAttach(options?: TerminalOptions): boolean {
  return options?.agentProvider === "claude";
}

export function shouldResetTerminalOnReconnect(options?: TerminalOptions): boolean {
  return options?.agentProvider !== "codex";
}

export function getReconnectKeyboardPush(options?: TerminalOptions): string | null {
  if (options?.agentProvider === "codex") {
    return "\x1b[>1u";
  }
  if (options?.kittyKeyboard) {
    return "\x1b[>1u";
  }
  return null;
}

export function getTaskTerminalEnv(agentProvider?: string): TaskTerminalEnv {
  if (agentProvider === "codex") {
    return { TERM: "xterm-256color" };
  }
  return { TERM: "xterm-256color", TERM_PROGRAM: "vscode" };
}

export function formatAttachFailureMessage(message: string): string {
  return `\r\n\x1b[31mFailed to reconnect to existing session: ${message}\x1b[0m\r\n`;
}

export function isDaemonHandoffFailure(message: string): boolean {
  return message.startsWith(DAEMON_HANDOFF_FAILURE_PREFIX);
}

export function shouldRespawnAfterAttachFailure(
  message: string,
  spawnOptions?: SpawnOptions,
  options?: TerminalOptions,
): boolean {
  return (
    getTerminalRecoveryMode(spawnOptions, options) === "attach-only" &&
    isDaemonHandoffFailure(message)
  );
}

export function shouldForceDoubleResizeOnReconnect(_options?: TerminalOptions): boolean {
  return _options?.agentProvider === "claude";
}

export function shouldSkipReconnect(connecting: boolean, attached: boolean): boolean {
  return connecting || attached;
}

export function getReconnectRedrawPolicy(options?: TerminalOptions): ReconnectRedrawPolicy {
  if (options?.agentProvider === "claude") {
    return {
      waitForIdleEvent: "ClaudeIdle",
      settleDelayMs: 200,
      fallbackDelayMs: 2000,
    };
  }
  return {
    waitForIdleEvent: null,
    settleDelayMs: 0,
    fallbackDelayMs: 0,
  };
}
