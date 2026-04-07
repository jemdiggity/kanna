# Visible Task Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show git worktree creation and repo-owned setup in the same terminal session the user will use for the task.

**Architecture:** PTY task creation will switch from a hidden background worktree setup path to a visible bootstrap shell path. The store will spawn the daemon session before worktree creation, and a pure helper will generate the shell command sequence. Kanna-specific `.build` preparation will move from the generic Rust git command into this repo’s visible setup script.

**Tech Stack:** Vue 3, Pinia store logic, Vitest, Tauri Rust commands, POSIX shell scripts

---

### Task 1: Cover bootstrap command generation with a failing unit test

**Files:**
- Create: `apps/desktop/src/utils/taskBootstrap.ts`
- Create: `apps/desktop/src/utils/taskBootstrap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildTaskBootstrapCommand } from "./taskBootstrap";

describe("buildTaskBootstrapCommand", () => {
  it("renders visible git setup and repo setup before the agent command for new tasks", () => {
    const command = buildTaskBootstrapCommand({
      repoPath: "/repo",
      worktreePath: "/repo/.kanna-worktrees/task-123",
      branch: "task-123",
      baseBranch: undefined,
      defaultBranch: "main",
      setupCmds: ["./scripts/setup-worktree.sh", "bun install"],
      agentCmd: "claude --session-id abc 'hello'",
    });

    expect(command).toContain("git fetch origin main");
    expect(command).toContain("git worktree add -b task-123 /repo/.kanna-worktrees/task-123 origin/main");
    expect(command).toContain("cd /repo/.kanna-worktrees/task-123");
    expect(command).toContain("./scripts/setup-worktree.sh");
    expect(command).toContain("bun install");
    expect(command).toContain("claude --session-id abc 'hello'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test src/utils/taskBootstrap.test.ts`
Expected: FAIL with module or export not found for `buildTaskBootstrapCommand`

- [ ] **Step 3: Write minimal implementation**

```ts
export interface TaskBootstrapCommandOptions {
  repoPath: string;
  worktreePath: string;
  branch: string;
  baseBranch?: string;
  defaultBranch?: string | null;
  setupCmds: string[];
  agentCmd: string;
}

export function buildTaskBootstrapCommand(options: TaskBootstrapCommandOptions): string {
  return options.agentCmd;
}
```

- [ ] **Step 4: Run test to verify it still fails for missing behavior**

Run: `cd apps/desktop && bun test src/utils/taskBootstrap.test.ts`
Expected: FAIL because the command string does not include git setup or repo setup steps

### Task 2: Implement the PTY bootstrap command builder

**Files:**
- Modify: `apps/desktop/src/utils/taskBootstrap.ts`
- Modify: `apps/desktop/src/utils/taskBootstrap.test.ts`

- [ ] **Step 1: Expand the tests for base-branch tasks**

```ts
it("skips fetch and uses HEAD for stage-advance worktrees", () => {
  const command = buildTaskBootstrapCommand({
    repoPath: "/repo",
    worktreePath: "/repo/.kanna-worktrees/task-pr",
    branch: "task-pr",
    baseBranch: "task-impl",
    defaultBranch: "main",
    setupCmds: ["./scripts/setup-worktree.sh"],
    agentCmd: "claude --session-id abc",
  });

  expect(command).not.toContain("git fetch origin");
  expect(command).toContain("git worktree add -b task-pr /repo/.kanna-worktrees/task-pr HEAD");
  expect(command).toContain("cd /repo/.kanna-worktrees/task-pr");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test src/utils/taskBootstrap.test.ts`
Expected: FAIL because the helper does not distinguish fresh tasks from base-branch tasks

- [ ] **Step 3: Write minimal implementation**

```ts
function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function renderVisibleStep(command: string): string {
  const escaped = command.replace(/'/g, `'\\''`);
  return `printf '\\033[2m$ %s\\033[0m\\n' '${escaped}' && ${command}`;
}

export function buildTaskBootstrapCommand(options: TaskBootstrapCommandOptions): string {
  const gitSetup = options.baseBranch
    ? [
        `cd ${shSingleQuote(`${options.repoPath}/.kanna-worktrees/${options.baseBranch}`)}`,
        renderVisibleStep(
          `git worktree add -b ${options.branch} ${shSingleQuote(options.worktreePath)} HEAD`,
        ),
      ]
    : [
        `cd ${shSingleQuote(options.repoPath)}`,
        renderVisibleStep(`git fetch origin ${options.defaultBranch ?? "main"}`),
        renderVisibleStep(
          `git worktree add -b ${options.branch} ${shSingleQuote(options.worktreePath)} origin/${options.defaultBranch ?? "main"}`,
        ),
      ];

  const setupSteps = options.setupCmds.map((cmd) => renderVisibleStep(cmd));

  return [
    "printf '\\033[33mPreparing task...\\033[0m\\n'",
    ...gitSetup,
    `cd ${shSingleQuote(options.worktreePath)}`,
    ...setupSteps,
    "printf '\\n'",
    options.agentCmd,
  ].join(" && ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && bun test src/utils/taskBootstrap.test.ts`
Expected: PASS

### Task 3: Switch PTY task creation to the visible bootstrap session

**Files:**
- Modify: `apps/desktop/src/stores/kanna.ts`
- Modify: `apps/desktop/src/utils/taskBootstrap.ts`

- [ ] **Step 1: Add a failing integration-style store assertion**

```ts
it("builds PTY task sessions from a visible bootstrap command instead of background worktree creation", async () => {
  // Assert that the spawned PTY session uses repoPath cwd, includes visible git setup,
  // and that createWorktree is not awaited on the PTY path.
});
```

- [ ] **Step 2: Run the targeted test command and verify failure**

Run: `cd apps/desktop && bun test src/utils/taskBootstrap.test.ts src/composables/terminalSpawnOptions.test.ts`
Expected: existing tests pass, new store-oriented assertion is absent or failing

- [ ] **Step 3: Implement the PTY path in the store**

```ts
// In setupWorktreeAndSpawn():
// - keep SDK branch on the existing createWorktree + create_agent_session path
// - for PTY branch:
//   - read repo config
//   - compute port env
//   - compute default branch when needed
//   - build bootstrap command with visible git + setup + agent steps
//   - invoke spawn_session with cwd repoPath or base worktree path
//   - selectItem(id) immediately after session spawn succeeds
```

- [ ] **Step 4: Run targeted tests**

Run: `cd apps/desktop && bun test src/utils/taskBootstrap.test.ts src/composables/terminalSpawnOptions.test.ts apps/desktop/tests/e2e/mock/task-lifecycle.test.ts`
Expected: PASS for unit tests; if the e2e target is not runnable in this environment, note that explicitly and continue with unit verification

### Task 4: Move `.build` preparation into repo-owned visible setup

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/git.rs`
- Modify: `.kanna/config.json`
- Create: `scripts/setup-worktree.sh`

- [ ] **Step 1: Add the repo setup script reference**

```json
{
  "setup": [
    "./scripts/setup-worktree.sh",
    "bun install",
    "[ -f ../../.claude/settings.local.json ] && mkdir -p .claude && cp ../../.claude/settings.local.json .claude/"
  ]
}
```

- [ ] **Step 2: Add the repo-owned script**

```sh
#!/bin/sh
set -eu

repo_root="$(git rev-parse --show-toplevel)"
git_common_dir="$(git rev-parse --git-common-dir)"
main_repo_root="$(cd "${git_common_dir}/.." && pwd)"

mkdir -p .cargo
printf "[build]\ntarget-dir = \".build\"\n" > .cargo/config.toml

if [ -d "${main_repo_root}/.build" ] && [ ! -e ".build" ]; then
  cp -c -R "${main_repo_root}/.build" .build
fi
```

- [ ] **Step 3: Remove `.build` cloning from the Rust command**

```rust
// Delete the APFS clone block from git_worktree_add().
// Keep only generic worktree creation and the return value.
```

- [ ] **Step 4: Run verification**

Run: `cd apps/desktop && bun test src/utils/taskBootstrap.test.ts src/composables/terminalSpawnOptions.test.ts`
Expected: PASS

Run: `cd apps/desktop/src-tauri && cargo test`
Expected: PASS or a clear existing-failure note if unrelated tests are already broken

### Task 5: Final verification

**Files:**
- Modify: `docs/superpowers/specs/2026-04-07-visible-task-bootstrap-design.md`
- Modify: `docs/superpowers/plans/2026-04-07-visible-task-bootstrap.md`

- [ ] **Step 1: Re-read the spec and plan for coverage**

```md
Confirm the implementation covers:
- visible git setup in the task terminal
- repo-owned `.build` preparation
- PTY-only behavior change
- unchanged SDK path
```

- [ ] **Step 2: Run TypeScript verification**

Run: `bun tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Run targeted desktop tests**

Run: `cd apps/desktop && bun test src/utils/taskBootstrap.test.ts src/composables/terminalSpawnOptions.test.ts`
Expected: PASS

- [ ] **Step 4: Run Rust verification**

Run: `cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy -- -D warnings`
Expected: PASS
