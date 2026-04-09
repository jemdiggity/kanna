import { isTauri, mockInvoke } from "./tauri-mock";
import { normalizeAppError } from "./appError";

const tauriInvoke = isTauri
  ? (await import("@tauri-apps/api/core")).invoke
  : (cmd: string, args?: Record<string, unknown>) => Promise.resolve(mockInvoke(cmd, args));

export async function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (error) {
    throw normalizeAppError(error);
  }
}
