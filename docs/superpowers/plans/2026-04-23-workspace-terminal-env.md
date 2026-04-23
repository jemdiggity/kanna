# Workspace Terminal Env Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `.kanna/config.json` to define workspace env vars and `PATH` mutations that apply to every worktree terminal Kanna launches.

**Architecture:** Extend the existing repo-config schema with a `workspace` section, parse it in `@kanna/core`, and route all worktree-backed session creation through one shared env builder. PTY agents, SDK agents, and shell sessions should all consume the same merged worktree env so behavior stays consistent.

**Tech Stack:** TypeScript, Vue 3, Pinia, Vitest, Tauri invoke commands

---

### Task 1: Extend repo config parsing for workspace env

**Files:**
- Modify: `packages/core/src/config/repo-config.ts`
- Test: `packages/core/src/config/repo-config.test.ts`

- [ ] **Step 1: Write the failing test**

Add parser coverage for valid and invalid `workspace` config:

```ts
it("parses workspace env and path config", () => {
  const config = parseRepoConfig(JSON.stringify({
    workspace: {
      env: { FOO: "bar", BAZ: "qux" },
      path: { prepend: ["./bin"], append: ["/usr/local/custom"] },
    },
  }));

  expect(config.workspace).toEqual({
    env: { FOO: "bar", BAZ: "qux" },
    path: { prepend: ["./bin"], append: ["/usr/local/custom"] },
  });
});

it("ignores malformed workspace env and path entries", () => {
  const config = parseRepoConfig(JSON.stringify({
    workspace: {
      env: { GOOD: "ok", BAD: 42 },
      path: { prepend: ["./bin", 1], append: "nope" },
    },
  }));

  expect(config.workspace).toEqual({
    env: { GOOD: "ok" },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest packages/core/src/config/repo-config.test.ts`
Expected: FAIL because `RepoConfig` does not yet parse `workspace`.

- [ ] **Step 3: Write minimal implementation**

Add `workspace` interfaces and parser branches that accept only string env values and string arrays for `prepend` / `append`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest packages/core/src/config/repo-config.test.ts`
Expected: PASS.

### Task 2: Add a shared worktree env builder

**Files:**
- Add: `apps/desktop/src/stores/worktreeEnv.ts`
- Test: `apps/desktop/src/stores/worktreeEnv.test.ts`

- [ ] **Step 1: Write the failing test**

Add unit tests that verify:

```ts
it("merges workspace env, resolved PATH updates, and port env", () => {
  const env = buildWorktreeRuntimeEnv({
    worktreePath: "/tmp/repo/.kanna-worktrees/task-123",
    baseEnv: { PATH: "/usr/bin:/bin", TERM: "xterm-256color" },
    repoConfig: {
      workspace: {
        env: { FOO: "bar" },
        path: { prepend: ["./bin"], append: ["vendor/tools"] },
      },
    },
    portEnv: { KANNA_DEV_PORT: "1421" },
  });

  expect(env).toEqual({
    PATH: "/tmp/repo/.kanna-worktrees/task-123/bin:/usr/bin:/bin:/tmp/repo/.kanna-worktrees/task-123/vendor/tools",
    TERM: "xterm-256color",
    FOO: "bar",
    KANNA_DEV_PORT: "1421",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest apps/desktop/src/stores/worktreeEnv.test.ts`
Expected: FAIL because the helper does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create a focused helper that resolves relative path entries against `worktreePath`, preserves absolute entries, and merges env in the documented precedence order.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest apps/desktop/src/stores/worktreeEnv.test.ts`
Expected: PASS.

### Task 3: Route PTY, SDK, and shell sessions through the shared helper

**Files:**
- Modify: `apps/desktop/src/stores/sessions.ts`
- Modify: `apps/desktop/src/stores/tasks.ts`
- Modify: `apps/desktop/src/stores/state.ts`
- Test: `apps/desktop/src/stores/kanna.taskBaseBranch.test.ts`

- [ ] **Step 1: Write the failing tests**

Add store/session coverage that verifies:

- SDK task sessions receive `workspace.env` and resolved `PATH`
- worktree shell sessions receive the same values
- PTY task sessions receive the same values through `preparePtySession`

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest apps/desktop/src/stores/kanna.taskBaseBranch.test.ts apps/desktop/src/stores/worktreeEnv.test.ts`
Expected: FAIL because worktree env config is not propagated yet.

- [ ] **Step 3: Write minimal implementation**

Read repo config from the worktree path where task sessions are prepared, call the shared env builder, and use that merged env for:

- `spawnShellSession`
- `preparePtySession`
- SDK env construction in `setupWorktreeAndSpawn`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest apps/desktop/src/stores/kanna.taskBaseBranch.test.ts apps/desktop/src/stores/worktreeEnv.test.ts`
Expected: PASS.

### Task 4: Update example config and run verification

**Files:**
- Modify: `.kanna/config.json`

- [ ] **Step 1: Update the checked-in config example**

Add a commented-by-example `workspace` block or a concrete no-op-friendly example value that documents the new shape without changing existing behavior unexpectedly.

- [ ] **Step 2: Run focused verification**

Run: `pnpm vitest packages/core/src/config/repo-config.test.ts apps/desktop/src/stores/worktreeEnv.test.ts apps/desktop/src/stores/kanna.taskBaseBranch.test.ts`
Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.
