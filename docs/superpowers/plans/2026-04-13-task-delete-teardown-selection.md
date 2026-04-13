# Task Delete Teardown Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move selection to the same next task immediately when a task enters `torndown`, instead of waiting for teardown completion or final close.

**Architecture:** Extract the close-selection timing rule into a focused store helper so the contract can be unit tested without dragging PTY teardown into a giant store test. Then update `closeTask()` to invoke that rule exactly when the task is marked `torndown`, while preserving the existing `selectNext: false`, blocked-task, and already-`torndown` paths.

**Tech Stack:** Vue 3, Pinia store, Vitest, TypeScript

---

### Task 1: Add a focused close-selection timing contract test

**Files:**
- Create: `apps/desktop/src/stores/taskCloseSelection.ts`
- Test: `apps/desktop/src/stores/taskCloseSelection.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { shouldSelectNextOnCloseTransition } from "./taskCloseSelection";

describe("shouldSelectNextOnCloseTransition", () => {
  it("selects immediately when a normal task enters torndown", () => {
    expect(
      shouldSelectNextOnCloseTransition({
        selectNext: true,
        wasBlocked: false,
        previousStage: "in progress",
        nextStage: "torndown",
      }),
    ).toBe(true);
  });

  it("does not select when selection handoff is disabled", () => {
    expect(
      shouldSelectNextOnCloseTransition({
        selectNext: false,
        wasBlocked: false,
        previousStage: "in progress",
        nextStage: "torndown",
      }),
    ).toBe(false);
  });

  it("does not treat blocked-task close as torndown entry", () => {
    expect(
      shouldSelectNextOnCloseTransition({
        selectNext: true,
        wasBlocked: true,
        previousStage: "in progress",
        nextStage: "done",
      }),
    ).toBe(false);
  });

  it("does not reselect on final close after torndown", () => {
    expect(
      shouldSelectNextOnCloseTransition({
        selectNext: true,
        wasBlocked: false,
        previousStage: "torndown",
        nextStage: "done",
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/src/stores/taskCloseSelection.test.ts`
Expected: FAIL because `taskCloseSelection.ts` and/or `shouldSelectNextOnCloseTransition` do not exist yet

- [ ] **Step 3: Write minimal implementation**

```ts
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
    transition.previousStage !== "torndown" &&
    transition.nextStage === "torndown"
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/desktop/src/stores/taskCloseSelection.test.ts`
Expected: PASS

### Task 2: Apply the helper inside `closeTask()`

**Files:**
- Modify: `apps/desktop/src/stores/kanna.ts`
- Test: `apps/desktop/src/stores/taskCloseSelection.test.ts`

- [ ] **Step 1: Update the store to use the helper when entering torndown**

```ts
await updatePipelineItemStage(_db, item.id, "torndown");

if (shouldSelectNextOnCloseTransition({
  selectNext: opts?.selectNext !== false,
  wasBlocked,
  previousStage: item.stage,
  nextStage: "torndown",
})) {
  selectNextItem(nextId);
}

bump();
```

Also add the import:

```ts
import { shouldSelectNextOnCloseTransition } from "./taskCloseSelection";
```

Do not add a second immediate-selection call to the blocked-task or already-`torndown` paths.

- [ ] **Step 2: Run the focused tests**

Run: `pnpm exec vitest run apps/desktop/src/stores/taskCloseSelection.test.ts`
Expected: PASS

### Task 3: Verify the touched TypeScript surfaces

**Files:**
- Modify: `apps/desktop/src/stores/kanna.ts`
- Create: `apps/desktop/src/stores/taskCloseSelection.ts`
- Test: `apps/desktop/src/stores/taskCloseSelection.test.ts`

- [ ] **Step 1: Run TypeScript check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 2: Run a narrow store-adjacent test sweep if available**

Run: `pnpm exec vitest run apps/desktop/src/stores/taskCloseSelection.test.ts apps/desktop/src/stores/kannaCleanup.test.ts apps/desktop/src/stores/agent-provider.test.ts`
Expected: PASS
