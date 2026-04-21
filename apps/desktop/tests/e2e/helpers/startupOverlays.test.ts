import { describe, expect, it } from "vitest";
import { dismissStartupShortcutsModal } from "./startupOverlays";

interface FakeClient {
  executeCalls: string[];
  waitCalls: Array<{ css: string; timeoutMs: number }>;
  visibilityChecks: boolean[];
  executeSync<T = unknown>(script: string): Promise<T>;
  waitForNoElement(css: string, timeoutMs?: number): Promise<void>;
}

function createFakeClient(visibilityChecks: boolean[]): FakeClient {
  return {
    executeCalls: [],
    waitCalls: [],
    visibilityChecks,
    async executeSync<T = unknown>(script: string): Promise<T> {
      this.executeCalls.push(script);
      if (script.includes("showShortcutsModal")) {
        return (this.visibilityChecks.shift() ?? false) as T;
      }
      return undefined as T;
    },
    async waitForNoElement(css: string, timeoutMs = 5000): Promise<void> {
      this.waitCalls.push({ css, timeoutMs });
    },
  };
}

describe("dismissStartupShortcutsModal", () => {
  it("waits for the shortcuts modal and dismisses it with Escape", async () => {
    const client = createFakeClient([false, false, true]);

    await dismissStartupShortcutsModal(client);

    expect(client.executeCalls.at(-1)).toContain("window.dispatchEvent");
    expect(client.executeCalls.at(-1)).toContain('key: "Escape"');
    expect(client.waitCalls).toEqual([{ css: ".shortcuts-modal", timeoutMs: 5000 }]);
  });

  it("does nothing when the shortcuts modal is already hidden", async () => {
    const client = createFakeClient([false, false, false]);

    await dismissStartupShortcutsModal(client);

    expect(client.executeCalls.every((call) => !call.includes('key: "Escape"'))).toBe(true);
    expect(client.waitCalls).toEqual([]);
  });
});
