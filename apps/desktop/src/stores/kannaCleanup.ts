import { clearCachedTerminalState } from "../composables/terminalStateCache";

export function isTeardownSessionId(sessionId: string): boolean {
  return sessionId.startsWith("td-");
}

export function shouldClearCachedTerminalStateOnSessionExit(sessionId: string): boolean {
  return !isTeardownSessionId(sessionId);
}

export function isMissingDaemonSessionError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  return message.includes("session not found");
}

export function isSessionAlreadyExistsError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  return message.includes("session already exists");
}

export function reportCloseSessionError(
  prefix: string,
  error: unknown,
  logger: (message?: unknown, ...optionalParams: unknown[]) => void = console.error,
): void {
  if (isMissingDaemonSessionError(error)) {
    return;
  }

  logger(prefix, error);
}

export function reportPrewarmSessionError(
  prefix: string,
  error: unknown,
  logger: (message?: unknown, ...optionalParams: unknown[]) => void = console.error,
): void {
  if (isSessionAlreadyExistsError(error)) {
    return;
  }

  logger(prefix, error);
}

export async function closePipelineItemAndClearCachedTerminalState(
  itemId: string,
  closePipelineItem: (itemId: string) => Promise<unknown>,
  clearCachedState: (sessionId: string) => void = clearCachedTerminalState,
): Promise<void> {
  await closePipelineItem(itemId);
  clearCachedState(itemId);
}
