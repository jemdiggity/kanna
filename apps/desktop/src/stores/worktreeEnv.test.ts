import { describe, expect, it } from "vitest";
import { buildWorktreeSessionEnv } from "./worktreeEnv";

describe("buildWorktreeSessionEnv", () => {
  it("merges workspace env, resolved PATH updates, and port env", () => {
    const env = buildWorktreeSessionEnv({
      worktreePath: "/tmp/repo/.kanna-worktrees/task-123",
      baseEnv: {
        PATH: "/usr/bin:/bin",
        TERM: "xterm-256color",
      },
      repoConfig: {
        workspace: {
          env: {
            FOO: "bar",
          },
          path: {
            prepend: ["./bin"],
            append: ["vendor/tools"],
          },
        },
      },
      portEnv: {
        KANNA_DEV_PORT: "1421",
      },
    });

    expect(env).toEqual({
      PATH: "/tmp/repo/.kanna-worktrees/task-123/bin:/usr/bin:/bin:/tmp/repo/.kanna-worktrees/task-123/vendor/tools",
      TERM: "xterm-256color",
      FOO: "bar",
      KANNA_DEV_PORT: "1421",
    });
  });

  it("keeps absolute PATH entries unchanged", () => {
    const env = buildWorktreeSessionEnv({
      worktreePath: "/tmp/repo/.kanna-worktrees/task-123",
      baseEnv: {},
      repoConfig: {
        workspace: {
          path: {
            prepend: ["/opt/custom/bin"],
            append: ["./vendor/bin"],
          },
        },
      },
      inheritedPath: "/usr/local/bin:/usr/bin",
    });

    expect(env.PATH).toBe("/opt/custom/bin:/usr/local/bin:/usr/bin:/tmp/repo/.kanna-worktrees/task-123/vendor/bin");
  });
});
