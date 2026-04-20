import { setTimeout as sleep } from "node:timers/promises";

import type { WebDriverClient } from "./webdriver";
import { tauriInvoke } from "./vue";

export interface AgentTrustPromptClient {
  waitForElement(css: string, timeoutMs?: number): Promise<string>;
  executeSync<T = unknown>(script: string, args?: unknown[]): Promise<T>;
}

export interface AgentTrustPromptOptions {
  delayMs?: number;
  attempts?: number;
  intervalMs?: number;
}

export async function nudgeAgentTrustPrompt(
  client: AgentTrustPromptClient,
  options: AgentTrustPromptOptions = {},
): Promise<void> {
  await client.waitForElement(".terminal-container", 15_000);
  await sleep(options.delayMs ?? 5000);

  const selectedItemId = await client.executeSync<string | null>(
    `const ctx = window.__KANNA_E2E__?.setupState;
     const value = ctx?.selectedItemId;
     return value && value.__v_isRef ? value.value : value ?? null;`,
  );

  if (!selectedItemId) {
    return;
  }

  const attempts = options.attempts ?? 4;
  const intervalMs = options.intervalMs ?? 5000;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await tauriInvoke(client as WebDriverClient, "send_input", {
      sessionId: selectedItemId,
      data: [13],
    });
    if (attempt < attempts - 1) {
      await sleep(intervalMs);
    }
  }
}
