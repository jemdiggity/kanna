# Diff After Agent Run Without App Internals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `apps/desktop/tests/e2e/real/diff-after-agent-run.test.ts` use only UI interactions plus direct filesystem/git inspection from the harness, with no Tauri/Vue/DB shortcuts in the spec.

**Architecture:** Add one small harness-side helper for discovering a newly created task worktree and polling for external file creation, with focused unit coverage. Then rewrite the real diff spec to use the UI task-launch flow, UI keyboard shortcuts for trust and diff opening, and direct filesystem/git checks to confirm the visible diff matches the on-disk worktree state.

**Tech Stack:** TypeScript, Vitest, Node `fs/promises`, Node `child_process`, WebDriver E2E helpers

---

### Task 1: Add a harness-side helper for worktree discovery and file polling

**Files:**
- Create: `apps/desktop/tests/e2e/helpers/worktreeFs.ts`
- Create: `apps/desktop/tests/e2e/helpers/worktreeFs.test.ts`
- Test: `apps/desktop/tests/e2e/helpers/worktreeFs.test.ts`

- [ ] **Step 1: Write the failing helper test**

```ts
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { findNewTaskWorktree, waitForFile } from "./worktreeFs";

const tempDirs: string[] = [];

describe("worktreeFs", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => import("node:fs/promises").then(({ rm }) => rm(dir, { recursive: true, force: true }))));
    tempDirs.length = 0;
  });

  it("finds the one newly created task worktree compared with a baseline", async () => {
    const root = await mkdtemp(join(tmpdir(), "kanna-worktree-fs-"));
    tempDirs.push(root);
    const worktreesDir = join(root, ".kanna-worktrees");
    await mkdir(join(worktreesDir, "task-existing"), { recursive: true });
    await mkdir(join(worktreesDir, "task-new"), { recursive: true });

    const result = await findNewTaskWorktree(root, new Set(["task-existing"]));

    expect(result).toBe(join(worktreesDir, "task-new"));
  });

  it("waits for a file to appear in the worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "kanna-worktree-fs-"));
    tempDirs.push(root);
    const target = join(root, "e2e-test-output.txt");

    setTimeout(() => {
      void writeFile(target, "E2E test content", "utf8");
    }, 20);

    await expect(waitForFile(target, 1000, 10)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run: `pnpm --dir apps/desktop exec vitest run tests/e2e/helpers/worktreeFs.test.ts`
Expected: FAIL because `worktreeFs.ts` does not exist yet.

- [ ] **Step 3: Implement the minimal helper**

`apps/desktop/tests/e2e/helpers/worktreeFs.ts`

```ts
import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export async function findNewTaskWorktree(
  repoPath: string,
  baseline: Set<string>,
): Promise<string | null> {
  const worktreesDir = join(repoPath, ".kanna-worktrees");
  const entries = await readdir(worktreesDir, { withFileTypes: true }).catch(() => []);
  const match = entries.find((entry) =>
    entry.isDirectory() &&
    entry.name.startsWith("task-") &&
    !baseline.has(entry.name),
  );
  return match ? join(worktreesDir, match.name) : null;
}

export async function waitForNewTaskWorktree(
  repoPath: string,
  baseline: Set<string>,
  timeoutMs = 20_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const worktreePath = await findNewTaskWorktree(repoPath, baseline);
    if (worktreePath) return worktreePath;
    await sleep(200);
  }
  throw new Error(`timed out waiting for new task worktree under ${repoPath}`);
}

export async function waitForFile(
  path: string,
  timeoutMs = 120_000,
  pollMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await sleep(pollMs);
    }
  }
  throw new Error(`timed out waiting for file ${path}`);
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `pnpm --dir apps/desktop exec vitest run tests/e2e/helpers/worktreeFs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the helper**

```bash
git add apps/desktop/tests/e2e/helpers/worktreeFs.ts apps/desktop/tests/e2e/helpers/worktreeFs.test.ts
git commit -m "test: add harness worktree discovery helper"
```

### Task 2: Rewrite the real diff spec to remove app internals

**Files:**
- Modify: `apps/desktop/tests/e2e/real/diff-after-agent-run.test.ts`
- Test: `apps/desktop/tests/e2e/real/diff-after-agent-run.test.ts`

- [ ] **Step 1: Replace app-internal task discovery and diff inspection with harness-side checks**

Update the spec so it:

- snapshots the existing `.kanna-worktrees/task-*` directory names before task creation
- launches the task through `submitTaskFromUi`
- discovers the new task worktree via `waitForNewTaskWorktree(...)`
- waits for `e2e-test-output.txt` with `waitForFile(...)`
- reads the file directly from disk
- runs `git diff -- e2e-test-output.txt` in that worktree from the test runner

Representative code:

```ts
import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { waitForFile, waitForNewTaskWorktree } from "../helpers/worktreeFs";

const execFileAsync = promisify(execFile);

function pressShortcut(client: WebDriverClient, key: string, options: { meta?: boolean; shift?: boolean } = {}) {
  return client.executeSync(
    `document.dispatchEvent(new KeyboardEvent("keydown", {
      key: ${JSON.stringify(key)},
      metaKey: ${options.meta ?? false},
      shiftKey: ${options.shift ?? false},
      bubbles: true,
    }));`,
  );
}
```

- [ ] **Step 2: Remove forbidden app-internal calls from the spec**

Delete all use of:

- `queryDb`
- `tauriInvoke`
- direct `window.__KANNA_E2E__.setupState.showDiffModal = true`
- task-row debug logging through app state

For trust handling, replace `nudgeAgentTrustPrompt(client)` with a UI-like key helper that dispatches `Enter` to the document a few times on a bounded interval:

```ts
async function nudgeTrustPromptViaUi(client: WebDriverClient): Promise<void> {
  await client.waitForElement(".terminal-container", 15_000);
  await sleep(5_000);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await pressShortcut(client, "Enter");
    if (attempt < 3) await sleep(5_000);
  }
}
```

- [ ] **Step 3: Open the diff through the real shortcut and assert visible UI content**

Use the real shortcut instead of internal state:

```ts
await pressShortcut(client, "d", { meta: true });
await client.waitForElement(".diff-view", 5_000);
await client.waitForText(".diff-view", "e2e-test-output.txt", 10_000);
await client.waitForText(".diff-view", "E2E test content", 10_000);
```

Keep external truth checks immediately before that:

```ts
const filePath = join(worktreePath, "e2e-test-output.txt");
await waitForFile(filePath, 120_000, 500);
expect(await readFile(filePath, "utf8")).toBe("E2E test content");

const { stdout } = await execFileAsync("git", ["diff", "--", "e2e-test-output.txt"], {
  cwd: worktreePath,
});
expect(stdout).toContain("e2e-test-output.txt");
expect(stdout).toContain("E2E test content");
```

- [ ] **Step 4: Run the real diff spec to verify it no longer uses app internals**

Run: `pnpm --dir apps/desktop exec tsx tests/e2e/run.ts real/diff-after-agent-run.test.ts`
Expected: The spec now launches the task via UI, waits on real filesystem state, opens the diff through `Cmd+D`, and either passes or fails on visible/UI-observable behavior rather than app-internal shortcuts.

- [ ] **Step 5: Commit the rewritten spec**

```bash
git add apps/desktop/tests/e2e/real/diff-after-agent-run.test.ts
git commit -m "test: remove internals from real diff e2e"
```

### Task 3: Verify the surrounding helpers and real path still work

**Files:**
- Modify: none
- Test: `apps/desktop/tests/e2e/helpers/newTaskFlow.test.ts`
- Test: `apps/desktop/tests/e2e/helpers/worktreeFs.test.ts`
- Test: `apps/desktop/tests/e2e/real/diff-after-agent-run.test.ts`

- [ ] **Step 1: Run helper tests together**

Run: `pnpm --dir apps/desktop exec vitest run tests/e2e/helpers/newTaskFlow.test.ts tests/e2e/helpers/worktreeFs.test.ts`
Expected: PASS

- [ ] **Step 2: Run TypeScript verification**

Run: `pnpm exec tsc --noEmit -p apps/desktop/tsconfig.json`
Expected: PASS

- [ ] **Step 3: Re-run the real diff spec**

Run: `pnpm --dir apps/desktop exec tsx tests/e2e/run.ts real/diff-after-agent-run.test.ts`
Expected: PASS, or a failure that is now clearly tied to visible UI or on-disk repo state rather than app-internal observability paths.

- [ ] **Step 4: Commit the verified change set**

```bash
git add apps/desktop/tests/e2e/helpers/worktreeFs.ts apps/desktop/tests/e2e/helpers/worktreeFs.test.ts apps/desktop/tests/e2e/helpers/newTaskFlow.ts apps/desktop/tests/e2e/helpers/newTaskFlow.test.ts apps/desktop/tests/e2e/real/diff-after-agent-run.test.ts docs/superpowers/plans/2026-04-21-diff-after-agent-run-no-internals.md
git commit -m "test: make real diff e2e external-observable"
```
