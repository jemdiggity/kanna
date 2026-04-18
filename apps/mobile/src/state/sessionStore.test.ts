import { describe, expect, it } from "vitest";
import { createSessionStore } from "./sessionStore";

describe("createSessionStore", () => {
  it("switches the selected desktop without dropping the desktop list", () => {
    const store = createSessionStore();
    store.setDesktops([
      { id: "desktop-a", name: "Studio Mac", online: true, mode: "lan" },
      { id: "desktop-b", name: "Laptop", online: false, mode: "remote" }
    ]);

    store.selectDesktop("desktop-b");

    expect(store.getState().selectedDesktopId).toBe("desktop-b");
    expect(store.getState().desktops).toHaveLength(2);
  });

  it("selects the first desktop when no desktop is selected", () => {
    const store = createSessionStore();
    store.setDesktops([
      { id: "desktop-a", name: "Studio Mac", online: true, mode: "lan" }
    ]);

    expect(store.getState().selectedDesktopId).toBe("desktop-a");
  });

  it("does not clear the selected task during a partial collection update", () => {
    const store = createSessionStore();

    store.setRepoTasks([
      {
        id: "task-1",
        repoId: "repo-1",
        title: "Keep selected task",
        stage: "in progress"
      }
    ]);
    store.setSelectedTask("task-1");
    store.beginTaskTerminal("task-1", "Existing output");
    store.setTaskTerminalStatus("task-1", "live");

    store.setRecentTasks([]);

    expect(store.getState()).toMatchObject({
      selectedTaskId: "task-1",
      taskTerminalTaskId: "task-1",
      taskTerminalStatus: "live",
      taskTerminalOutput: "Existing output"
    });
  });

  it("clears the selected task when reconciliation finds no remaining collection match", () => {
    const store = createSessionStore();

    store.setRepoTasks([
      {
        id: "task-1",
        repoId: "repo-1",
        title: "Clear selected task",
        stage: "in progress"
      }
    ]);
    store.setSelectedTask("task-1");
    store.beginTaskTerminal("task-1", "Existing output");
    store.setTaskTerminalStatus("task-1", "live");
    store.setRepoTasks([]);

    store.reconcileSelectedTask();

    expect(store.getState()).toMatchObject({
      selectedTaskId: null,
      taskTerminalTaskId: null,
      taskTerminalStatus: "idle",
      taskTerminalOutput: ""
    });
  });

  it("does not publish when repo tasks are refreshed with identical data", () => {
    const store = createSessionStore();
    let publishes = 0;
    store.subscribe(() => {
      publishes += 1;
    });

    store.setRepoTasks([
      {
        id: "task-1",
        repoId: "repo-1",
        title: "Keep scroll position",
        stage: "in progress",
        snippet: "latest output"
      }
    ]);
    publishes = 0;

    store.setRepoTasks([
      {
        id: "task-1",
        repoId: "repo-1",
        title: "Keep scroll position",
        stage: "in progress",
        snippet: "latest output"
      }
    ]);

    expect(publishes).toBe(0);
  });

  it("does not publish when recent tasks are refreshed with identical data", () => {
    const store = createSessionStore();
    let publishes = 0;
    store.subscribe(() => {
      publishes += 1;
    });

    store.setRecentTasks([
      {
        id: "task-2",
        repoId: "repo-2",
        title: "Recent task",
        stage: "pr",
        snippet: "ready for review"
      }
    ]);
    publishes = 0;

    store.setRecentTasks([
      {
        id: "task-2",
        repoId: "repo-2",
        title: "Recent task",
        stage: "pr",
        snippet: "ready for review"
      }
    ]);

    expect(publishes).toBe(0);
  });
});
