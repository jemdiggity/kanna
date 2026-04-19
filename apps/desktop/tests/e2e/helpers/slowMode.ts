import { setTimeout as sleep } from "node:timers/promises";

export function getSlowModeDelayMs(): number {
  const value = process.env.KANNA_E2E_SLOW_MODE_MS;
  if (!value) return 0;

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export async function pauseForSlowMode(label: string): Promise<void> {
  const delayMs = getSlowModeDelayMs();
  if (delayMs === 0) return;

  console.log(`[e2e slow mode] ${label} (${delayMs}ms)`);
  await sleep(delayMs);
}
