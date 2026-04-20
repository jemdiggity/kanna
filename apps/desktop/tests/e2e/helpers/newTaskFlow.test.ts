import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeClient {
  executeCalls: string[];
  waitCalls: Array<{ css: string; timeoutMs: number }>;
  sendKeyCalls: Array<{ elementId: string; text: string }>;
  executeSync<T = unknown>(script: string, args?: unknown[]): Promise<T>;
  waitForElement(css: string, timeoutMs?: number): Promise<string>;
  waitForNoElement(css: string, timeoutMs?: number): Promise<void>;
  sendKeys(elementId: string, text: string): Promise<void>;
}

function createFakeClient(): FakeClient {
  return {
    executeCalls: [],
    waitCalls: [],
    sendKeyCalls: [],
    async executeSync<T = unknown>(script: string): Promise<T> {
      this.executeCalls.push(script);
      return undefined as T;
    },
    async waitForElement(css: string, timeoutMs = 10000): Promise<string> {
      this.waitCalls.push({ css, timeoutMs });
      if (css === ".modal-overlay") return "modal";
      if (css === ".modal-overlay textarea") return "textarea";
      throw new Error(`unexpected selector ${css}`);
    },
    async waitForNoElement(css: string, timeoutMs = 5000): Promise<void> {
      this.waitCalls.push({ css, timeoutMs });
    },
    async sendKeys(elementId: string, text: string): Promise<void> {
      this.sendKeyCalls.push({ elementId, text });
    },
  };
}

describe("submitTaskFromUi", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("opens the modal, cycles to codex, fills the prompt, and submits with Cmd+Enter", async () => {
    const client = createFakeClient();
    const { submitTaskFromUi } = await import("./newTaskFlow");

    await submitTaskFromUi(client, "Write a real e2e task");

    expect(client.executeCalls[0]).toContain('key: "N"');
    expect(client.executeCalls[0]).toContain("metaKey: true");
    expect(client.executeCalls[0]).toContain("shiftKey: true");
    expect(client.executeCalls[1]).toContain('document.querySelector(".modal")');
    expect(client.executeCalls[1]).toContain('key: "]"');
    expect(client.executeCalls[1]).toContain("metaKey: true");
    expect(client.executeCalls[1]).toContain("shiftKey: true");
    expect(client.executeCalls[2]).toContain('document.querySelector(".modal")');
    expect(client.executeCalls[2]).toContain('key: "]"');
    expect(client.executeCalls[2]).toContain("metaKey: true");
    expect(client.executeCalls[2]).toContain("shiftKey: true");
    expect(client.waitCalls).toContainEqual({ css: ".modal-overlay", timeoutMs: 2000 });
    expect(client.waitCalls).toContainEqual({ css: ".modal-overlay textarea", timeoutMs: 2000 });
    expect(client.sendKeyCalls).toEqual([{ elementId: "textarea", text: "Write a real e2e task" }]);
    expect(client.executeCalls[3]).toContain('key: "Enter"');
    expect(client.executeCalls[3]).toContain("metaKey: true");
    expect(client.waitCalls).toContainEqual({ css: ".modal-overlay", timeoutMs: 5000 });
  });
});
