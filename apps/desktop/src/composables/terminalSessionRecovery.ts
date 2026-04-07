import type { SpawnOptions, TerminalOptions } from "./useTerminal";

export type TerminalRecoveryMode = "attach-only" | "spawn-on-missing";
export interface ReconnectRedrawPolicy {
  waitForIdleEvent: string | null;
  settleDelayMs: number;
  fallbackDelayMs: number;
}

export interface TaskTerminalEnv {
  TERM: string;
  COLORTERM?: string;
  TERM_PROGRAM?: string;
}

export interface TaskShellCommandOptions {
  kannaCliPath?: string;
}

export interface TerminalGeometry {
  cols: number;
  rows: number;
}

const DAEMON_HANDOFF_FAILURE_PREFIX = "session lost during daemon handoff:";

export function isMissingDaemonSessionFailure(message: string): boolean {
  return message.includes("session not found");
}

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
  return options?.agentProvider === "claude";
}

export function shouldSupportKittyKeyboard(options?: TerminalOptions): boolean {
  return !!options?.agentProvider;
}

export function shouldPushKittyKeyboardOnFreshAttach(_options?: TerminalOptions): boolean {
  return false;
}

export function shouldResetTerminalOnReconnect(options?: TerminalOptions): boolean {
  return options?.agentProvider !== "codex";
}

export function getReconnectKeyboardPush(_options?: TerminalOptions): string | null {
  return null;
}

export function getTaskTerminalEnv(agentProvider?: string): TaskTerminalEnv {
  void agentProvider;
  return {
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "kanna",
  };
}

export function getShellTerminalEnv(): TaskTerminalEnv {
  return {
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "kanna",
  };
}

function shellSingleQuote(value: string): string {
  return value.replace(/'/g, "'\\''");
}

function directoryName(path: string): string | null {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash <= 0) return null;
  return path.slice(0, lastSlash);
}

export function buildTaskShellCommand(
  agentCmd: string,
  setupCmds: string[],
  options?: TaskShellCommandOptions,
): string {
  const preludeParts: string[] = [];
  if (options?.kannaCliPath) {
    const quotedCliPath = shellSingleQuote(options.kannaCliPath);
    preludeParts.push(`export KANNA_CLI_PATH='${quotedCliPath}'`);

    const cliDir = directoryName(options.kannaCliPath);
    if (cliDir) {
      preludeParts.push(`export PATH='${shellSingleQuote(cliDir)}':\"$PATH\"`);
    }
  }

  const setupParts = setupCmds.map((cmd) => {
    const escaped = shellSingleQuote(cmd);
    return `printf '\\033[2m$ %s\\033[0m\\n' '${escaped}' && ${cmd}`;
  });

  const commandParts: string[] = [];
  if (preludeParts.length > 0) {
    commandParts.push(preludeParts.join(" && "));
  }
  if (setupParts.length > 0) {
    commandParts.push(`printf '\\033[33mRunning startup...\\033[0m\\n' && ${setupParts.join(" && ")} && printf '\\n'`);
  }
  commandParts.push(agentCmd);

  return commandParts.join(" && ");
}

export function formatAttachFailureMessage(message: string): string {
  return `\r\n\x1b[31mFailed to reconnect to existing session: ${message}\x1b[0m\r\n`;
}

export function isDaemonHandoffFailure(message: string): boolean {
  return message.startsWith(DAEMON_HANDOFF_FAILURE_PREFIX);
}

export function shouldRespawnAfterAttachFailure(
  message: string,
  hasAttachedOnce: boolean,
  spawnOptions?: SpawnOptions,
  options?: TerminalOptions,
): boolean {
  if (!hasAttachedOnce && isMissingDaemonSessionFailure(message)) {
    return false;
  }
  return (
    getTerminalRecoveryMode(spawnOptions, options) === "attach-only" &&
    (isDaemonHandoffFailure(message) || isMissingDaemonSessionFailure(message))
  );
}

export function getReconnectResizeDelayMs(_options?: TerminalOptions): number {
  return 0;
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
