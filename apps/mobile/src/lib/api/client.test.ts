import { describe, expect, it, vi } from "vitest";
import { createKannaClient } from "./client";
import type { KannaTransport } from "./client";

describe("createKannaClient", () => {
  it("forwards desktop and task queries to the transport", async () => {
    const transport: KannaTransport = {
      getStatus: vi.fn().mockResolvedValue({
        state: "running",
        desktopId: "desktop-1",
        desktopName: "Studio Mac",
        lanHost: "0.0.0.0",
        lanPort: 48120,
        pairingCode: null
      }),
      listDesktops: vi.fn().mockResolvedValue([
        { id: "desktop-1", name: "Studio Mac", online: true, mode: "lan" }
      ]),
      listRecentTasks: vi.fn().mockResolvedValue([
        { id: "task-1", repoId: "repo-1", title: "Refactor mobile client", stage: "in progress" }
      ]),
      searchTasks: vi.fn().mockResolvedValue([
        { id: "task-2", repoId: "repo-1", title: "Search result", stage: "pr" }
      ]),
      createPairingSession: vi.fn().mockResolvedValue({
        code: "ABC123",
        desktopId: "desktop-1",
        desktopName: "Studio Mac",
        lanHost: "0.0.0.0",
        lanPort: 48120,
        expiresAtUnixMs: 123
      })
    };

    const client = createKannaClient(transport);

    expect(await client.listDesktops()).toHaveLength(1);
    expect(await client.listRecentTasks()).toHaveLength(1);
    expect(await client.searchTasks("search")).toHaveLength(1);
    expect((await client.createPairingSession()).code).toBe("ABC123");
  });
});
