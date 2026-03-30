# New Task Agent Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the clickable Agent CLI toggle in the desktop New Task modal with a minimal read-only provider name while preserving keyboard cycling across available CLIs.

**Architecture:** Keep the existing provider-detection and provider-cycling state in `NewTaskModal.vue`, but remove the clickable toggle UI and render the current provider name as static header text. Add a focused component test that verifies the rendered provider text and keyboard cycling behavior so the behavior stays covered without touching backend task creation flow.

**Tech Stack:** Vue 3 SFCs, TypeScript, Vitest, Vue Test Utils

---

## File Structure

- Modify: `apps/desktop/src/components/NewTaskModal.vue`
  - Remove the clickable segmented provider buttons.
  - Render the selected provider as minimal read-only text in the modal header.
  - Keep existing provider detection and keyboard cycling behavior unchanged.
- Create: `apps/desktop/src/components/__tests__/NewTaskModal.test.ts`
  - Add focused component tests for current-provider rendering and keyboard cycling.

### Task 1: Add a failing modal test

**Files:**
- Create: `apps/desktop/src/components/__tests__/NewTaskModal.test.ts`
- Test: `apps/desktop/src/components/__tests__/NewTaskModal.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import NewTaskModal from "../NewTaskModal.vue";

vi.mock("../../invoke", () => ({
  invoke: vi.fn(async (command: string, args?: { name?: string }) => {
    if (command === "which_binary" && (args?.name === "claude" || args?.name === "codex")) return true;
    throw new Error("missing");
  }),
}));

describe("NewTaskModal", () => {
  it("shows only the selected provider name and updates it when cycling", async () => {
    const wrapper = mount(NewTaskModal, {
      props: { defaultAgentProvider: "claude" },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(wrapper.text()).toContain("Claude");
    expect(wrapper.text()).not.toContain("Codex");
    expect(wrapper.findAll("button").map((b) => b.text())).not.toContain("Claude");
    expect(wrapper.findAll("button").map((b) => b.text())).not.toContain("Codex");

    await wrapper.find("textarea").trigger("keydown", {
      key: "]",
      metaKey: true,
      shiftKey: true,
    });

    expect(wrapper.text()).toContain("Codex");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run apps/desktop/src/components/__tests__/NewTaskModal.test.ts`
Expected: FAIL because the modal still renders clickable provider buttons instead of provider-name-only status text.

### Task 2: Implement the minimal modal change

**Files:**
- Modify: `apps/desktop/src/components/NewTaskModal.vue`
- Test: `apps/desktop/src/components/__tests__/NewTaskModal.test.ts`

- [ ] **Step 1: Write minimal implementation**

```vue
<div class="modal-header">
  <h3>{{ $t('tasks.newTask') }}</h3>
  <div class="agent-provider">{{ agentProvider === 'claude' ? 'Claude' : agentProvider === 'copilot' ? 'Copilot' : 'Codex' }}</div>
</div>
```

```css
.agent-provider {
  font-size: 11px;
  font-weight: 600;
  color: #b8b8b8;
}
```

Remove the old `.agent-toggle`, `.toggle-btn`, `.toggle-btn:hover`, and `.toggle-btn.active` rules and the corresponding button markup. Leave `cycleProvider()` and mounted CLI detection logic intact.

- [ ] **Step 2: Run test to verify it passes**

Run: `bunx vitest run apps/desktop/src/components/__tests__/NewTaskModal.test.ts`
Expected: PASS

- [ ] **Step 3: Run adjacent verification**

Run: `bunx vitest run apps/desktop/src/components/__tests__/NewTaskModal.test.ts apps/desktop/src/utils/parseRepoInput.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/components/NewTaskModal.vue apps/desktop/src/components/__tests__/NewTaskModal.test.ts
git commit -m "fix: simplify new task agent indicator"
```
