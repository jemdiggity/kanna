import { describe, expect, it } from "vitest";
import { dismissStartupShortcutsModal } from "./startupOverlays";

interface FakeClient {
  executeCalls: string[];
  waitCalls: Array<{ css: string; timeoutMs: number }>;
  visible: boolean;
  executeSync<T = unknown>(script: string): Promise<T>;
  waitForNoElement(css: string, timeoutMs?: number): Promise<void>;
}

function createFakeClient(visible: boolean): FakeClient {
  return {
    executeCalls: [],
    waitCalls: [],
    visible,
    async executeSync<T = unknown>(script: string): Promise<T> {
      this.executeCalls.push(script);
      if (script.includes("showShortcutsModal")) {
        return this.visible as T;
      }
      return undefined as T;
    },
    async waitForNoElement(css: string, timeoutMs = 5000): Promise<void> {
      this.waitCalls.push({ css, timeoutMs });
    },
  };
}

describe("dismissStartupShortcutsModal", () => {
  it("dismisses the shortcuts modal when it is visible", async () => {
    const client = createFakeClient(true);

    await dismissStartupShortcutsModal(client);

    expect(client.executeCalls).toHaveLength(2);
    expect(client.executeCalls[1]).toContain("showShortcutsModal = false");
    expect(client.waitCalls).toEqual([{ css: ".shortcuts-modal", timeoutMs: 5000 }]);
  });

  it("does nothing when the shortcuts modal is already hidden", async () => {
    const client = createFakeClient(false);

    await dismissStartupShortcutsModal(client);

    expect(client.executeCalls).toHaveLength(1);
    expect(client.waitCalls).toEqual([]);
  });
});
