import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./startupOverlays", () => ({
  dismissStartupShortcutsModal: vi.fn(async () => {}),
}));

import { dismissStartupShortcutsModal } from "./startupOverlays";
import { WebDriverClient } from "./webdriver";

describe("WebDriverClient.createSession", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("dismisses startup shortcuts by default", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/session") && init?.method === "POST") {
        return {
          json: async () => ({ value: { sessionId: "session-1" } }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const client = new WebDriverClient();
    vi.spyOn(client, "waitForAppReady").mockResolvedValue();

    await client.createSession();

    expect(dismissStartupShortcutsModal).toHaveBeenCalledWith(client);
  });

  it("can preserve startup shortcuts when requested", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/session") && init?.method === "POST") {
        return {
          json: async () => ({ value: { sessionId: "session-2" } }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const client = new WebDriverClient();
    vi.spyOn(client, "waitForAppReady").mockResolvedValue();

    await client.createSession({ dismissStartupShortcuts: false });

    expect(dismissStartupShortcutsModal).not.toHaveBeenCalled();
  });
});
