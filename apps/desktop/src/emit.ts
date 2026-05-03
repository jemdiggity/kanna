import { isTauri, mockEmit } from "./tauri-mock";

export const emit: (event: string, payload?: unknown) => Promise<void> =
  isTauri
    ? (await import("@tauri-apps/api/event")).emit
    : mockEmit;
