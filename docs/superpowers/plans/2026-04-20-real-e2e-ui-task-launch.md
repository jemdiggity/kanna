# Real E2E UI Task Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the default real PTY desktop E2E specs launch tasks through the visible `Shift+Cmd+N` modal flow instead of calling the Vue submission method directly.

**Architecture:** Add a focused E2E helper that opens the new-task modal with the real keyboard shortcut, fills the modal textarea, and submits with `Cmd+Enter`. Cover that helper with a fake-client unit test, then switch both real PTY specs to use it while leaving their post-submit polling and assertions unchanged.

**Tech Stack:** TypeScript, Vitest, WebDriver E2E helpers, browser `KeyboardEvent`

---

### Task 1: Add a failing test for the UI-driven new-task helper

**Files:**
- Create: `apps/desktop/tests/e2e/helpers/newTaskFlow.test.ts`
- Test: `apps/desktop/tests/e2e/helpers/newTaskFlow.test.ts`

- [ ] **Step 1: Write the failing helper test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeClient {
  executeCalls: string[];
  waitCalls: Array<{ css: string; timeoutMs: number }>;
  sendKeyCalls: Array<{ elementId: string; text: string }>;
  executeSync<T = unknown>(script: string, args?: unknown[]): Promise<T>;
  waitForElement(css: string, timeoutMs?: number): Promise<string>;
  waitForNoElement(css: string, timeoutMs?: number): Promise<void>;
  sendKeys(elementId: string, text: string): Promise<void>;
}

function createFakeClient(): FakeClient {
  return {
    executeCalls: [],
    waitCalls: [],
    sendKeyCalls: [],
    async executeSync<T = unknown>(script: string): Promise<T> {
      this.executeCalls.push(script);
      return undefined as T;
    },
    async waitForElement(css: string, timeoutMs = 10000): Promise<string> {
      this.waitCalls.push({ css, timeoutMs });
      if (css === ".modal-overlay") return "modal";
      if (css === ".modal-overlay textarea") return "textarea";
      throw new Error(`unexpected selector ${css}`);
    },
    async waitForNoElement(css: string, timeoutMs = 5000): Promise<void> {
      this.waitCalls.push({ css, timeoutMs });
    },
    async sendKeys(elementId: string, text: string): Promise<void> {
      this.sendKeyCalls.push({ elementId, text });
    },
  };
}

describe("submitTaskFromUi", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("opens the modal with Shift+Cmd+N, fills the prompt, and submits with Cmd+Enter", async () => {
    const client = createFakeClient();
    const { submitTaskFromUi } = await import("./newTaskFlow");

    await submitTaskFromUi(client, "Write a real e2e task");

    expect(client.executeCalls[0]).toContain('key: "N"');
    expect(client.executeCalls[0]).toContain("metaKey: true");
    expect(client.executeCalls[0]).toContain("shiftKey: true");
    expect(client.waitCalls).toContainEqual({ css: ".modal-overlay", timeoutMs: 2000 });
    expect(client.waitCalls).toContainEqual({ css: ".modal-overlay textarea", timeoutMs: 2000 });
    expect(client.sendKeyCalls).toEqual([{ elementId: "textarea", text: "Write a real e2e task" }]);
    expect(client.executeCalls[1]).toContain('key: "Enter"');
    expect(client.executeCalls[1]).toContain("metaKey: true");
    expect(client.waitCalls).toContainEqual({ css: ".modal-overlay", timeoutMs: 5000 });
  });
});
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run: `pnpm --dir apps/desktop exec vitest run tests/e2e/helpers/newTaskFlow.test.ts`
Expected: FAIL because `newTaskFlow.ts` does not exist yet.

- [ ] **Step 3: Commit the red test**

```bash
git add apps/desktop/tests/e2e/helpers/newTaskFlow.test.ts
git commit -m "test: cover real e2e ui task launch helper"
```

### Task 2: Implement the helper and switch the real PTY specs to it

**Files:**
- Create: `apps/desktop/tests/e2e/helpers/newTaskFlow.ts`
- Modify: `apps/desktop/tests/e2e/real/pty-session.test.ts`
- Modify: `apps/desktop/tests/e2e/real/diff-after-agent-run.test.ts`
- Test: `apps/desktop/tests/e2e/helpers/newTaskFlow.test.ts`

- [ ] **Step 1: Implement the helper**

`apps/desktop/tests/e2e/helpers/newTaskFlow.ts`

```ts
export interface NewTaskFlowClient {
  executeSync<T = unknown>(script: string, args?: unknown[]): Promise<T>;
  waitForElement(css: string, timeoutMs?: number): Promise<string>;
  waitForNoElement(css: string, timeoutMs?: number): Promise<void>;
  sendKeys(elementId: string, text: string): Promise<void>;
}

const NEW_TASK_MODAL_SELECTOR = ".modal-overlay";
const NEW_TASK_TEXTAREA_SELECTOR = ".modal-overlay textarea";

export async function submitTaskFromUi(
  client: NewTaskFlowClient,
  prompt: string,
): Promise<void> {
  await client.executeSync(
    `document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "N",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
    }));`,
  );

  await client.waitForElement(NEW_TASK_MODAL_SELECTOR, 2000);
  const textarea = await client.waitForElement(NEW_TASK_TEXTAREA_SELECTOR, 2000);
  await client.sendKeys(textarea, prompt);

  await client.executeSync(
    `const textarea = document.querySelector(${JSON.stringify(NEW_TASK_TEXTAREA_SELECTOR)});
     textarea?.dispatchEvent(new KeyboardEvent("keydown", {
       key: "Enter",
       metaKey: true,
       bubbles: true,
     }));`,
  );

  await client.waitForNoElement(NEW_TASK_MODAL_SELECTOR, 5000);
}
```

- [ ] **Step 2: Run the helper test to verify it passes**

Run: `pnpm --dir apps/desktop exec vitest run tests/e2e/helpers/newTaskFlow.test.ts`
Expected: PASS

- [ ] **Step 3: Update both real PTY specs to use the helper**

`apps/desktop/tests/e2e/real/pty-session.test.ts`

```ts
import { submitTaskFromUi } from "../helpers/newTaskFlow";
```

Replace:

```ts
await callVueMethod(
  client,
  "handleNewTaskSubmit",
  prompt,
);
```

With:

```ts
await submitTaskFromUi(client, prompt);
```

and remove the unused `callVueMethod` import.

`apps/desktop/tests/e2e/real/diff-after-agent-run.test.ts`

```ts
import { submitTaskFromUi } from "../helpers/newTaskFlow";
```

Replace:

```ts
await callVueMethod(
  client,
  "handleNewTaskSubmit",
  prompt,
);
```

With:

```ts
await submitTaskFromUi(client, prompt);
```

and remove the unused `callVueMethod` import.

- [ ] **Step 4: Re-run the helper test after the spec updates**

Run: `pnpm --dir apps/desktop exec vitest run tests/e2e/helpers/newTaskFlow.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the helper and real-spec launch-path updates**

```bash
git add apps/desktop/tests/e2e/helpers/newTaskFlow.ts apps/desktop/tests/e2e/helpers/newTaskFlow.test.ts apps/desktop/tests/e2e/real/pty-session.test.ts apps/desktop/tests/e2e/real/diff-after-agent-run.test.ts
git commit -m "test: launch real e2e tasks through the ui"
```

### Task 3: Verify the real suite on the UI-driven task launch path

**Files:**
- Modify: none
- Test: `apps/desktop/tests/e2e/helpers/newTaskFlow.test.ts`
- Test: `apps/desktop/tests/e2e/real/pty-session.test.ts`
- Test: `apps/desktop/tests/e2e/real/diff-after-agent-run.test.ts`

- [ ] **Step 1: Run the helper/unit checks together**

Run: `pnpm --dir apps/desktop exec vitest run tests/e2e/helpers/newTaskFlow.test.ts tests/e2e/helpers/agentTrustPrompt.test.ts`
Expected: PASS

- [ ] **Step 2: Run TypeScript verification**

Run: `pnpm exec tsc --noEmit -p apps/desktop/tsconfig.json`
Expected: PASS

- [ ] **Step 3: Run the real PTY-session spec**

Run: `pnpm --dir apps/desktop exec tsx tests/e2e/run.ts real/pty-session.test.ts`
Expected: PASS, proving the visible shortcut-driven launch path works for the basic PTY flow.

- [ ] **Step 4: Run the real diff spec**

Run: `pnpm --dir apps/desktop exec tsx tests/e2e/run.ts real/diff-after-agent-run.test.ts`
Expected: The test launches through the visible modal path. If it still fails, the remaining failure is in the real agent/runtime behavior after submission, not in direct Vue method submission.

- [ ] **Step 5: Commit the verified change set**

```bash
git add apps/desktop/tests/e2e/helpers/newTaskFlow.ts apps/desktop/tests/e2e/helpers/newTaskFlow.test.ts apps/desktop/tests/e2e/helpers/agentTrustPrompt.ts apps/desktop/tests/e2e/real/pty-session.test.ts apps/desktop/tests/e2e/real/diff-after-agent-run.test.ts docs/superpowers/plans/2026-04-20-real-e2e-ui-task-launch.md
git commit -m "test: use ui task launch in real e2e specs"
```
