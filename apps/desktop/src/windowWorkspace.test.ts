import { describe, expect, it } from "vitest";

import {
  removeWindowFromWorkspaceSnapshot,
  parseWindowBootstrap,
  reconcileWorkspaceSnapshot,
  resolveWindowBootstrap,
  type WorkspaceSnapshot,
} from "./windowWorkspace";

describe("windowWorkspace", () => {
  it("parses bootstrap selection from the query string", () => {
    expect(
      parseWindowBootstrap("?windowId=win-2&selectedRepoId=repo-1&selectedItemId=task-9"),
    ).toEqual({
      windowId: "win-2",
      selectedRepoId: "repo-1",
      selectedItemId: "task-9",
    });
  });

  it("adds a missing window record without disturbing saved order", () => {
    const snapshot: WorkspaceSnapshot = {
      windows: [
        {
          windowId: "main",
          selectedRepoId: "repo-1",
          selectedItemId: "task-1",
          order: 0,
          sidebarHidden: false,
        },
      ],
    };

    expect(reconcileWorkspaceSnapshot(snapshot, "win-2")).toEqual({
      windows: [
        {
          windowId: "main",
          selectedRepoId: "repo-1",
          selectedItemId: "task-1",
          order: 0,
          sidebarHidden: false,
        },
        {
          windowId: "win-2",
          selectedRepoId: null,
          selectedItemId: null,
          order: 1,
          sidebarHidden: false,
        },
      ],
    });
  });

  it("hydrates the main window selection from the saved workspace snapshot", async () => {
    const db = {
      execute: async () => ({ rowsAffected: 1 }),
      select: async () => [],
    };

    const bootstrap = await resolveWindowBootstrap(
      db as never,
      {
        windowId: "main",
        selectedRepoId: null,
        selectedItemId: null,
      },
      {
        windows: [
          {
            windowId: "main",
            selectedRepoId: "repo-1",
            selectedItemId: "task-2",
            order: 0,
            sidebarHidden: false,
          },
        ],
      },
    );

    expect(bootstrap).toEqual({
      windowId: "main",
      selectedRepoId: "repo-1",
      selectedItemId: "task-2",
    });
  });

  it("removes a closed window and renormalizes the remaining order", () => {
    const snapshot: WorkspaceSnapshot = {
      windows: [
        {
          windowId: "main",
          selectedRepoId: "repo-1",
          selectedItemId: "task-1",
          order: 0,
          sidebarHidden: false,
        },
        {
          windowId: "win-2",
          selectedRepoId: "repo-1",
          selectedItemId: "task-2",
          order: 1,
          sidebarHidden: true,
        },
        {
          windowId: "win-3",
          selectedRepoId: "repo-2",
          selectedItemId: null,
          order: 2,
          sidebarHidden: false,
        },
      ],
    };

    expect(removeWindowFromWorkspaceSnapshot(snapshot, "win-2")).toEqual({
      windows: [
        {
          windowId: "main",
          selectedRepoId: "repo-1",
          selectedItemId: "task-1",
          order: 0,
          sidebarHidden: false,
        },
        {
          windowId: "win-3",
          selectedRepoId: "repo-2",
          selectedItemId: null,
          order: 1,
          sidebarHidden: false,
        },
      ],
    });
  });
});
