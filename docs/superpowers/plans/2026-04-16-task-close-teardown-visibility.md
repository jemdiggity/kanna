# Task Close Teardown Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make user-closed tasks stay visible in `teardown` only when teardown commands exist, and close directly to hidden `done` when no teardown commands exist.

**Architecture:** Keep `pipeline_item.stage` as the visibility source of truth. Push the close decision earlier in the store by resolving teardown commands before choosing the first-close transition, and keep the helper layer honest by teaching it about direct-close and selection handoff for the no-teardown path.

**Tech Stack:** Vue 3, Pinia, TypeScript, Vitest, mock E2E WebDriver tests, Tauri invoke helpers

---

## File Structure

- `apps/desktop/src/stores/taskCloseBehavior.ts`
  Responsibility: pure close-decision helper for blocked, teardown, and no-teardown first-close cases.
- `apps/desktop/src/stores/taskCloseBehavior.test.ts`
  Responsibility: unit coverage for first-close behavior with and without teardown commands.
- `apps/desktop/src/stores/taskCloseSelection.ts`
  Responsibility: pure helper for when `selectedItemId` should move immediately during close transitions.
- `apps/desktop/src/stores/taskCloseSelection.test.ts`
  Responsibility: unit coverage for visible-teardown selection and direct-close selection.
- `apps/desktop/src/stores/kannaCleanup.ts`
  Responsibility: teardown-session exit behavior and close cleanup helpers; remove the now-obsolete immediate-after-entering-teardown helper.
- `apps/desktop/src/stores/kannaCleanup.test.ts`
  Responsibility: unit coverage for teardown exit rules after removing the obsolete helper.
- `apps/desktop/src/stores/kanna.ts`
  Responsibility: resolve teardown commands before selecting the first-close path, close directly to `done` when teardown is absent, and preserve selection / cleanup semantics.
- `apps/desktop/tests/e2e/mock/task-lifecycle.test.ts`
  Responsibility: verify the user-visible lifecycle for close-with-teardown and close-without-teardown.

### Task 1: Update Pure Close-Behavior Rules

**Files:**
- Modify: `apps/desktop/src/stores/taskCloseBehavior.ts`
- Modify: `apps/desktop/src/stores/taskCloseBehavior.test.ts`

- [ ] **Step 1: Write the failing close-behavior tests**

Replace the test file contents in `apps/desktop/src/stores/taskCloseBehavior.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { getTaskCloseBehavior } from "./taskCloseBehavior";

describe("getTaskCloseBehavior", () => {
  it("enters teardown on first close when teardown commands exist", () => {
    expect(
      getTaskCloseBehavior({
        wasBlocked: false,
        currentStage: "in progress",
        hasTeardownCommands: true,
      }),
    ).toBe("enter-teardown");
  });

  it("finishes immediately on first close when teardown commands do not exist", () => {
    expect(
      getTaskCloseBehavior({
        wasBlocked: false,
        currentStage: "in progress",
        hasTeardownCommands: false,
      }),
    ).toBe("finish");
  });

  it("finishes blocked tasks immediately", () => {
    expect(
      getTaskCloseBehavior({
        wasBlocked: true,
        currentStage: "in progress",
        hasTeardownCommands: true,
      }),
    ).toBe("finish");
  });

  it("finishes tasks that are already in teardown", () => {
    expect(
      getTaskCloseBehavior({
        wasBlocked: false,
        currentStage: "teardown",
        hasTeardownCommands: true,
      }),
    ).toBe("finish");
  });

  it("treats legacy torndown as already in teardown", () => {
    expect(
      getTaskCloseBehavior({
        wasBlocked: false,
        currentStage: "torndown",
        hasTeardownCommands: true,
      }),
    ).toBe("finish");
  });
});
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/src/stores/taskCloseBehavior.test.ts`

Expected: FAIL because `TaskCloseBehaviorInput` does not yet accept `hasTeardownCommands`.

- [ ] **Step 3: Write the minimal close-behavior implementation**

Update `apps/desktop/src/stores/taskCloseBehavior.ts` to:

```ts
import { isTeardownStage } from "./taskStages";

export interface TaskCloseBehaviorInput {
  wasBlocked: boolean;
  currentStage: string;
  hasTeardownCommands: boolean;
}

export type TaskCloseBehavior = "finish" | "enter-teardown";

export function getTaskCloseBehavior(
  input: TaskCloseBehaviorInput,
): TaskCloseBehavior {
  if (
    input.wasBlocked ||
    isTeardownStage(input.currentStage) ||
    !input.hasTeardownCommands
  ) {
    return "finish";
  }

  return "enter-teardown";
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `pnpm exec vitest run apps/desktop/src/stores/taskCloseBehavior.test.ts`

Expected: PASS with 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/stores/taskCloseBehavior.ts apps/desktop/src/stores/taskCloseBehavior.test.ts
git commit -m "refactor: encode direct-close behavior"
```

### Task 2: Update Selection And Cleanup Helpers For Direct Close

**Files:**
- Modify: `apps/desktop/src/stores/taskCloseSelection.ts`
- Modify: `apps/desktop/src/stores/taskCloseSelection.test.ts`
- Modify: `apps/desktop/src/stores/kannaCleanup.ts`
- Modify: `apps/desktop/src/stores/kannaCleanup.test.ts`

- [ ] **Step 1: Write the failing selection and cleanup tests**

Update `apps/desktop/src/stores/taskCloseSelection.test.ts` to:

```ts
import { describe, expect, it } from "vitest";
import { shouldSelectNextOnCloseTransition } from "./taskCloseSelection";
import { TEARDOWN_STAGE } from "./taskStages";

describe("shouldSelectNextOnCloseTransition", () => {
  it("selects immediately when a normal task enters teardown", () => {
    expect(
      shouldSelectNextOnCloseTransition({
        selectNext: true,
        wasBlocked: false,
        previousStage: "in progress",
        nextStage: TEARDOWN_STAGE,
      }),
    ).toBe(true);
  });

  it("also selects immediately when a normal task closes directly to done", () => {
    expect(
      shouldSelectNextOnCloseTransition({
        selectNext: true,
        wasBlocked: false,
        previousStage: "in progress",
        nextStage: "done",
      }),
    ).toBe(true);
  });

  it("does not select when selection handoff is disabled", () => {
    expect(
      shouldSelectNextOnCloseTransition({
        selectNext: false,
        wasBlocked: false,
        previousStage: "in progress",
        nextStage: "done",
      }),
    ).toBe(false);
  });

  it("does not treat blocked-task close as an immediate selection handoff", () => {
    expect(
      shouldSelectNextOnCloseTransition({
        selectNext: true,
        wasBlocked: true,
        previousStage: "in progress",
        nextStage: "done",
      }),
    ).toBe(false);
  });

  it("does not reselect on final close after teardown", () => {
    expect(
      shouldSelectNextOnCloseTransition({
        selectNext: true,
        wasBlocked: false,
        previousStage: TEARDOWN_STAGE,
        nextStage: "done",
      }),
    ).toBe(false);
  });
});
```

Update `apps/desktop/src/stores/kannaCleanup.test.ts` by removing the `shouldAutoCloseTaskImmediatelyAfterEnteringTeardown` import and replacing the three immediate-after-entering-teardown assertions with this one:

```ts
it("keeps teardown exit auto-close logic focused on completed teardown sessions", () => {
  expect(shouldAutoCloseTaskAfterTeardownExit({ exitCode: 0, lingerEnabled: false })).toBe(true);
  expect(shouldAutoCloseTaskAfterTeardownExit({ exitCode: 1, lingerEnabled: false })).toBe(false);
  expect(shouldAutoCloseTaskAfterTeardownExit({ exitCode: 0, lingerEnabled: true })).toBe(false);
});
```

- [ ] **Step 2: Run the helper tests to verify they fail**

Run: `pnpm exec vitest run apps/desktop/src/stores/taskCloseSelection.test.ts apps/desktop/src/stores/kannaCleanup.test.ts`

Expected: FAIL because `shouldSelectNextOnCloseTransition()` still rejects direct `done` transitions and `kannaCleanup.test.ts` still references the soon-to-be-removed helper.

- [ ] **Step 3: Write the minimal helper implementations**

Update `apps/desktop/src/stores/taskCloseSelection.ts` to:

```ts
import { isTeardownStage, TEARDOWN_STAGE } from "./taskStages";

export interface CloseSelectionTransition {
  selectNext: boolean;
  wasBlocked: boolean;
  previousStage: string;
  nextStage: string;
}

export function shouldSelectNextOnCloseTransition(
  transition: CloseSelectionTransition,
): boolean {
  return (
    transition.selectNext &&
    !transition.wasBlocked &&
    !isTeardownStage(transition.previousStage) &&
    (transition.nextStage === TEARDOWN_STAGE || transition.nextStage === "done")
  );
}
```

Update `apps/desktop/src/stores/kannaCleanup.ts` by deleting the now-unused `EnterTeardownBehaviorInput` interface and `shouldAutoCloseTaskImmediatelyAfterEnteringTeardown()` function so the file only models teardown-session exit behavior.

- [ ] **Step 4: Run the helper tests to verify they pass**

Run: `pnpm exec vitest run apps/desktop/src/stores/taskCloseSelection.test.ts apps/desktop/src/stores/kannaCleanup.test.ts`

Expected: PASS with all tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/stores/taskCloseSelection.ts apps/desktop/src/stores/taskCloseSelection.test.ts apps/desktop/src/stores/kannaCleanup.ts apps/desktop/src/stores/kannaCleanup.test.ts
git commit -m "refactor: align close selection with direct done transitions"
```

### Task 3: Refactor The Store Close Flow To Choose Direct Close Or Teardown Up Front

**Files:**
- Modify: `apps/desktop/src/stores/kanna.ts`

- [ ] **Step 1: Write the failing store-adjacent tests first**

Extend the existing pure-helper tests before touching the store by adding one more expectation to `apps/desktop/src/stores/taskCloseSelection.test.ts`:

```ts
it("does not require a teardown stage write before selecting the next item", () => {
  expect(
    shouldSelectNextOnCloseTransition({
      selectNext: true,
      wasBlocked: false,
      previousStage: "pr",
      nextStage: "done",
    }),
  ).toBe(true);
});
```

This guards the exact store behavior we are about to depend on for the direct-close path.

- [ ] **Step 2: Run the selection helper test to verify it passes before the store edit**

Run: `pnpm exec vitest run apps/desktop/src/stores/taskCloseSelection.test.ts`

Expected: PASS. This confirms the helper layer is ready and any later regression is inside `kanna.ts`.

- [ ] **Step 3: Refactor `closeTask()` to choose the transition before mutating stage**

In `apps/desktop/src/stores/kanna.ts`, update the `closeTask()` flow so it follows this structure:

```ts
const wasBlocked = hasTag(item, "blocked");
const existingTeardown = isTeardownStage(item.stage);
const teardownCmds =
  wasBlocked || existingTeardown
    ? []
    : await collectTeardownCommands(item, repo);

const closeBehavior = getTaskCloseBehavior({
  wasBlocked,
  currentStage: item.stage,
  hasTeardownCommands: teardownCmds.length > 0,
});
```

Then keep the existing blocked-task and second-close teardown branches, but replace the normal first-close section with this shape:

```ts
if (closeBehavior === "finish" && !wasBlocked && !existingTeardown) {
  await Promise.all([
    invoke("kill_session", { sessionId: item.id }).catch((e: unknown) =>
      reportCloseSessionError("[store] kill agent session failed:", e)),
    invoke("kill_session", { sessionId: `shell-wt-${item.id}` }).catch((e: unknown) =>
      reportCloseSessionError("[store] kill shell session failed:", e)),
  ]);

  if (shouldSelectNextOnCloseTransition({
    selectNext: opts?.selectNext !== false,
    wasBlocked,
    previousStage: item.stage,
    nextStage: "done",
  })) {
    selectNextItem(nextId);
  }

  await closeTaskAndReleasePorts(item.id, (id) => closePipelineItem(_db, id));
  await checkUnblocked(item.id);
  bump();
  return;
}
```

Leave the `enter-teardown` branch responsible for:

- sending `SIGINT` to the agent session
- spawning the `td-<item.id>` session
- writing `stage = TEARDOWN_STAGE`
- selecting next immediately for the visible-teardown case

Do not reintroduce a path that writes `teardown` and then immediately closes it when there are zero teardown commands.

- [ ] **Step 4: Run focused store-adjacent verification**

Run:

```bash
pnpm exec vitest run apps/desktop/src/stores/taskCloseBehavior.test.ts apps/desktop/src/stores/taskCloseSelection.test.ts apps/desktop/src/stores/kannaCleanup.test.ts apps/desktop/src/stores/kannaConfig.test.ts
pnpm exec tsc --noEmit
```

Expected:

- all Vitest files PASS
- TypeScript exits cleanly with no errors

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/stores/kanna.ts apps/desktop/src/stores/taskCloseBehavior.ts apps/desktop/src/stores/taskCloseBehavior.test.ts apps/desktop/src/stores/taskCloseSelection.ts apps/desktop/src/stores/taskCloseSelection.test.ts apps/desktop/src/stores/kannaCleanup.ts apps/desktop/src/stores/kannaCleanup.test.ts
git commit -m "fix: close tasks directly when teardown is absent"
```

### Task 4: Update Mock E2E Coverage For Both Close Outcomes

**Files:**
- Modify: `apps/desktop/tests/e2e/mock/task-lifecycle.test.ts`

- [ ] **Step 1: Write the failing mock E2E expectations**

Rewrite the close section of `apps/desktop/tests/e2e/mock/task-lifecycle.test.ts` into two tests:

```ts
it("closes into teardown and stays visible when teardown commands exist", async () => {
  const result = await client.executeAsync<string>(
    `const cb = arguments[arguments.length - 1];
     const ctx = window.__KANNA_E2E__.setupState;
     const item = ctx.selectedItem();
     if (!item) { cb("no item"); return; }
     Promise.resolve(ctx.store.closeTask(item.id))
       .then(() => cb("ok"))
       .catch((error) => cb("err:" + error));`
  );
  expect(result).toBe("ok");

  await sleep(500);
  const stageRows = (await queryDb(
    client,
    "SELECT stage FROM pipeline_item WHERE repo_id = ? AND prompt = ? ORDER BY created_at DESC LIMIT 1",
    [repoId, "Say OK"],
  )) as Array<{ stage: string }>;
  expect(stageRows[0]?.stage).toBe("teardown");

  const sidebarText = await client.executeSync<string>(
    `return document.querySelector(".sidebar")?.textContent || "";`
  );
  expect(sidebarText).toContain("Say OK");
});

it("closes directly to done and disappears when teardown commands do not exist", async () => {
  const createResult = await client.executeAsync<string>(
    `const cb = arguments[arguments.length - 1];
     const ctx = window.__KANNA_E2E__.setupState;
     ctx.createItem(${JSON.stringify(repoId)}, ${JSON.stringify(TEST_REPO_PATH)}, "Close Fast", "sdk")
       .then(() => cb("ok"))
       .catch((error) => cb("err:" + error));`
  );
  expect(createResult).toBe("ok");

  const rows = (await queryDb(
    client,
    "SELECT id, branch FROM pipeline_item WHERE repo_id = ? AND prompt = ? ORDER BY created_at DESC LIMIT 1",
    [repoId, "Close Fast"],
  )) as Array<{ id: string; branch: string }>;
  const branch = rows[0]?.branch;
  expect(branch).toBeTruthy();

  await tauriInvoke(client, "write_text_file", {
    path: `${TEST_REPO_PATH}/.kanna-worktrees/${branch}/.kanna/config.json`,
    content: JSON.stringify({ setup: [] }),
  });

  const closeResult = await client.executeAsync<string>(
    `const cb = arguments[arguments.length - 1];
     const ctx = window.__KANNA_E2E__.setupState;
     const item = ctx.selectedItem();
     if (!item) { cb("no item"); return; }
     Promise.resolve(ctx.store.closeTask(item.id))
       .then(() => cb("ok"))
       .catch((error) => cb("err:" + error));`
  );
  expect(closeResult).toBe("ok");

  await sleep(500);
  const stageRows = (await queryDb(
    client,
    "SELECT stage FROM pipeline_item WHERE repo_id = ? AND prompt = ? ORDER BY created_at DESC LIMIT 1",
    [repoId, "Close Fast"],
  )) as Array<{ stage: string }>;
  expect(stageRows[0]?.stage).toBe("done");

  const sidebarText = await client.executeSync<string>(
    `return document.querySelector(".sidebar")?.textContent || "";`
  );
  expect(sidebarText).not.toContain("Close Fast");
});
```

- [ ] **Step 2: Run the mock E2E file to verify the new expectations fail first**

Run:

```bash
cd apps/desktop
pnpm exec vitest run --config ./tests/e2e/vitest.config.ts tests/e2e/mock/task-lifecycle.test.ts
```

Expected: FAIL if you run this immediately after editing the test file and before the `kanna.ts` refactor is complete, with the direct-close case still observing `teardown` or stale sidebar selection behavior.

- [ ] **Step 3: Keep the test file aligned with the refactored close flow**

After the `kanna.ts` refactor is merged locally, ensure the final `task-lifecycle.test.ts` includes:

- the original create/header/worktree assertions
- one close assertion for visible `teardown`
- one close assertion for direct hidden `done`

Do not collapse both behaviors back into a single generic “close removes task” assertion.

- [ ] **Step 4: Run full verification for the touched surface**

Run:

```bash
pnpm exec vitest run apps/desktop/src/stores/taskCloseBehavior.test.ts apps/desktop/src/stores/taskCloseSelection.test.ts apps/desktop/src/stores/kannaCleanup.test.ts apps/desktop/src/stores/kannaConfig.test.ts
cd apps/desktop && pnpm test:e2e
```

Expected:

- focused store/helper Vitest suite PASS
- mock E2E suite PASS, including `tests/e2e/mock/task-lifecycle.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/tests/e2e/mock/task-lifecycle.test.ts apps/desktop/src/stores/kanna.ts apps/desktop/src/stores/taskCloseBehavior.ts apps/desktop/src/stores/taskCloseBehavior.test.ts apps/desktop/src/stores/taskCloseSelection.ts apps/desktop/src/stores/taskCloseSelection.test.ts apps/desktop/src/stores/kannaCleanup.ts apps/desktop/src/stores/kannaCleanup.test.ts
git commit -m "test: cover task close teardown visibility"
```

## Self-Review Checklist

- Spec coverage:
  - visible `teardown` only when teardown commands exist: covered by Tasks 1, 3, and 4
  - direct close to hidden `done` when teardown commands do not exist: covered by Tasks 1, 2, 3, and 4
  - selection should not stay stuck on a now-hidden task: covered by Tasks 2 and 3
  - teardown exit auto-close behavior remains unchanged: covered by Task 2
- Placeholder scan:
  - no `TODO`, `TBD`, or “handle appropriately” placeholders remain
- Type consistency:
  - `hasTeardownCommands`, `nextStage`, and `TEARDOWN_STAGE` are named consistently across helper and store tasks
