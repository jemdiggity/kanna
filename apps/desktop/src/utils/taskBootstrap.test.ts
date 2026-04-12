import { describe, expect, it } from "vitest";
import { buildTaskBootstrapCommand } from "./taskBootstrap";
import { buildTaskShellCommand } from "../composables/terminalSessionRecovery";

describe("buildTaskBootstrapCommand", () => {
  it("renders visible git setup without re-running git commands before repo setup", () => {
    const command = buildTaskBootstrapCommand({
      worktreePath: "/repo/.kanna-worktrees/task-123",
      visibleBootstrapSteps: [
        "git fetch origin main",
        "git worktree add -b task-123 '/repo/.kanna-worktrees/task-123' origin/main",
      ],
      setupCmds: ["./scripts/setup-worktree.sh", "bun install"],
      agentCmd: "claude --session-id abc 'hello'",
    });

    expect(command).toContain("git fetch origin main");
    expect(command).toContain("git worktree add -b task-123");
    expect(command).toContain("/repo/.kanna-worktrees/task-123");
    expect(command).toContain("origin/main");
    expect(command).not.toContain("start_ref=");
    expect(command).not.toContain("if git remote get-url origin");
    expect(command).not.toContain("if git fetch origin main; then");
    expect(command).toContain("cd '/repo/.kanna-worktrees/task-123'");
    expect(command).toContain("./scripts/setup-worktree.sh");
    expect(command).toContain("bun install");
    expect(command).toContain("claude --session-id abc 'hello'");
  });

  it("shows the stage-advance worktree command without executing it again", () => {
    const command = buildTaskBootstrapCommand({
      worktreePath: "/repo/.kanna-worktrees/task-pr",
      visibleBootstrapSteps: [
        "git worktree add -b task-pr '/repo/.kanna-worktrees/task-pr' HEAD",
      ],
      setupCmds: ["./scripts/setup-worktree.sh"],
      agentCmd: "claude --session-id abc",
    });

    expect(command).not.toContain("git fetch origin");
    expect(command).toContain("git worktree add -b task-pr");
    expect(command).toContain("/repo/.kanna-worktrees/task-pr");
    expect(command).toContain("HEAD");
    expect(command).toContain("cd '/repo/.kanna-worktrees/task-pr'");
    expect(command).not.toContain("git worktree add -b task-pr '/repo/.kanna-worktrees/task-pr' HEAD\n");
  });

  it("preserves the bundled kanna-cli prelude before the bootstrapped agent starts", () => {
    const agentCmd = buildTaskShellCommand("claude --session-id abc", [], {
      kannaCliPath: "/Applications/Kanna.app/Contents/MacOS/kanna-cli-aarch64-apple-darwin",
    });
    const command = buildTaskBootstrapCommand({
      worktreePath: "/repo/.kanna-worktrees/task-123",
      visibleBootstrapSteps: [
        "git fetch origin main",
        "git worktree add -b task-123 '/repo/.kanna-worktrees/task-123' origin/main",
      ],
      setupCmds: ["./scripts/setup-worktree.sh"],
      agentCmd,
    });

    expect(command).toContain(
      "export KANNA_CLI_PATH='/Applications/Kanna.app/Contents/MacOS/kanna-cli-aarch64-apple-darwin'",
    );
    expect(command).toContain(
      "export PATH='/Applications/Kanna.app/Contents/MacOS':\"$PATH\"",
    );
  });
});
