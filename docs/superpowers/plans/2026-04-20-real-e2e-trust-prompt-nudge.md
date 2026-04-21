# Real E2E Trust Prompt Nudge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let real PTY desktop E2E tests advance past startup trust-folder prompts by sending one delayed `Enter` to the selected task session after launch.

**Architecture:** Add a small E2E-only helper in `tests/e2e/helpers/` that waits for the terminal, sleeps briefly, resolves the selected task id from Vue state, and invokes the existing `send_input` Tauri command with a carriage return byte. Call that helper explicitly from the affected real PTY specs after task creation so the behavior stays in the test layer and does not leak into production or unrelated suites.

**Tech Stack:** TypeScript, Vitest, WebDriver E2E helpers, Tauri command invocation

---

### Task 1: Add the delayed Enter helper behind a focused unit test

**Files:**
- Create: `apps/desktop/tests/e2e/helpers/agentTrustPrompt.ts`
- Create: `apps/desktop/tests/e2e/helpers/agentTrustPrompt.test.ts`
- Test: `apps/desktop/tests/e2e/helpers/agentTrustPrompt.test.ts`

- [ ] **Step 1: Write the failing helper test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriInvokeMock = vi.fn(async () => undefined);

vi.mock("./vue", () => ({
  tauriInvoke: tauriInvokeMock,
}));

interface FakeClient {
  waitForElement: ReturnType<typeof vi.fn>;
  executeSync: ReturnType<typeof vi.fn>;
}

function createFakeClient(selectedItemId: string | null): FakeClient {
  return {
    waitForElement: vi.fn(async () => "terminal"),
    executeSync: vi.fn(async () => selectedItemId),
  };
}

describe("nudgeAgentTrustPrompt", () => {
  beforeEach(() => {
    vi.resetModules();
    tauriInvokeMock.mockReset();
    tauriInvokeMock.mockResolvedValue(undefined);
  });

  it("waits for the terminal and sends one carriage return to the selected task session", async () => {
    const client = createFakeClient("task-1234");
    const { nudgeAgentTrustPrompt } = await import("./agentTrustPrompt");

    await nudgeAgentTrustPrompt(client, { delayMs: 0 });

    expect(client.waitForElement).toHaveBeenCalledWith(".terminal-container", 15_000);
    expect(client.executeSync).toHaveBeenCalled();
    expect(tauriInvokeMock).toHaveBeenCalledWith(client, "send_input", {
      sessionId: "task-1234",
      data: [13],
    });
  });

  it("does nothing when there is no selected task", async () => {
    const client = createFakeClient(null);
    const { nudgeAgentTrustPrompt } = await import("./agentTrustPrompt");

    await nudgeAgentTrustPrompt(client, { delayMs: 0 });

    expect(tauriInvokeMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run: `pnpm --dir apps/desktop exec vitest run tests/e2e/helpers/agentTrustPrompt.test.ts`
Expected: FAIL because `agentTrustPrompt.ts` does not exist yet.

- [ ] **Step 3: Implement the minimal helper**

```ts
import { setTimeout as sleep } from "node:timers/promises";
import type { WebDriverClient } from "./webdriver";
import { tauriInvoke } from "./vue";

export interface AgentTrustPromptClient {
  waitForElement(css: string, timeoutMs?: number): Promise<string>;
  executeSync<T = unknown>(script: string, args?: unknown[]): Promise<T>;
}

export interface AgentTrustPromptOptions {
  delayMs?: number;
}

export async function nudgeAgentTrustPrompt(
  client: AgentTrustPromptClient,
  options: AgentTrustPromptOptions = {},
): Promise<void> {
  await client.waitForElement(".terminal-container", 15_000);
  await sleep(options.delayMs ?? 2000);

  const selectedItemId = await client.executeSync<string | null>(
    `const ctx = window.__KANNA_E2E__.setupState;
     const value = ctx.selectedItemId;
     return value && value.__v_isRef ? value.value : value ?? null;`,
  );

  if (!selectedItemId) return;

  await tauriInvoke(client as WebDriverClient, "send_input", {
    sessionId: selectedItemId,
    data: [13],
  });
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `pnpm --dir apps/desktop exec vitest run tests/e2e/helpers/agentTrustPrompt.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the helper**

```bash
git add apps/desktop/tests/e2e/helpers/agentTrustPrompt.ts apps/desktop/tests/e2e/helpers/agentTrustPrompt.test.ts
git commit -m "test: add real e2e trust prompt nudge helper"
```

### Task 2: Use the helper in the affected real PTY specs

**Files:**
- Modify: `apps/desktop/tests/e2e/real/claude-session.test.ts`
- Modify: `apps/desktop/tests/e2e/real/diff-after-claude.test.ts`
- Test: `apps/desktop/tests/e2e/real/claude-session.test.ts`
- Test: `apps/desktop/tests/e2e/real/diff-after-claude.test.ts`

- [ ] **Step 1: Add the helper import and call in the real PTY specs**

Update both tests to import the helper:

```ts
import { nudgeAgentTrustPrompt } from "../helpers/agentTrustPrompt";
```

Call it immediately after task creation and before waiting for the agent result:

```ts
await callVueMethod(
  client,
  "handleNewTaskSubmit",
  prompt,
);

await waitForTaskCreated(client, prompt);
await nudgeAgentTrustPrompt(client);
```

- [ ] **Step 2: Run the focused real Claude-session spec**

Run: `pnpm --dir apps/desktop exec tsx tests/e2e/run.ts real/claude-session.test.ts`
Expected: PASS

- [ ] **Step 3: Run the focused real diff spec**

Run: `pnpm --dir apps/desktop exec tsx tests/e2e/run.ts real/diff-after-claude.test.ts`
Expected: Either PASS or a later diff assertion failure, but no startup stall caused by trust-folder prompts.

- [ ] **Step 4: Commit the real spec updates**

```bash
git add apps/desktop/tests/e2e/real/claude-session.test.ts apps/desktop/tests/e2e/real/diff-after-claude.test.ts
git commit -m "test: nudge real agent trust prompts in e2e specs"
```

### Task 3: Verify the full real desktop E2E suite

**Files:**
- Modify: none
- Test: `apps/desktop/tests/e2e/helpers/agentTrustPrompt.test.ts`
- Test: `apps/desktop/tests/e2e/real/`

- [ ] **Step 1: Run the focused helper/unit and real spec checks together**

Run: `pnpm --dir apps/desktop exec vitest run tests/e2e/helpers/agentTrustPrompt.test.ts`
Expected: PASS

- [ ] **Step 2: Run TypeScript verification**

Run: `pnpm exec tsc --noEmit -p apps/desktop/tsconfig.json`
Expected: PASS

- [ ] **Step 3: Run the full real suite**

Run: `pnpm --dir apps/desktop exec tsx tests/e2e/run.ts real/`
Expected: The suite gets past trust-folder prompts automatically. Any remaining failures should be genuine post-startup behavior issues, not blocked trust prompts.

- [ ] **Step 4: Commit the verified change set**

```bash
git add apps/desktop/tests/e2e/helpers/agentTrustPrompt.ts apps/desktop/tests/e2e/helpers/agentTrustPrompt.test.ts apps/desktop/tests/e2e/real/claude-session.test.ts apps/desktop/tests/e2e/real/diff-after-claude.test.ts
git commit -m "test: auto-confirm real e2e trust prompts"
```
