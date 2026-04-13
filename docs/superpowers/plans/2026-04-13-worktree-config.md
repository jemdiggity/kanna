# Worktree-Scoped Task Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make task lifecycle runtime config resolve from each task's worktree snapshot instead of the root repo checkout.

**Architecture:** Keep config parsing centralized in the existing store helper pattern, but add a path-based reader that can target either a repo root or a task worktree. Switch task bootstrap and teardown flows to pass the task worktree path so setup and teardown commands always come from the same checked-out snapshot as the task code.

**Tech Stack:** Vue 3, Pinia, TypeScript, Vitest, Tauri invoke commands

---

### Task 1: Add a path-scoped repo config reader

**Files:**
- Modify: `apps/desktop/src/stores/kanna.ts`

- [ ] **Step 1: Write the failing test**

Add a unit test near the store config-loading coverage that expects a helper reading `/repo/.kanna-worktrees/task-123/.kanna/config.json` to return `setup` and `teardown` from that path instead of `/repo/.kanna/config.json`.

```ts
it("reads repo config from the provided filesystem path", async () => {
  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "read_text_file" && args?.path === "/repo/.kanna-worktrees/task-123/.kanna/config.json") {
      return JSON.stringify({ setup: ["pnpm install"], teardown: ["pnpm clean"] });
    }
    throw new Error(`unexpected invoke: ${command} ${JSON.stringify(args)}`);
  });

  const config = await readRepoConfigAtPath("/repo/.kanna-worktrees/task-123");

  expect(config.setup).toEqual(["pnpm install"]);
  expect(config.teardown).toEqual(["pnpm clean"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest apps/desktop/src/stores/kanna*.test.ts`
Expected: FAIL because `readRepoConfigAtPath` does not exist yet, or because the test file does not yet cover this behavior.

- [ ] **Step 3: Write minimal implementation**

Add a small helper in `apps/desktop/src/stores/kanna.ts` that reads `<basePath>/.kanna/config.json`, parses it with `parseRepoConfig`, and returns `{}` on missing-file reads just like the current repo-level helper.

```ts
async function readRepoConfigAtPath(basePath: string): Promise<RepoConfig> {
  try {
    const content = await invoke<string>("read_text_file", {
      path: `${basePath}/.kanna/config.json`,
    });
    return content ? parseRepoConfig(content) : {};
  } catch (e) {
    console.debug("[store] no .kanna/config.json:", e);
    return {};
  }
}

async function readRepoConfig(repoPath: string): Promise<RepoConfig> {
  return readRepoConfigAtPath(repoPath);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest apps/desktop/src/stores/kanna*.test.ts`
Expected: PASS for the new helper coverage.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/stores/kanna.ts
git commit -m "refactor: add path-scoped repo config reader"
```

### Task 2: Load setup config from the created worktree

**Files:**
- Modify: `apps/desktop/src/stores/kanna.ts`
- Test: `apps/desktop/src/stores/kanna*.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test that exercises task setup after worktree creation and expects startup commands to come from `${worktreePath}/.kanna/config.json`, not `${repoPath}/.kanna/config.json`.

```ts
it("loads setup commands from the task worktree config", async () => {
  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "read_text_file" && args?.path === "/repo/.kanna-worktrees/task-123/.kanna/config.json") {
      return JSON.stringify({ setup: ["./scripts/from-worktree.sh"] });
    }
    if (command === "read_text_file" && args?.path === "/repo/.kanna/config.json") {
      return JSON.stringify({ setup: ["./scripts/from-root.sh"] });
    }
    return defaultInvoke(command, args);
  });

  await store.setupWorktreeAndSpawn(
    "task-123",
    "/repo",
    "/repo/.kanna-worktrees/task-123",
    "task-123",
    {},
    "prompt",
    "pty",
    "claude",
  );

  expect(spawnedBootstrapCommand()).toContain("./scripts/from-worktree.sh");
  expect(spawnedBootstrapCommand()).not.toContain("./scripts/from-root.sh");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest apps/desktop/src/stores/kanna*.test.ts`
Expected: FAIL because `setupWorktreeAndSpawn` still reads config from `repoPath`.

- [ ] **Step 3: Write minimal implementation**

Change the task setup flow in `apps/desktop/src/stores/kanna.ts` so repo config is loaded from `worktreePath` after `createWorktree(...)` completes.

```ts
const [bootstrap] = await Promise.all([
  createWorktree(repoPath, branch, worktreePath, opts?.baseBranch),
]);
const config = await readRepoConfigAtPath(worktreePath);
repoConfig = config;
worktreeBootstrap = bootstrap;
```

If the current parallel structure reads better, keep it simple and sequential instead:

```ts
worktreeBootstrap = await createWorktree(repoPath, branch, worktreePath, opts?.baseBranch);
repoConfig = await readRepoConfigAtPath(worktreePath);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest apps/desktop/src/stores/kanna*.test.ts`
Expected: PASS and bootstrap command contains only the worktree-scoped setup command.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/stores/kanna.ts
git commit -m "fix: load task setup config from worktree"
```

### Task 3: Load teardown config from the task worktree

**Files:**
- Modify: `apps/desktop/src/stores/kanna.ts`
- Test: `apps/desktop/src/stores/kanna*.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test for task close that expects teardown commands to be read from `${repo.path}/.kanna-worktrees/${item.branch}/.kanna/config.json`.

```ts
it("loads teardown commands from the task worktree config", async () => {
  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "read_text_file" && args?.path === "/repo/.kanna-worktrees/task-123/.kanna/config.json") {
      return JSON.stringify({ teardown: ["./scripts/worktree-teardown.sh"] });
    }
    if (command === "read_text_file" && args?.path === "/repo/.kanna/config.json") {
      return JSON.stringify({ teardown: ["./scripts/root-teardown.sh"] });
    }
    return defaultInvoke(command, args);
  });

  await store.closeTask("task-123");

  expect(spawnedTeardownCommand()).toContain("./scripts/worktree-teardown.sh");
  expect(spawnedTeardownCommand()).not.toContain("./scripts/root-teardown.sh");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest apps/desktop/src/stores/kanna*.test.ts`
Expected: FAIL because `collectTeardownCommands` still reads repo config from `repo.path`.

- [ ] **Step 3: Write minimal implementation**

Update teardown command collection to compute the task worktree path and load `.kanna/config.json` from there.

```ts
async function collectTeardownCommands(item: PipelineItem, repo: Repo): Promise<string[]> {
  const cmds: string[] = [];
  const worktreePath = `${repo.path}/.kanna-worktrees/${item.branch}`;

  // existing custom task teardown lookup stays the same

  const repoConfig = await readRepoConfigAtPath(worktreePath);
  if (repoConfig.teardown?.length) {
    cmds.push(...repoConfig.teardown);
  }
  return cmds;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest apps/desktop/src/stores/kanna*.test.ts`
Expected: PASS and teardown uses only worktree-scoped commands.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/stores/kanna.ts
git commit -m "fix: load task teardown config from worktree"
```

### Task 4: Cover missing worktree config and verify types

**Files:**
- Modify: `apps/desktop/src/stores/kanna.ts`
- Test: `apps/desktop/src/stores/kanna*.test.ts`

- [ ] **Step 1: Write the failing test**

Add tests showing missing worktree config is non-fatal for both task setup and task close.

```ts
it("treats missing worktree config as empty during setup", async () => {
  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "read_text_file" && args?.path === "/repo/.kanna-worktrees/task-123/.kanna/config.json") {
      throw new Error("No such file");
    }
    return defaultInvoke(command, args);
  });

  await expect(store.setupWorktreeAndSpawn(
    "task-123",
    "/repo",
    "/repo/.kanna-worktrees/task-123",
    "task-123",
    {},
    "prompt",
    "pty",
    "claude",
  )).resolves.toBeUndefined();
});

it("treats missing worktree config as empty during teardown", async () => {
  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "read_text_file" && args?.path === "/repo/.kanna-worktrees/task-123/.kanna/config.json") {
      throw new Error("No such file");
    }
    return defaultInvoke(command, args);
  });

  await expect(store.closeTask("task-123")).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest apps/desktop/src/stores/kanna*.test.ts`
Expected: FAIL if setup or close still depends on root config or bubbles the missing-file read unexpectedly.

- [ ] **Step 3: Write minimal implementation**

Keep `readRepoConfigAtPath` returning `{}` when the worktree config file is missing, and update any touched call sites to rely on that behavior without adding separate fallback reads to `repo.path`.

```ts
const repoConfig = await readRepoConfigAtPath(worktreePath);
const setupCmds = repoConfig.setup || [];
const teardownCmds = repoConfig.teardown || [];
```

- [ ] **Step 4: Run focused verification**

Run: `pnpm vitest apps/desktop/src/stores/kanna*.test.ts`
Expected: PASS for the new missing-config cases.

- [ ] **Step 5: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS with no TypeScript errors introduced by the refactor.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/stores/kanna.ts
git commit -m "test: cover missing worktree task config"
```

### Task 5: Final verification

**Files:**
- Modify: `docs/superpowers/plans/2026-04-13-worktree-config.md`

- [ ] **Step 1: Run the relevant test suite**

Run: `pnpm vitest apps/desktop/src/stores/kanna*.test.ts`
Expected: PASS

- [ ] **Step 2: Run the required TypeScript verification**

Run: `pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Inspect the diff for scope**

Run: `git diff -- apps/desktop/src/stores/kanna.ts docs/superpowers/specs/2026-04-13-worktree-config-design.md docs/superpowers/plans/2026-04-13-worktree-config.md`
Expected: Only worktree-config planning/spec changes and the targeted store logic updates

- [ ] **Step 4: Commit the plan status update if needed**

```bash
git add apps/desktop/src/stores/kanna.ts docs/superpowers/plans/2026-04-13-worktree-config.md
git commit -m "fix: use worktree task config for lifecycle scripts"
```
