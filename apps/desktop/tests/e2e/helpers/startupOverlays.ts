import { setTimeout as sleep } from "node:timers/promises";

export interface StartupOverlayClient {
  executeSync<T = unknown>(script: string, args?: unknown[]): Promise<T>;
  waitForNoElement(css: string, timeoutMs?: number): Promise<void>;
}

const STARTUP_SHORTCUTS_POLL_INTERVAL_MS = 100;
const STARTUP_SHORTCUTS_WAIT_MS = 1500;

export async function dismissStartupShortcutsModal(
  client: StartupOverlayClient,
): Promise<void> {
  const deadline = Date.now() + STARTUP_SHORTCUTS_WAIT_MS;
  while (Date.now() < deadline) {
    const visible = await client.executeSync<boolean>(
      "return Boolean(window.__KANNA_E2E__?.setupState?.showShortcutsModal);",
    );
    if (visible) {
      await client.executeSync(
        `document.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }));`,
      );
      await client.waitForNoElement(".shortcuts-modal", 5000);
      return;
    }
    await sleep(STARTUP_SHORTCUTS_POLL_INTERVAL_MS);
  }
}
