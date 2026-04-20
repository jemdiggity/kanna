import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriInvokeMock = vi.fn(async () => undefined);

vi.mock("./vue", () => ({
  tauriInvoke: tauriInvokeMock,
}));

interface FakeClient {
  waitForElement: ReturnType<typeof vi.fn>;
  executeSync: ReturnType<typeof vi.fn>;
}

function createFakeClient(selectedItemId: string | null): FakeClient {
  return {
    waitForElement: vi.fn(async () => "terminal"),
    executeSync: vi.fn(async () => selectedItemId),
  };
}

describe("nudgeAgentTrustPrompt", () => {
  beforeEach(() => {
    vi.resetModules();
    tauriInvokeMock.mockReset();
    tauriInvokeMock.mockResolvedValue(undefined);
  });

  it("waits for the terminal and sends one carriage return to the selected task session", async () => {
    const client = createFakeClient("task-1234");
    const { nudgeAgentTrustPrompt } = await import("./agentTrustPrompt");

    await nudgeAgentTrustPrompt(client, { delayMs: 0, attempts: 1, intervalMs: 0 });

    expect(client.waitForElement).toHaveBeenCalledWith(".terminal-container", 15_000);
    expect(client.executeSync).toHaveBeenCalled();
    expect(tauriInvokeMock).toHaveBeenCalledWith(client, "send_input", {
      sessionId: "task-1234",
      data: [13],
    });
  });

  it("does nothing when there is no selected task", async () => {
    const client = createFakeClient(null);
    const { nudgeAgentTrustPrompt } = await import("./agentTrustPrompt");

    await nudgeAgentTrustPrompt(client, { delayMs: 0, attempts: 1, intervalMs: 0 });

    expect(tauriInvokeMock).not.toHaveBeenCalled();
  });

  it("can retry the carriage return nudge over a bounded window", async () => {
    const client = createFakeClient("task-1234");
    const { nudgeAgentTrustPrompt } = await import("./agentTrustPrompt");

    await nudgeAgentTrustPrompt(client, { delayMs: 0, attempts: 3, intervalMs: 0 });

    expect(tauriInvokeMock).toHaveBeenCalledTimes(3);
    expect(tauriInvokeMock).toHaveBeenNthCalledWith(1, client, "send_input", {
      sessionId: "task-1234",
      data: [13],
    });
    expect(tauriInvokeMock).toHaveBeenNthCalledWith(2, client, "send_input", {
      sessionId: "task-1234",
      data: [13],
    });
    expect(tauriInvokeMock).toHaveBeenNthCalledWith(3, client, "send_input", {
      sessionId: "task-1234",
      data: [13],
    });
  });
});
