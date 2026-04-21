# Real E2E Provider-Neutral Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the default desktop real E2E suite and its assertions so it describes provider-neutral PTY app behavior while continuing to run on `codex`.

**Architecture:** Add a small guard test that enforces provider-neutral naming for files directly under `apps/desktop/tests/e2e/real/`, then rename the current real PTY specs and update their test titles and harness references to match. Keep the existing harness override as the source of the real provider choice, and verify the renamed suite still runs through the same real E2E entrypoints.

**Tech Stack:** TypeScript, Vitest, Node filesystem helpers, WebDriver E2E harness

---

### Task 1: Add a failing guard test for provider-neutral default real-suite filenames

**Files:**
- Create: `apps/desktop/tests/e2e/realSuiteNaming.test.ts`
- Test: `apps/desktop/tests/e2e/realSuiteNaming.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PROVIDER_NAME_PATTERN = /(claude|copilot|codex)/i;

describe("default real E2E suite naming", () => {
  it("does not use provider names in top-level real suite filenames", async () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const realDir = join(currentDir, "real");
    const entries = await readdir(realDir, { withFileTypes: true });

    const providerNamedFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
      .map((entry) => entry.name)
      .filter((name) => PROVIDER_NAME_PATTERN.test(name));

    expect(providerNamedFiles).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the guard test to verify it fails**

Run: `pnpm --dir apps/desktop exec vitest run tests/e2e/realSuiteNaming.test.ts`
Expected: FAIL because `claude-session.test.ts` and `diff-after-claude.test.ts` still exist under `tests/e2e/real/`.

- [ ] **Step 3: Commit the red test**

```bash
git add apps/desktop/tests/e2e/realSuiteNaming.test.ts
git commit -m "test: guard real e2e suite naming"
```

### Task 2: Rename the real PTY specs and make their descriptions provider-neutral

**Files:**
- Move: `apps/desktop/tests/e2e/real/claude-session.test.ts` → `apps/desktop/tests/e2e/real/pty-session.test.ts`
- Move: `apps/desktop/tests/e2e/real/diff-after-claude.test.ts` → `apps/desktop/tests/e2e/real/diff-after-agent-run.test.ts`
- Modify: `apps/desktop/tests/e2e/runEnv.test.ts`
- Test: `apps/desktop/tests/e2e/realSuiteNaming.test.ts`

- [ ] **Step 1: Rename the spec files with `apply_patch` and update their suite/test titles**

`apps/desktop/tests/e2e/real/pty-session.test.ts`

```ts
describe("pty session (real CLI)", () => {
  // existing setup remains

  it("creates a PTY task and renders terminal output", async () => {
    const prompt = "Respond with exactly: E2E_TEST_OK";
    // existing test body remains
  });

  it("renders the terminal view for PTY mode", async () => {
    // existing assertion remains
  });
});
```

`apps/desktop/tests/e2e/real/diff-after-agent-run.test.ts`

```ts
describe("diff after agent run (real CLI)", () => {
  // existing setup remains

  it("creates a task that writes a file and shows a diff", async () => {
    const prompt = "Create a file called e2e-test-output.txt containing exactly: E2E test content";
    // existing test body remains
  });
});
```

- [ ] **Step 2: Update harness-facing unit tests to use the renamed provider-neutral targets**

`apps/desktop/tests/e2e/runEnv.test.ts`

```ts
it("returns codex and gpt-5.4-mini for real suites by default", () => {
  expect(buildRealE2eAgentEnv(["tests/e2e/real/pty-session.test.ts"], {})).toEqual({
    KANNA_E2E_REAL_AGENT_PROVIDER: "codex",
    KANNA_E2E_REAL_AGENT_MODEL: "gpt-5.4-mini",
  });
});

it("preserves explicit real-suite agent env overrides", () => {
  expect(
    buildRealE2eAgentEnv(["tests/e2e/real/pty-session.test.ts"], {
      KANNA_E2E_REAL_AGENT_PROVIDER: "copilot",
      KANNA_E2E_REAL_AGENT_MODEL: "gpt-5.4-mini",
    }),
  ).toEqual({
    KANNA_E2E_REAL_AGENT_PROVIDER: "copilot",
    KANNA_E2E_REAL_AGENT_MODEL: "gpt-5.4-mini",
  });
});
```

- [ ] **Step 3: Run the naming guard and run-env unit tests to verify they pass**

Run: `pnpm --dir apps/desktop exec vitest run tests/e2e/realSuiteNaming.test.ts tests/e2e/runEnv.test.ts`
Expected: PASS

- [ ] **Step 4: Commit the rename and provider-neutral wording updates**

```bash
git add apps/desktop/tests/e2e/realSuiteNaming.test.ts apps/desktop/tests/e2e/real/pty-session.test.ts apps/desktop/tests/e2e/real/diff-after-agent-run.test.ts apps/desktop/tests/e2e/runEnv.test.ts
git commit -m "test: rename real e2e specs for provider-neutral naming"
```

### Task 3: Verify the renamed real suite still runs through the existing harness

**Files:**
- Modify: none
- Test: `apps/desktop/tests/e2e/helpers/agentTrustPrompt.test.ts`
- Test: `apps/desktop/tests/e2e/real/pty-session.test.ts`
- Test: `apps/desktop/tests/e2e/real/diff-after-agent-run.test.ts`
- Test: `apps/desktop/tests/e2e/real/`

- [ ] **Step 1: Re-run the helper and naming/unit checks together**

Run: `pnpm --dir apps/desktop exec vitest run tests/e2e/helpers/agentTrustPrompt.test.ts tests/e2e/realSuiteNaming.test.ts tests/e2e/runEnv.test.ts`
Expected: PASS

- [ ] **Step 2: Run TypeScript verification**

Run: `pnpm exec tsc --noEmit -p apps/desktop/tsconfig.json`
Expected: PASS

- [ ] **Step 3: Run the renamed focused real specs**

Run: `pnpm --dir apps/desktop exec tsx tests/e2e/run.ts real/pty-session.test.ts`
Expected: PASS or a genuine post-launch behavior failure unrelated to provider naming.

Run: `pnpm --dir apps/desktop exec tsx tests/e2e/run.ts real/diff-after-agent-run.test.ts`
Expected: Reaches the existing real diff assertion by the renamed path. If it still fails, the failure should be the underlying diff bug rather than stale Claude-oriented naming.

- [ ] **Step 4: Run the full renamed real suite**

Run: `pnpm --dir apps/desktop exec tsx tests/e2e/run.ts real/`
Expected: The suite discovers the provider-neutral filenames and runs with the existing `codex` + `gpt-5.4-mini` override.

- [ ] **Step 5: Commit the verified change set**

```bash
git add apps/desktop/tests/e2e/realSuiteNaming.test.ts apps/desktop/tests/e2e/runEnv.test.ts apps/desktop/tests/e2e/real/pty-session.test.ts apps/desktop/tests/e2e/real/diff-after-agent-run.test.ts
git commit -m "test: make real e2e suite provider-neutral"
```
