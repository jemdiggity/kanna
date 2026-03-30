export interface CachedTerminalState {
  serialized: string;
  cols: number;
  rows: number;
  savedAt: number;
}

const STORAGE_PREFIX = "kanna:terminal-state:";

function getStorageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`;
}

export function saveCachedTerminalState(sessionId: string, state: CachedTerminalState): void {
  try {
    localStorage.setItem(getStorageKey(sessionId), JSON.stringify(state));
  } catch {
    // Best-effort cache: ignore storage quota or availability failures.
  }
}

export function loadCachedTerminalState(sessionId: string): CachedTerminalState | null {
  const raw = localStorage.getItem(getStorageKey(sessionId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedTerminalState;
    if (
      typeof parsed.serialized !== "string" ||
      typeof parsed.cols !== "number" ||
      typeof parsed.rows !== "number" ||
      typeof parsed.savedAt !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearCachedTerminalState(sessionId: string): void {
  localStorage.removeItem(getStorageKey(sessionId));
}
