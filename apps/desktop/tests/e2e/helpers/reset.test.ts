import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callVueMethod: vi.fn(),
  execDb: vi.fn(),
  queryDb: vi.fn(),
  tauriInvoke: vi.fn(),
}));

vi.mock("./vue", () => ({
  callVueMethod: mocks.callVueMethod,
  execDb: mocks.execDb,
  queryDb: mocks.queryDb,
  tauriInvoke: mocks.tauriInvoke,
}));

describe("reset helpers", () => {
  const originalLiveRepoRoot = process.env.KANNA_E2E_LIVE_REPO_ROOT;

  beforeEach(() => {
    vi.resetModules();
    mocks.callVueMethod.mockReset();
    mocks.execDb.mockReset();
    mocks.queryDb.mockReset();
    mocks.tauriInvoke.mockReset();
    process.env.KANNA_E2E_LIVE_REPO_ROOT = originalLiveRepoRoot;
  });

  it("cleans up only task worktrees created after the imported repo baseline", async () => {
    const client = {
      executeSync: vi.fn().mockResolvedValueOnce({
        selectedRepoId: "repo-1",
        selectedRepoPath: "/repo",
      }),
    };

    mocks.tauriInvoke
      .mockResolvedValueOnce([
        { name: "task-existing", path: "/repo/.kanna-worktrees/task-existing" },
        { name: "scratch", path: "/repo/.kanna-worktrees/scratch" },
      ])
      .mockResolvedValueOnce([
        { name: "task-existing", path: "/repo/.kanna-worktrees/task-existing" },
        { name: "task-created-by-test", path: "/repo/.kanna-worktrees/task-created-by-test" },
        { name: "task-created-externally", path: "/repo/.kanna-worktrees/task-created-externally" },
        { name: "scratch", path: "/repo/.kanna-worktrees/scratch" },
      ])
      .mockResolvedValue(undefined);
    mocks.queryDb
      .mockResolvedValueOnce([{ id: "repo-1", name: "test-repo" }])
      .mockResolvedValueOnce([
        { branch: "task-created-by-test" },
      ]);
    mocks.callVueMethod.mockResolvedValue(undefined);

    const { cleanupWorktrees, importTestRepo } = await import("./reset");

    await importTestRepo(client as never, "/repo", "test-repo");
    await cleanupWorktrees(client as never, "/repo");

    const removeCalls = mocks.tauriInvoke.mock.calls.filter(
      ([, cmd]) => cmd === "git_worktree_remove",
    );

    expect(removeCalls).toEqual([
      [
        client,
        "git_worktree_remove",
        {
          repoPath: "/repo",
          path: "/repo/.kanna-worktrees/task-created-by-test",
        },
      ],
    ]);
  });

  it("refuses to import repos from the live checkout", async () => {
    const client = {};

    process.env.KANNA_E2E_LIVE_REPO_ROOT = "/live/kanna";
    mocks.callVueMethod.mockResolvedValue(undefined);

    const { importTestRepo } = await import("./reset");

    await expect(importTestRepo(client as never, "/live/kanna/apps", "bad-repo")).rejects.toThrow(
      /fixture repo/i,
    );
    expect(mocks.callVueMethod).not.toHaveBeenCalled();
  });

  it("refuses to remove worktrees when no baseline was recorded for the repo", async () => {
    const client = {};

    const { cleanupWorktrees } = await import("./reset");

    await cleanupWorktrees(client as never, "/repo");

    expect(mocks.tauriInvoke).not.toHaveBeenCalled();
  });

  it("waits for the imported repo to become selected in Vue state instead of relying on sidebar DOM", async () => {
    const client = {
      executeSync: vi.fn()
        .mockResolvedValueOnce({ selectedRepoId: null, selectedRepoPath: null })
        .mockResolvedValueOnce({ selectedRepoId: null, selectedRepoPath: null })
        .mockResolvedValueOnce({ selectedRepoId: "repo-1", selectedRepoPath: "/repo" }),
    };

    mocks.tauriInvoke.mockResolvedValueOnce([]);
    mocks.callVueMethod.mockResolvedValue(undefined);
    mocks.queryDb.mockResolvedValueOnce([{ id: "repo-1", name: "test-repo" }]);

    const { importTestRepo } = await import("./reset");

    await expect(importTestRepo(client as never, "/repo", "test-repo")).resolves.toBe("repo-1");
    expect(mocks.callVueMethod).toHaveBeenCalledWith(client, "handleImportRepo", "/repo", "test-repo", "main");
    expect(mocks.callVueMethod).toHaveBeenCalledWith(client, "handleSelectRepo", "repo-1");
    expect(client.executeSync).toHaveBeenCalled();
  });
});
