import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../appError";

const invokeMock = vi.fn<
  (command: string, args?: Record<string, unknown>) => Promise<unknown>
>();

vi.mock("../invoke", () => ({
  invoke: (...args: [string, Record<string, unknown> | undefined]) => invokeMock(...args),
}));

describe("shellCwd", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("uses the preferred cwd when it is readable", async () => {
    invokeMock.mockResolvedValue(["src"]);

    const { resolveShellSpawnCwd } = await import("./shellCwd");

    await expect(resolveShellSpawnCwd("/repo/.kanna-worktrees/task-1", "/repo")).resolves.toEqual({
      cwd: "/repo/.kanna-worktrees/task-1",
      fellBack: false,
    });
    expect(invokeMock).toHaveBeenCalledWith("list_dir", { path: "/repo/.kanna-worktrees/task-1" });
  });

  it("falls back to the repo root when the preferred cwd is unreadable", async () => {
    invokeMock.mockImplementation(async (_command, args) => {
      if (args?.path === "/repo/.kanna-worktrees/task-1") {
        throw new AppError("failed to read dir", "permission_denied");
      }
      return [];
    });

    const { resolveShellSpawnCwd } = await import("./shellCwd");

    await expect(resolveShellSpawnCwd("/repo/.kanna-worktrees/task-1", "/repo")).resolves.toEqual({
      cwd: "/repo",
      fellBack: true,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(1, "list_dir", { path: "/repo/.kanna-worktrees/task-1" });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "list_dir", { path: "/repo" });
  });

  it("throws when neither the preferred cwd nor fallback is readable", async () => {
    invokeMock.mockRejectedValue(new AppError("failed to read dir", "permission_denied"));

    const { resolveShellSpawnCwd } = await import("./shellCwd");

    await expect(resolveShellSpawnCwd("/repo/.kanna-worktrees/task-1", "/repo")).rejects.toThrow(
      "shell cwd is not readable: /repo/.kanna-worktrees/task-1",
    );
  });
});
