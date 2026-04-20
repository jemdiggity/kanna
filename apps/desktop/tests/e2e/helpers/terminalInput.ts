import { setTimeout as sleep } from "node:timers/promises";

export interface TerminalInputClient {
  executeSync<T = unknown>(script: string, args?: unknown[]): Promise<T>;
  waitForElement(css: string, timeoutMs?: number): Promise<string>;
  sendKeys(elementId: string, text: string): Promise<void>;
  pressKey(value: string): Promise<void>;
}

export interface TerminalInputOptions {
  initialDelayMs?: number;
  attempts?: number;
  intervalMs?: number;
}

const TERMINAL_CONTAINER_SELECTOR = ".terminal-container";
const TERMINAL_INPUT_SELECTOR = ".main-panel .xterm-helper-textarea";

export async function sendKeysToActiveTerminal(
  client: TerminalInputClient,
  text: string,
  options: TerminalInputOptions = {},
): Promise<void> {
  await client.waitForElement(TERMINAL_CONTAINER_SELECTOR, 15_000);

  const initialDelayMs = options.initialDelayMs ?? 0;
  if (initialDelayMs > 0) {
    await sleep(initialDelayMs);
  }

  await client.executeSync(
    `const el = document.querySelector(${JSON.stringify(TERMINAL_INPUT_SELECTOR)});
     if (el instanceof HTMLElement) el.focus();`,
  );

  const input = await client.waitForElement(TERMINAL_INPUT_SELECTOR, 5_000);
  const attempts = options.attempts ?? 1;
  const intervalMs = options.intervalMs ?? 0;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await client.sendKeys(input, text);
    if (attempt < attempts - 1 && intervalMs > 0) {
      await sleep(intervalMs);
    }
  }
}

export async function nudgeTerminalTrustPrompt(
  client: TerminalInputClient,
  options: TerminalInputOptions = {},
): Promise<void> {
  await client.waitForElement(TERMINAL_CONTAINER_SELECTOR, 15_000);

  const initialDelayMs = options.initialDelayMs ?? 0;
  if (initialDelayMs > 0) {
    await sleep(initialDelayMs);
  }

  await client.executeSync(
    `const el = document.querySelector(${JSON.stringify(TERMINAL_INPUT_SELECTOR)});
     if (el instanceof HTMLElement) el.focus();`,
  );

  await client.waitForElement(TERMINAL_INPUT_SELECTOR, 5_000);
  const attempts = options.attempts ?? 1;
  const intervalMs = options.intervalMs ?? 0;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await client.pressKey("\uE007");
    if (attempt < attempts - 1 && intervalMs > 0) {
      await sleep(intervalMs);
    }
  }
}
