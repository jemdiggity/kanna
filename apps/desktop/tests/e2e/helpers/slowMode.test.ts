import { afterEach, describe, expect, it, vi } from "vitest";
import { getSlowModeDelayMs, pauseForSlowMode } from "./slowMode";

describe("slowMode", () => {
  afterEach(() => {
    delete process.env.KANNA_E2E_SLOW_MODE_MS;
    vi.useRealTimers();
  });

  it("defaults to no slow-mode delay", () => {
    expect(getSlowModeDelayMs()).toBe(0);
  });

  it("reads a positive slow-mode delay from the environment", () => {
    process.env.KANNA_E2E_SLOW_MODE_MS = "300";

    expect(getSlowModeDelayMs()).toBe(300);
  });

  it("waits for the configured slow-mode delay", async () => {
    vi.useFakeTimers();
    process.env.KANNA_E2E_SLOW_MODE_MS = "300";

    let completed = false;
    const pause = pauseForSlowMode("after import").then(() => {
      completed = true;
    });

    await vi.advanceTimersByTimeAsync(299);
    expect(completed).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pause;
    expect(completed).toBe(true);
  });
});
