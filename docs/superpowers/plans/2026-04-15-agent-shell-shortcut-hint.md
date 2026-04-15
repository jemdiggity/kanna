# Agent Shell Shortcut Hint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dismissible hint below the selected task's agent shell that tells users they can press `⌘/` to see available commands.

**Architecture:** Keep the hint in `MainPanel.vue`, which already owns the selected-task shell layout and blocked-state branching. Persist dismissal in `localStorage` so the hint can be closed once without adding new database or store state, and cover both rendering and dismissal behavior with a focused component test.

**Tech Stack:** Vue 3, TypeScript, Vitest, Vue Test Utils, happy-dom

---

## File Structure

- `apps/desktop/src/components/MainPanel.vue`
  Responsibility: render the selected task shell area and own the dismissible shortcut hint below `TerminalTabs`.
- `apps/desktop/src/components/__tests__/MainPanel.test.ts`
  Responsibility: verify the hint renders for an active task, disappears when dismissed, and stays hidden after remount due to persisted dismissal state.
- `apps/desktop/src/i18n/locales/en.json`
  Responsibility: provide user-facing copy for the shortcut hint and dismiss button.
- `apps/desktop/src/i18n/locales/ja.json`
  Responsibility: provide localized Japanese copy for the shortcut hint and dismiss button.

### Task 1: Add Coverage For The Shortcut Hint

**Files:**
- Create: `apps/desktop/src/components/__tests__/MainPanel.test.ts`

- [ ] **Step 1: Write the failing component test**

Create `apps/desktop/src/components/__tests__/MainPanel.test.ts` with:

```ts
// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import type { PipelineItem } from "@kanna/db";
import MainPanel from "../MainPanel.vue";

const item: PipelineItem = {
  id: "task-1",
  repo_id: "repo-1",
  prompt: "Test task",
  tags: "[]",
  branch: "task-1",
  activity: "idle",
  pinned: 0,
  pin_order: 0,
  display_name: "Test task",
  agent_type: "pty",
  agent_provider: "claude",
  base_ref: null,
  issue_number: null,
  issue_title: null,
  pr_number: null,
  pr_url: null,
  port_env: null,
  port_offset: null,
  closed_at: null,
  created_at: "2026-04-15T00:00:00Z",
  updated_at: "2026-04-15T00:00:00Z",
  stage: "in progress",
};

describe("MainPanel", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows a dismissible command hint below the terminal and keeps it hidden after dismissal", async () => {
    const wrapper = mount(MainPanel, {
      props: {
        item,
        repoPath: "/tmp/repo",
        hasRepos: true,
      },
      global: {
        mocks: {
          $t: (key: string, params?: Record<string, string>) =>
            key === "mainPanel.commandHint"
              ? `Use ${params?.shortcut} to see available commands.`
              : key === "actions.dismiss"
                ? "Dismiss"
                : key,
        },
        stubs: {
          TaskHeader: { template: '<div data-testid="task-header" />' },
          TerminalTabs: { template: '<div data-testid="terminal-tabs" />' },
        },
      },
    });

    expect(wrapper.get('[data-testid="terminal-tabs"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="command-hint"]').text()).toContain("Use ⌘/ to see available commands.");

    await wrapper.get('[data-testid="command-hint-dismiss"]').trigger("click");

    expect(wrapper.find('[data-testid="command-hint"]').exists()).toBe(false);
    expect(localStorage.getItem("kanna:hide-command-hint")).toBe("1");

    wrapper.unmount();

    const remounted = mount(MainPanel, {
      props: {
        item,
        repoPath: "/tmp/repo",
        hasRepos: true,
      },
      global: {
        mocks: {
          $t: (key: string, params?: Record<string, string>) =>
            key === "mainPanel.commandHint"
              ? `Use ${params?.shortcut} to see available commands.`
              : key === "actions.dismiss"
                ? "Dismiss"
                : key,
        },
        stubs: {
          TaskHeader: { template: '<div data-testid="task-header" />' },
          TerminalTabs: { template: '<div data-testid="terminal-tabs" />' },
        },
      },
    });

    expect(remounted.find('[data-testid="command-hint"]').exists()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the component test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/src/components/__tests__/MainPanel.test.ts`

Expected: FAIL because `MainPanel.vue` does not yet render `data-testid="command-hint"` or persist dismissal.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/__tests__/MainPanel.test.ts
git commit -m "test: cover agent shell shortcut hint"
```

### Task 2: Implement The Dismissible Hint

**Files:**
- Modify: `apps/desktop/src/components/MainPanel.vue`
- Modify: `apps/desktop/src/i18n/locales/en.json`
- Modify: `apps/desktop/src/i18n/locales/ja.json`
- Test: `apps/desktop/src/components/__tests__/MainPanel.test.ts`

- [ ] **Step 1: Add the minimal MainPanel implementation**

Update `apps/desktop/src/components/MainPanel.vue` to:

```ts
const COMMAND_HINT_STORAGE_KEY = "kanna:hide-command-hint";
const showCommandHint = ref(false);

function readCommandHintVisibility(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(COMMAND_HINT_STORAGE_KEY) !== "1";
}

function dismissCommandHint() {
  showCommandHint.value = false;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(COMMAND_HINT_STORAGE_KEY, "1");
  }
}

watch(
  () => props.item?.id ?? null,
  () => {
    showCommandHint.value = !!props.item && !isBlocked.value && readCommandHintVisibility();
  },
  { immediate: true },
);
```

Render this directly below `<TerminalTabs />`:

```vue
<div
  v-if="showCommandHint"
  data-testid="command-hint"
  class="command-hint"
>
  <span>{{ $t('mainPanel.commandHint', { shortcut: '⌘/' }) }}</span>
  <button
    data-testid="command-hint-dismiss"
    type="button"
    class="command-hint-dismiss"
    :aria-label="$t('actions.dismiss')"
    @click="dismissCommandHint"
  >
    ×
  </button>
</div>
```

Add scoped styles for `.command-hint` and `.command-hint-dismiss` that fit the existing dark UI and keep the hint visually subordinate to the terminal.

- [ ] **Step 2: Add the i18n strings**

Update `apps/desktop/src/i18n/locales/en.json`:

```json
"commandHint": "Use {shortcut} to see available commands."
```

Update `apps/desktop/src/i18n/locales/ja.json`:

```json
"commandHint": "{shortcut} で利用可能なコマンドを表示できます。"
```

- [ ] **Step 3: Run the component test to verify it passes**

Run: `pnpm exec vitest run apps/desktop/src/components/__tests__/MainPanel.test.ts`

Expected: PASS with the new hint test passing.

- [ ] **Step 4: Run broader verification**

Run: `pnpm exec vitest run apps/desktop/src/components/__tests__/MainPanel.test.ts apps/desktop/src/components/__tests__/KeyboardShortcutsModal.test.ts`

Expected: PASS with both test files green.

Run: `pnpm exec tsc --noEmit`

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/MainPanel.vue apps/desktop/src/components/__tests__/MainPanel.test.ts apps/desktop/src/i18n/locales/en.json apps/desktop/src/i18n/locales/ja.json
git commit -m "feat: add agent shell shortcut hint"
```
