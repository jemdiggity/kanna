export interface StartupOverlayClient {
  executeSync<T = unknown>(script: string, args?: unknown[]): Promise<T>;
  waitForNoElement(css: string, timeoutMs?: number): Promise<void>;
}

export async function dismissStartupShortcutsModal(
  client: StartupOverlayClient,
): Promise<void> {
  const visible = await client.executeSync<boolean>(
    "return Boolean(window.__KANNA_E2E__?.setupState?.showShortcutsModal);",
  );

  if (!visible) return;

  await client.executeSync(
    "if (window.__KANNA_E2E__?.setupState) window.__KANNA_E2E__.setupState.showShortcutsModal = false;",
  );
  await client.waitForNoElement(".shortcuts-modal", 5000);
}
