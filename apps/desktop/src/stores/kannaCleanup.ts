import { clearCachedTerminalState } from "../composables/terminalStateCache";

export function isTeardownSessionId(sessionId: string): boolean {
  return sessionId.startsWith("td-");
}

export function shouldClearCachedTerminalStateOnSessionExit(sessionId: string): boolean {
  return !isTeardownSessionId(sessionId);
}

export async function closePipelineItemAndClearCachedTerminalState(
  itemId: string,
  closePipelineItem: (itemId: string) => Promise<unknown>,
  clearCachedState: (sessionId: string) => void = clearCachedTerminalState,
): Promise<void> {
  await closePipelineItem(itemId);
  clearCachedState(itemId);
}
