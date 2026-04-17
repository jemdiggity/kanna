import { describe, expect, it, vi } from "vitest";
import { createAppModel } from "./appModel";
import type { FetchLike } from "./lib/transports/lanTransport";

function createFetchMock(): FetchLike {
  return vi.fn(async (input) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.endsWith("/v1/status")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          state: "running",
          desktopId: "desktop-1",
          desktopName: "Studio Mac",
          lanHost: "0.0.0.0",
          lanPort: 48120,
          pairingCode: null
        })
      } as Response;
    }

    if (url.endsWith("/v1/desktops")) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          { id: "desktop-1", name: "Studio Mac", online: true, mode: "lan" },
          { id: "desktop-2", name: "Laptop", online: true, mode: "remote" }
        ]
      } as Response;
    }

    if (url.endsWith("/v1/repos")) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          { id: "repo-1", name: "Repo One" },
          { id: "repo-2", name: "Repo Two" }
        ]
      } as Response;
    }

    if (url.endsWith("/v1/tasks/recent")) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "task-1",
            repoId: "repo-1",
            title: "Refactor mobile shell",
            stage: "in progress"
          },
          {
            id: "task-2",
            repoId: "repo-2",
            title: "Review shell polish",
            stage: "pr"
          }
        ]
      } as Response;
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as FetchLike;
}

describe("createAppModel", () => {
  it("creates an app model with desktop navigation and a LAN client", async () => {
    const model = createAppModel("http://desktop.test", createFetchMock());

    expect(model.navigator.tabs.map((tab) => tab.label)).toEqual([
      "Tasks",
      "Recent",
      "Desktops",
      "More"
    ]);
    expect(typeof model.controller.bootstrap).toBe("function");
    expect((await model.client.getStatus()).desktopName).toBe("Studio Mac");
  });

  it("hydrates persisted mobile context before bootstrap", async () => {
    const persistence = {
      load: vi.fn().mockResolvedValue({
        selectedDesktopId: "desktop-2",
        selectedRepoId: "repo-2",
        selectedTaskId: "task-2",
        activeView: "more"
      }),
      save: vi.fn().mockResolvedValue(undefined)
    };
    const model = createAppModel(
      "http://desktop.test",
      createFetchMock(),
      persistence
    );

    await model.initialize();

    expect(model.sessionStore.getState()).toMatchObject({
      selectedDesktopId: "desktop-2",
      selectedRepoId: "repo-2",
      selectedTaskId: "task-2",
      activeView: "more"
    });
  });

  it("persists desktop context whenever the user changes it", async () => {
    const persistence = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined)
    };
    const model = createAppModel(
      "http://desktop.test",
      createFetchMock(),
      persistence
    );

    await model.initialize();
    model.controller.selectDesktop("desktop-2");
    model.controller.selectRepo("repo-2");
    model.controller.openTask("task-2");
    model.controller.showView("more");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(persistence.save).toHaveBeenLastCalledWith({
      selectedDesktopId: "desktop-2",
      selectedRepoId: "repo-2",
      selectedTaskId: "task-2",
      activeView: "more"
    });
  });
});
