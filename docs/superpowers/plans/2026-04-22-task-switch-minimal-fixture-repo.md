# Task Switch Minimal Fixture Repo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the task-switch perf E2E substrate with a committed minimal seed repo materialized into a disposable git repo plus local bare origin at runtime, then measure task switching against deterministic multi-screen PTY output.

**Architecture:** Keep the existing clone-the-live-repo helper for tests that need full Kanna behavior, and add a separate seed-fixture helper for tests that need a controlled repo. The task-switch perf E2E will use the new helper, create deterministic PTY-backed task sessions against that repo, switch between them multiple times, and log summarized task-switch metrics.

**Tech Stack:** Node `fs/promises`, Git CLI, Vitest, Tauri E2E harness, existing task-switch perf recorder

---

### Task 1: Add a Seed-Fixture Repo Helper

**Files:**
- Modify: `apps/desktop/tests/e2e/helpers/fixture-repo.ts`
- Test: `apps/desktop/tests/e2e/helpers/fixture-repo.test.ts`

- [ ] **Step 1: Write the failing helper test for seed-fixture repo materialization**

Add a test that creates a disposable repo from committed fixture content, then verifies:

- the working repo exists outside the live checkout
- the working repo is a real git repo
- `origin` exists and points at a local bare repo
- `origin` has a `main` branch

- [ ] **Step 2: Run the helper test to verify it fails**

Run: `pnpm --dir apps/desktop exec vitest run tests/e2e/helpers/fixture-repo.test.ts`

Expected: FAIL because no helper exists for seed-fixture repo materialization.

- [ ] **Step 3: Implement the new helper in `fixture-repo.ts`**

Add a helper that:

- copies committed seed content into a temp directory
- initializes a fresh git repo
- configures a local user name/email
- commits seed content on `main`
- creates a sibling local bare repo for `origin`
- pushes `main` to that `origin`

Do not change the semantics of the existing clone-based helper used by other tests.

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `pnpm --dir apps/desktop exec vitest run tests/e2e/helpers/fixture-repo.test.ts`

Expected: PASS.

### Task 2: Commit a Minimal Seed Repo for Task-Switch Perf

**Files:**
- Create: `apps/desktop/tests/e2e/fixtures/repos/task-switch-minimal/README.md`
- Create: `apps/desktop/tests/e2e/fixtures/repos/task-switch-minimal/src/index.txt`

- [ ] **Step 1: Add the committed seed repo contents**

Create a tiny committed repo fixture with ordinary files only:

- no nested `.git`
- no `.kanna/config.json`
- no install/bootstrap scripts

- [ ] **Step 2: Keep the fixture intentionally small**

The seed repo only needs enough normal content to be a realistic git repo. Avoid package-manager or build-tool files unless the test explicitly needs them.

### Task 3: Rework the Task-Switch Perf E2E to Use the Minimal Repo

**Files:**
- Modify: `apps/desktop/tests/e2e/mock/task-switch-performance.test.ts`
- Test: `apps/desktop/tests/e2e/mock/task-switch-performance.test.ts`

- [ ] **Step 1: Write the failing E2E change**

Change the test setup to use the new seed-fixture helper and to expect multiple completed task-switch perf records from repeated switching.

- [ ] **Step 2: Run the E2E test to verify the new expectation fails**

Run: `pnpm --dir apps/desktop exec tsx tests/e2e/run.ts mock/task-switch-performance.test.ts`

Expected: FAIL until the new helper integration and repeated-switch reporting are implemented.

- [ ] **Step 3: Replace the clone-based fixture setup**

In `task-switch-performance.test.ts`, materialize the minimal seed repo, import that repo path directly, and keep teardown wired through the existing cleanup helper.

- [ ] **Step 4: Remove `createItem()` as the source of PTY output**

Create the minimal DB/task state needed for two PTY tasks and real worktrees, then spawn deterministic PTY sessions that print several screens of numbered text.

The PTY commands should:

- emit large deterministic scrollback
- keep the session alive long enough for manual observation and switching
- avoid repo setup/bootstrap noise

- [ ] **Step 5: Switch between tasks multiple times**

Drive at least three completed task switches so the output captures more than a single warm/cold transition.

- [ ] **Step 6: Print summarized performance metrics**

Log a compact summary derived from all completed task-switch perf records, including:

- task id or prompt
- path
- total
- mount
- ready
- first-output timing when present

- [ ] **Step 7: Run the E2E test to verify it passes**

Run: `pnpm --dir apps/desktop exec tsx tests/e2e/run.ts mock/task-switch-performance.test.ts`

Expected: PASS with task-switch summary output.

### Task 4: Verify Slow-Mode Observability

**Files:**
- Modify: `apps/desktop/tests/e2e/mock/task-switch-performance.test.ts`
- Test: `apps/desktop/tests/e2e/mock/task-switch-performance.test.ts`

- [ ] **Step 1: Keep slow-mode checkpoints around visible transitions**

Ensure slow-mode pauses exist around:

- repo import
- session/task availability
- each visible switch
- metric capture

- [ ] **Step 2: Run the slow-mode E2E path**

Run: `KANNA_E2E_SLOW_MODE_MS=1000 pnpm --dir apps/desktop exec tsx tests/e2e/run.ts mock/task-switch-performance.test.ts`

Expected: PASS with a long enough runtime to confirm that visible pauses occurred.

### Task 5: Final Verification

**Files:**
- Verify all files touched above

- [ ] **Step 1: Run focused helper and E2E verification**

Run:

```bash
pnpm --dir apps/desktop exec vitest run tests/e2e/helpers/fixture-repo.test.ts
pnpm --dir apps/desktop exec tsc --noEmit
pnpm --dir apps/desktop exec tsx tests/e2e/run.ts mock/task-switch-performance.test.ts
KANNA_E2E_SLOW_MODE_MS=1000 pnpm --dir apps/desktop exec tsx tests/e2e/run.ts mock/task-switch-performance.test.ts
```

Expected: all PASS.
