import { describe, expect, it } from "vitest";
import { buildTaskBootstrapCommand } from "./taskBootstrap";

describe("buildTaskBootstrapCommand", () => {
  it("renders visible git setup and repo setup before the agent command for new tasks", () => {
    const command = buildTaskBootstrapCommand({
      repoPath: "/repo",
      worktreePath: "/repo/.kanna-worktrees/task-123",
      branch: "task-123",
      setupCmds: ["./scripts/setup-worktree.sh", "bun install"],
      agentCmd: "claude --session-id abc 'hello'",
      defaultBranch: "main",
    });

    expect(command).toContain("git fetch origin main");
    expect(command).toContain("start_ref='origin/main'");
    expect(command).toContain("git worktree add -b task-123 '/repo/.kanna-worktrees/task-123' \"$start_ref\"");
    expect(command).toContain("cd '/repo/.kanna-worktrees/task-123'");
    expect(command).toContain("./scripts/setup-worktree.sh");
    expect(command).toContain("bun install");
    expect(command).toContain("claude --session-id abc 'hello'");
  });

  it("skips fetch and uses HEAD for stage-advance worktrees", () => {
    const command = buildTaskBootstrapCommand({
      repoPath: "/repo",
      worktreePath: "/repo/.kanna-worktrees/task-pr",
      branch: "task-pr",
      baseBranch: "task-impl",
      setupCmds: ["./scripts/setup-worktree.sh"],
      agentCmd: "claude --session-id abc",
      defaultBranch: "main",
    });

    expect(command).not.toContain("git fetch origin");
    expect(command).toContain("cd '/repo/.kanna-worktrees/task-impl'");
    expect(command).toContain("git worktree add -b task-pr '/repo/.kanna-worktrees/task-pr' HEAD");
    expect(command).toContain("cd '/repo/.kanna-worktrees/task-pr'");
  });
});
