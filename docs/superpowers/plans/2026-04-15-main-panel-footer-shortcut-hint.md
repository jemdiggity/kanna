# Main Panel Footer Shortcut Hint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the command helper permanently dismissible but always available at the bottom of the main panel, including the initial no-repo and no-task states.

**Architecture:** Keep the helper in `MainPanel.vue`, but move it out of the task-only shell branch into a footer that always renders at the bottom of the panel. Preserve the existing `localStorage` dismissal key so closing it once hides it permanently, and update the component test to prove the helper is visible without repos or tasks before dismissal.

**Tech Stack:** Vue 3, TypeScript, Vitest, Vue Test Utils, happy-dom

---

## File Structure

- `apps/desktop/src/components/MainPanel.vue`
  Responsibility: render the panel body and the always-available footer helper.
- `apps/desktop/src/components/__tests__/MainPanel.test.ts`
  Responsibility: verify the helper appears with no repos/tasks, dismisses, and stays hidden after remount.

### Task 1: Update Coverage For The Always-Visible Footer

**Files:**
- Modify: `apps/desktop/src/components/__tests__/MainPanel.test.ts`

- [ ] **Step 1: Write the failing test expectation**

Change the test so `MainPanel` mounts with:

```ts
props: {
  item: null,
  hasRepos: false,
}
```

and assert:

```ts
expect(wrapper.get('[data-testid="command-hint"]').exists()).toBe(true);
expect(wrapper.find('[data-testid="terminal-tabs"]').exists()).toBe(false);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- -- src/components/__tests__/MainPanel.test.ts`

Expected: FAIL because the helper is still gated behind an active PTY task.

### Task 2: Move The Helper To The MainPanel Footer

**Files:**
- Modify: `apps/desktop/src/components/MainPanel.vue`
- Test: `apps/desktop/src/components/__tests__/MainPanel.test.ts`

- [ ] **Step 1: Make the helper visibility unconditional except for dismissal**

Replace the current visibility computed with:

```ts
const showCommandHint = computed(() => !commandHintDismissed.value);
```

- [ ] **Step 2: Move the helper markup below the conditional body**

Render the helper once at the bottom of `MainPanel`, after the `item` / empty-state branches, so it appears for all panel states.

- [ ] **Step 3: Run tests**

Run: `pnpm test -- -- src/components/__tests__/MainPanel.test.ts`

Expected: PASS.

Run: `pnpm test -- -- src/components/__tests__/MainPanel.test.ts src/components/__tests__/KeyboardShortcutsModal.test.ts`

Expected: PASS.

Run: `pnpm exec tsc --noEmit`

Expected: PASS.
