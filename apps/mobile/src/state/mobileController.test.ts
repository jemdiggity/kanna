import { describe, expect, it, vi } from "vitest";
import { createSessionStore } from "./sessionStore";
import { createMobileController } from "./mobileController";
import type { KannaClient } from "../lib/api/client";

function createClientMock(): KannaClient {
  return {
    getStatus: vi.fn().mockResolvedValue({
      state: "running",
      desktopId: "desktop-1",
      desktopName: "Studio Mac",
      lanHost: "0.0.0.0",
      lanPort: 48120,
      pairingCode: null
    }),
    listDesktops: vi.fn().mockResolvedValue([
      { id: "desktop-1", name: "Studio Mac", online: true, mode: "lan" },
      { id: "desktop-2", name: "Laptop", online: false, mode: "remote" }
    ]),
    listRepos: vi.fn().mockResolvedValue([
      { id: "repo-1", name: "Repo One" },
      { id: "repo-2", name: "Repo Two" }
    ]),
    listRecentTasks: vi.fn().mockResolvedValue([
      {
        id: "task-1",
        repoId: "repo-1",
        title: "Refactor mobile shell",
        stage: "in progress"
      }
    ]),
    searchTasks: vi.fn().mockResolvedValue([
      {
        id: "task-2",
        repoId: "repo-2",
        title: "Search result",
        stage: "pr"
      }
    ]),
    createTask: vi.fn().mockResolvedValue({
      taskId: "task-3",
      repoId: "repo-2",
      title: "Ship mobile shell",
      stage: "in progress"
    }),
    createPairingSession: vi.fn().mockResolvedValue({
      code: "ABC123",
      desktopId: "desktop-1",
      desktopName: "Studio Mac",
      lanHost: "0.0.0.0",
      lanPort: 48120,
      expiresAtUnixMs: 1
    })
  };
}

describe("createMobileController", () => {
  it("bootstraps connection, desktops, repos, and recent tasks", async () => {
    const store = createSessionStore();
    const controller = createMobileController(createClientMock(), store);

    await controller.bootstrap();

    expect(store.getState()).toMatchObject({
      connectionState: "connected",
      connectionMode: "lan",
      desktopName: "Studio Mac",
      selectedDesktopId: "desktop-1",
      selectedRepoId: "repo-1",
      activeView: "tasks"
    });
    expect(store.getState().recentTasks).toHaveLength(1);
  });

  it("searches tasks and switches to the search surface", async () => {
    const store = createSessionStore();
    const controller = createMobileController(createClientMock(), store);

    await controller.searchTasks("search");

    expect(store.getState().activeView).toBe("search");
    expect(store.getState().searchQuery).toBe("search");
    expect(store.getState().searchResults.map((task) => task.id)).toEqual(["task-2"]);
  });

  it("creates a task for the selected repo and opens it", async () => {
    const store = createSessionStore();
    const controller = createMobileController(createClientMock(), store);

    await controller.bootstrap();
    store.selectRepo("repo-2");
    store.setComposerState(true, "Ship mobile shell");

    await controller.createTask();

    expect(store.getState().recentTasks[0]).toMatchObject({
      id: "task-3",
      repoId: "repo-2",
      title: "Ship mobile shell"
    });
    expect(store.getState().selectedTaskId).toBe("task-3");
    expect(store.getState().isComposerOpen).toBe(false);
    expect(store.getState().composerPrompt).toBe("");
  });

  it("creates a pairing session and refreshes the desktop state", async () => {
    const store = createSessionStore();
    const client = createClientMock();
    const controller = createMobileController(client, store);

    await controller.connectLocal();

    expect(client.createPairingSession).toHaveBeenCalledTimes(1);
    expect(store.getState().pairingCode).toBe("ABC123");
    expect(store.getState().connectionState).toBe("connected");
  });
});
