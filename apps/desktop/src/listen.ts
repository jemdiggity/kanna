import { isTauri, mockListen } from "./tauri-mock";
import type { UnlistenFn } from "@tauri-apps/api/event";

type EventHandler = Parameters<typeof mockListen>[1];

export const listen: (event: string, handler: EventHandler) => Promise<UnlistenFn> =
  isTauri
    ? (await import("@tauri-apps/api/event")).listen
    : mockListen;

export const listenCurrentWebviewWindow: (event: string, handler: EventHandler) => Promise<UnlistenFn> =
  isTauri
    ? async (event, handler) => {
        const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        return getCurrentWebviewWindow().listen(event, handler);
      }
    : mockListen;
