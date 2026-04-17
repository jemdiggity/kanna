import { invoke } from "../invoke";

export interface SessionRecoveryState {
  serialized: string;
  cols: number;
  rows: number;
  cursorRow: number;
  cursorCol: number;
  cursorVisible: boolean;
  savedAt: number;
  sequence: number;
}

export interface TerminalGeometry {
  cols: number;
  rows: number;
}

function isSessionRecoveryState(value: unknown): value is SessionRecoveryState {
  if (!value || typeof value !== "object") return false;

  const snapshot = value as Record<string, unknown>;
  return (
    typeof snapshot.serialized === "string" &&
    typeof snapshot.cols === "number" &&
    typeof snapshot.rows === "number" &&
    typeof snapshot.cursorRow === "number" &&
    typeof snapshot.cursorCol === "number" &&
    typeof snapshot.cursorVisible === "boolean" &&
    typeof snapshot.savedAt === "number" &&
    typeof snapshot.sequence === "number"
  );
}

export function shouldApplyRecoverySnapshot(
  snapshot: SessionRecoveryState | null | undefined,
  geometry: Partial<TerminalGeometry>,
): boolean {
  if (!snapshot?.serialized) return false;
  if (geometry.cols && geometry.cols > 0 && snapshot.cols !== geometry.cols) {
    return false;
  }
  if (geometry.rows && geometry.rows > 0 && snapshot.rows !== geometry.rows) {
    return false;
  }
  return true;
}

export async function loadSessionRecoveryState(
  sessionId: string,
): Promise<SessionRecoveryState | null> {
  const snapshot = await invoke<unknown>("get_session_recovery_state", { sessionId });
  if (snapshot == null) return null;
  return isSessionRecoveryState(snapshot) ? snapshot : null;
}
