# Task Switch Performance Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured PTY task-switch performance markers and one mocked E2E test that validates marker coverage and prints measured timings.

**Architecture:** Add a browser-side task-switch recorder built on `performance.mark` / `performance.measure`, wire it into the task selection and terminal lifecycle boundaries, expose a narrow read/reset facade through `window.__KANNA_E2E__`, and teach the browser-mode Tauri mock to emit deterministic PTY output for mocked E2E coverage. The first slice records switch start, terminal mounted, terminal ready, and first output for PTY tasks only.

**Tech Stack:** Vue 3, Pinia store APIs, xterm.js terminal lifecycle, Vitest component/store tests, mocked WebDriver E2E harness, browser Performance API

---

### Task 1: Add the task-switch performance recorder module

**Files:**
- Create: `apps/desktop/src/perf/taskSwitchPerf.ts`
- Create: `apps/desktop/src/perf/taskSwitchPerf.test.ts`

- [ ] **Step 1: Write the failing recorder tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginTaskSwitch,
  clearTaskSwitchPerfRecords,
  getLatestTaskSwitchPerfRecord,
  getTaskSwitchPerfRecords,
  markTaskSwitchFirstOutput,
  markTaskSwitchMounted,
  markTaskSwitchReady,
} from "./taskSwitchPerf";

describe("taskSwitchPerf", () => {
  beforeEach(() => {
    clearTaskSwitchPerfRecords();
    performance.clearMarks();
    performance.clearMeasures();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T00:00:00.000Z"));
  });

  it("records start, mounted, ready, and first-output once for a PTY task switch", () => {
    beginTaskSwitch("task-1");
    markTaskSwitchMounted("task-1");
    markTaskSwitchReady("task-1", "warm");
    markTaskSwitchFirstOutput("task-1");

    const record = getLatestTaskSwitchPerfRecord();
    expect(record?.taskId).toBe("task-1");
    expect(record?.terminalKind).toBe("pty");
    expect(record?.path).toBe("warm");
    expect(record?.completed).toBe(true);
    expect(record?.marks.start).toBeTypeOf("number");
    expect(record?.marks["terminal-mounted"]).toBeTypeOf("number");
    expect(record?.marks["terminal-ready"]).toBeTypeOf("number");
    expect(record?.marks["first-output"]).toBeTypeOf("number");
  });

  it("ignores duplicate mounted, ready, and first-output calls", () => {
    beginTaskSwitch("task-1");
    markTaskSwitchMounted("task-1");
    markTaskSwitchMounted("task-1");
    markTaskSwitchReady("task-1", "cold");
    markTaskSwitchReady("task-1", "warm");
    markTaskSwitchFirstOutput("task-1");
    markTaskSwitchFirstOutput("task-1");

    const record = getLatestTaskSwitchPerfRecord();
    expect(record?.path).toBe("cold");
    expect(Object.keys(record?.marks ?? {})).toEqual([
      "start",
      "terminal-mounted",
      "terminal-ready",
      "first-output",
    ]);
  });

  it("keeps only the most recent bounded history", () => {
    for (let index = 0; index < 15; index += 1) {
      beginTaskSwitch(`task-${index}`);
      markTaskSwitchMounted(`task-${index}`);
      markTaskSwitchReady(`task-${index}`, "unknown");
    }

    const records = getTaskSwitchPerfRecords();
    expect(records.length).toBeLessThanOrEqual(10);
    expect(records.at(-1)?.taskId).toBe("task-14");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/desktop exec vitest run src/perf/taskSwitchPerf.test.ts`

Expected: FAIL with `Cannot find module './taskSwitchPerf'` or missing export errors.

- [ ] **Step 3: Write the minimal recorder implementation**

```ts
export interface TaskSwitchPerfRecord {
  switchId: number;
  taskId: string;
  terminalKind: "pty";
  path: "warm" | "cold" | "unknown";
  startedAt: number;
  marks: Partial<Record<"start" | "terminal-mounted" | "terminal-ready" | "first-output", number>>;
  measures: Partial<Record<"total" | "mount" | "ready" | "first-output", number>>;
  completed: boolean;
}

const MAX_RECORDS = 10;
let nextSwitchId = 1;
const records: TaskSwitchPerfRecord[] = [];

function appendRecord(record: TaskSwitchPerfRecord) {
  records.push(record);
  while (records.length > MAX_RECORDS) records.shift();
}

function latestRecordForTask(taskId: string): TaskSwitchPerfRecord | null {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record?.taskId === taskId) return record;
  }
  return null;
}

function markName(record: TaskSwitchPerfRecord, phase: "start" | "terminal-mounted" | "terminal-ready" | "first-output") {
  return `task-switch:${record.switchId}:${phase}`;
}

function writePhase(record: TaskSwitchPerfRecord, phase: "start" | "terminal-mounted" | "terminal-ready" | "first-output") {
  if (record.marks[phase] != null) return false;
  const at = performance.now();
  record.marks[phase] = at;
  performance.mark(markName(record, phase));
  return true;
}

function measure(record: TaskSwitchPerfRecord, name: "total" | "mount" | "ready" | "first-output", start: "start" | "terminal-mounted", end: "terminal-mounted" | "terminal-ready" | "first-output") {
  if (record.marks[start] == null || record.marks[end] == null || record.measures[name] != null) return;
  performance.measure(`task-switch:${record.switchId}:${name}`, markName(record, start), markName(record, end));
  record.measures[name] = (record.marks[end] ?? 0) - (record.marks[start] ?? 0);
}

export function beginTaskSwitch(taskId: string): number {
  const record: TaskSwitchPerfRecord = {
    switchId: nextSwitchId++,
    taskId,
    terminalKind: "pty",
    path: "unknown",
    startedAt: Date.now(),
    marks: {},
    measures: {},
    completed: false,
  };
  appendRecord(record);
  writePhase(record, "start");
  return record.switchId;
}

export function markTaskSwitchMounted(taskId: string): void {
  const record = latestRecordForTask(taskId);
  if (!record || record.completed) return;
  if (!writePhase(record, "terminal-mounted")) return;
  measure(record, "mount", "start", "terminal-mounted");
}

export function markTaskSwitchReady(taskId: string, path: "warm" | "cold" | "unknown"): void {
  const record = latestRecordForTask(taskId);
  if (!record || record.completed) return;
  record.path = record.path === "unknown" ? path : record.path;
  if (!writePhase(record, "terminal-ready")) return;
  measure(record, "total", "start", "terminal-ready");
  measure(record, "ready", "terminal-mounted", "terminal-ready");
  record.completed = true;
}

export function markTaskSwitchFirstOutput(taskId: string): void {
  const record = latestRecordForTask(taskId);
  if (!record) return;
  if (!writePhase(record, "first-output")) return;
  measure(record, "first-output", "start", "first-output");
}

export function getLatestTaskSwitchPerfRecord(): TaskSwitchPerfRecord | null {
  return records.at(-1) ?? null;
}

export function getTaskSwitchPerfRecords(): TaskSwitchPerfRecord[] {
  return [...records];
}

export function clearTaskSwitchPerfRecords(): void {
  records.length = 0;
  nextSwitchId = 1;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/desktop exec vitest run src/perf/taskSwitchPerf.test.ts`

Expected: PASS with 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/perf/taskSwitchPerf.ts apps/desktop/src/perf/taskSwitchPerf.test.ts
git commit -m "feat: add task switch perf recorder"
```

### Task 2: Wire task-switch start into selection and expose recorder state to E2E

**Files:**
- Modify: `apps/desktop/src/stores/selection.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/env.d.ts`
- Test: `apps/desktop/src/stores/kanna.querySnapshot.test.ts`

- [ ] **Step 1: Write the failing selection/E2E exposure tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const beginTaskSwitchMock = vi.fn();

vi.mock("../perf/taskSwitchPerf", () => ({
  beginTaskSwitch: (...args: unknown[]) => beginTaskSwitchMock(...args),
}));

describe("selection task switch perf", () => {
  beforeEach(() => {
    beginTaskSwitchMock.mockReset();
  });

  it("begins a task-switch record when selecting a visible task", async () => {
    const store = await createStore();
    await store.selectRepo("repo-1");
    await store.selectItem("item-1");
    expect(beginTaskSwitchMock).toHaveBeenCalledWith("item-1");
  });
});
```

```ts
expect(window.__KANNA_E2E__).toEqual(
  expect.objectContaining({
    taskSwitchPerf: expect.objectContaining({
      getLatest: expect.any(Function),
      getAll: expect.any(Function),
      clear: expect.any(Function),
    }),
  }),
);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir apps/desktop exec vitest run src/stores/kanna.querySnapshot.test.ts`

Expected: FAIL because `beginTaskSwitch` is never called and `taskSwitchPerf` is not exposed from the E2E hook.

- [ ] **Step 3: Add the selection start marker and E2E facade**

```ts
// selection.ts
import { beginTaskSwitch } from "../perf/taskSwitchPerf";

async function selectItem(itemId: string) {
  nav.select(itemId, context.state.selectedItemId.value);
  context.state.selectedItemId.value = itemId;
  const item = context.state.items.value.find((candidate) => candidate.id === itemId);
  if (item?.agent_type === "pty") {
    beginTaskSwitch(itemId);
  }
  if (item) {
    context.state.lastSelectedItemByRepo.value[item.repo_id] = itemId;
  }
  await setSetting(context.requireDb(), "selected_item_id", itemId);
  emitTaskSelected(itemId);
}
```

```ts
// main.ts
import {
  clearTaskSwitchPerfRecords,
  getLatestTaskSwitchPerfRecord,
  getTaskSwitchPerfRecords,
} from "./perf/taskSwitchPerf";

window.__KANNA_E2E__ = {
  get setupState() { /* existing logic */ },
  get dbName() { return dbName; },
  taskSwitchPerf: {
    getLatest: () => getLatestTaskSwitchPerfRecord(),
    getAll: () => getTaskSwitchPerfRecords(),
    clear: () => clearTaskSwitchPerfRecords(),
  },
};
```

```ts
// env.d.ts
interface KannaTaskSwitchPerfE2EApi {
  getLatest: () => unknown;
  getAll: () => unknown[];
  clear: () => void;
}

interface KannaE2EHook {
  setupState: object | null;
  dbName: string;
  taskSwitchPerf: KannaTaskSwitchPerfE2EApi;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --dir apps/desktop exec vitest run src/stores/kanna.querySnapshot.test.ts`

Expected: PASS with the new selection perf assertion and existing query snapshot coverage still green.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/stores/selection.ts apps/desktop/src/main.ts apps/desktop/src/env.d.ts apps/desktop/src/stores/kanna.querySnapshot.test.ts
git commit -m "feat: expose task switch perf state to selection and e2e"
```

### Task 3: Wire terminal-mounted, terminal-ready, and first-output markers into the PTY lifecycle

**Files:**
- Modify: `apps/desktop/src/components/TerminalView.vue`
- Modify: `apps/desktop/src/composables/useTerminal.ts`
- Test: `apps/desktop/src/components/__tests__/TerminalView.test.ts`
- Test: `apps/desktop/src/composables/useTerminal.test.ts`

- [ ] **Step 1: Write the failing terminal lifecycle tests**

```ts
const markTaskSwitchMountedMock = vi.fn();
const markTaskSwitchReadyMock = vi.fn();

vi.mock("../../perf/taskSwitchPerf", () => ({
  markTaskSwitchMounted: (...args: unknown[]) => markTaskSwitchMountedMock(...args),
  markTaskSwitchReady: (...args: unknown[]) => markTaskSwitchReadyMock(...args),
}));

it("marks mounted and ready on warm terminal activation", async () => {
  const wrapper = mount(TerminalView, {
    attachTo: document.body,
    props: {
      sessionId: "session-1",
      active: true,
      agentTerminal: true,
    },
  });

  await flushLifecycle();
  expect(markTaskSwitchMountedMock).toHaveBeenCalledWith("session-1");
  expect(markTaskSwitchReadyMock).toHaveBeenCalledWith("session-1", "cold");

  wrapper.unmount();
});
```

```ts
const markTaskSwitchFirstOutputMock = vi.fn();

vi.mock("./../perf/taskSwitchPerf", () => ({
  markTaskSwitchFirstOutput: (...args: unknown[]) => markTaskSwitchFirstOutputMock(...args),
}));

it("marks first output once for the selected terminal session", async () => {
  // existing harness setup
  outputListener?.({
    payload: {
      session_id: "session-1",
      data: Array.from(new TextEncoder().encode("streaming output")),
    },
  });
  outputListener?.({
    payload: {
      session_id: "session-1",
      data: Array.from(new TextEncoder().encode("more output")),
    },
  });
  expect(markTaskSwitchFirstOutputMock).toHaveBeenCalledTimes(1);
  expect(markTaskSwitchFirstOutputMock).toHaveBeenCalledWith("session-1");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir apps/desktop exec vitest run src/components/__tests__/TerminalView.test.ts src/composables/useTerminal.test.ts`

Expected: FAIL because no mounted/ready/first-output perf hooks exist yet.

- [ ] **Step 3: Add terminal lifecycle perf markers**

```ts
// TerminalView.vue
import { markTaskSwitchMounted, markTaskSwitchReady } from "../perf/taskSwitchPerf";

onMounted(async () => {
  if (containerRef.value) {
    init(containerRef.value);
    resizeObserver = new ResizeObserver(() => fitDeferred());
    resizeObserver.observe(containerRef.value);
    markTaskSwitchMounted(props.sessionId);
    await startWhenActive();
    markTaskSwitchReady(props.sessionId, "cold");
    await focusWhenActive();
  }
});

onActivated(async () => {
  markTaskSwitchMounted(props.sessionId);
  fitDeferred();
  await focusWhenActive();
  markTaskSwitchReady(props.sessionId, "warm");
});
```

```ts
// useTerminal.ts
import { markTaskSwitchFirstOutput } from "../perf/taskSwitchPerf";

if ((sid === sessionId || sid === teardownId) && terminal.value) {
  outputChunkCount += 1;
  if (sid === sessionId && outputChunkCount === 1) {
    markTaskSwitchFirstOutput(sessionId);
  }
  // existing output handling
}
```

Keep the `first-output` marker tied to the live `sessionId` only, not the teardown id.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --dir apps/desktop exec vitest run src/components/__tests__/TerminalView.test.ts src/composables/useTerminal.test.ts`

Expected: PASS with the new terminal perf assertions and no regressions in existing terminal behavior tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/TerminalView.vue apps/desktop/src/composables/useTerminal.ts apps/desktop/src/components/__tests__/TerminalView.test.ts apps/desktop/src/composables/useTerminal.test.ts
git commit -m "feat: add terminal lifecycle perf markers"
```

### Task 4: Extend the browser-mode Tauri mock for deterministic PTY switch coverage

**Files:**
- Modify: `apps/desktop/src/tauri-mock.ts`
- Test: `apps/desktop/src/stores/kanna.runtimeStatusSync.test.ts`

- [ ] **Step 1: Write the failing mock-session behavior test**

```ts
it("emits deterministic PTY output for mocked attached sessions", async () => {
  const store = await createStore();
  await store.selectRepo("repo-1");
  await store.selectItem("task-1");
  await flushStore();

  const outputEvent = await tauriInvoke(client, "__test_get_last_mock_terminal_output", {
    sessionId: "task-1",
  });

  expect(outputEvent).toEqual(
    expect.objectContaining({
      session_id: "task-1",
    }),
  );
});
```

If a direct Tauri-mock test is easier in this codebase, assert that `attach_session_with_snapshot` or `attach_session` causes a scheduled `terminal_output` emission for the attached PTY session id.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/desktop exec vitest run src/stores/kanna.runtimeStatusSync.test.ts`

Expected: FAIL because the browser-mode Tauri mock does not synthesize PTY output for task session attaches.

- [ ] **Step 3: Add deterministic mock PTY session output**

```ts
// tauri-mock.ts
type MockTauriEventHandler = (event: { payload: Record<string, unknown> }) => void;

const eventHandlers = new Map<string, Set<MockTauriEventHandler>>();
const attachedMockSessions = new Set<string>();

function emitMockEvent(name: string, payload: Record<string, unknown>) {
  for (const handler of eventHandlers.get(name) ?? []) {
    handler({ payload });
  }
}

function scheduleMockTerminalOutput(sessionId: string) {
  queueMicrotask(() => {
    emitMockEvent("terminal_output", {
      session_id: sessionId,
      data: Array.from(new TextEncoder().encode(`mock output for ${sessionId}`)),
    });
  });
}

const invokeHandlers: Record<string, (...args: any[]) => any> = {
  attach_session: (args: { sessionId?: string }) => {
    if (args.sessionId) {
      attachedMockSessions.add(args.sessionId);
      scheduleMockTerminalOutput(args.sessionId);
    }
    return {};
  },
  attach_session_with_snapshot: (args: { sessionId?: string }) => {
    if (args.sessionId) {
      attachedMockSessions.add(args.sessionId);
      queueMicrotask(() => {
        emitMockEvent("terminal_snapshot", {
          session_id: args.sessionId,
          snapshot: {
            version: 1,
            rows: 24,
            cols: 80,
            cursor_row: 0,
            cursor_col: 0,
            cursor_visible: true,
            vt: `mock restored scrollback for ${args.sessionId}`,
          },
        });
        scheduleMockTerminalOutput(args.sessionId);
      });
    }
    return {};
  },
};
```

If the mock event bus already exists elsewhere in the file, extend that path instead of duplicating it.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/desktop exec vitest run src/stores/kanna.runtimeStatusSync.test.ts`

Expected: PASS with the new deterministic PTY output behavior and existing runtime reconciliation tests still green.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/tauri-mock.ts apps/desktop/src/stores/kanna.runtimeStatusSync.test.ts
git commit -m "test: add deterministic mock pty output for task switching"
```

### Task 5: Add mocked E2E coverage and a helper for reading task-switch perf records

**Files:**
- Create: `apps/desktop/tests/e2e/helpers/taskSwitchPerf.ts`
- Create: `apps/desktop/tests/e2e/mock/task-switch-performance.test.ts`
- Modify: `apps/desktop/tests/e2e/helpers/vue.ts`

- [ ] **Step 1: Write the failing mocked E2E helper and test**

```ts
// helpers/taskSwitchPerf.ts
import { WebDriverClient } from "./webdriver";

export async function clearTaskSwitchPerf(client: WebDriverClient): Promise<void> {
  await client.executeSync("window.__KANNA_E2E__.taskSwitchPerf.clear();");
}

export async function getLatestTaskSwitchPerf(client: WebDriverClient): Promise<unknown> {
  return await client.executeSync("return window.__KANNA_E2E__.taskSwitchPerf.getLatest();");
}
```

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { WebDriverClient } from "../helpers/webdriver";
import { cleanupWorktrees, importTestRepo, resetDatabase } from "../helpers/reset";
import { cleanupFixtureRepos, createFixtureRepo } from "../helpers/fixture-repo";
import { clearTaskSwitchPerf, getLatestTaskSwitchPerf } from "../helpers/taskSwitchPerf";

describe("task switch performance", () => {
  const client = new WebDriverClient();
  let repoId = "";
  let fixtureRepoRoot = "";
  let testRepoPath = "";

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
    fixtureRepoRoot = await createFixtureRepo("task-switch-perf");
    testRepoPath = join(fixtureRepoRoot, "apps");
    repoId = await importTestRepo(client, testRepoPath, "task-switch-perf");
  });

  afterAll(async () => {
    if (testRepoPath) await cleanupWorktrees(client, testRepoPath);
    await cleanupFixtureRepos(fixtureRepoRoot ? [fixtureRepoRoot] : []);
    await client.deleteSession();
  });

  it("records PTY task-switch markers and prints timings", async () => {
    await client.executeAsync(`
      const cb = arguments[arguments.length - 1];
      const ctx = window.__KANNA_E2E__.setupState;
      Promise.all([
        ctx.createItem(${JSON.stringify(repoId)}, ${JSON.stringify(testRepoPath)}, "Perf Task A", "pty"),
        ctx.createItem(${JSON.stringify(repoId)}, ${JSON.stringify(testRepoPath)}, "Perf Task B", "pty"),
      ]).then(() => cb("ok")).catch((error) => cb(String(error)));
    `);

    await clearTaskSwitchPerf(client);

    await client.executeAsync(`
      const cb = arguments[arguments.length - 1];
      const ctx = window.__KANNA_E2E__.setupState;
      Promise.resolve(ctx.store.selectItem(ctx.items.value.find((item) => item.prompt === "Perf Task A").id))
        .then(() => Promise.resolve(ctx.store.selectItem(ctx.items.value.find((item) => item.prompt === "Perf Task B").id)))
        .then(() => cb("ok"))
        .catch((error) => cb(String(error)));
    `);

    const latest = await getLatestTaskSwitchPerf(client) as Record<string, unknown> | null;
    console.log("[e2e][task-switch-perf]", JSON.stringify(latest));

    expect(latest).toEqual(expect.objectContaining({
      taskId: expect.any(String),
      terminalKind: "pty",
      path: expect.stringMatching(/warm|cold|unknown/),
      completed: true,
      marks: expect.objectContaining({
        start: expect.any(Number),
        "terminal-mounted": expect.any(Number),
        "terminal-ready": expect.any(Number),
      }),
      measures: expect.objectContaining({
        total: expect.any(Number),
        mount: expect.any(Number),
        ready: expect.any(Number),
      }),
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/desktop exec vitest run tests/e2e/mock/task-switch-performance.test.ts`

Expected: FAIL because the helper file does not exist and the app does not yet expose or populate task switch perf records.

- [ ] **Step 3: Add the E2E helper and finalize the mock E2E test**

```ts
// helpers/vue.ts
export async function getTaskSwitchPerf(
  client: WebDriverClient,
): Promise<unknown[]> {
  return client.executeSync(
    "return window.__KANNA_E2E__.taskSwitchPerf.getAll();",
  );
}
```

```ts
// tests/e2e/helpers/taskSwitchPerf.ts
import { WebDriverClient } from "./webdriver";

export async function clearTaskSwitchPerf(client: WebDriverClient): Promise<void> {
  await client.executeSync("window.__KANNA_E2E__.taskSwitchPerf.clear();");
}

export async function getLatestTaskSwitchPerf(client: WebDriverClient): Promise<unknown> {
  return await client.executeSync("return window.__KANNA_E2E__.taskSwitchPerf.getLatest();");
}

export async function getAllTaskSwitchPerf(client: WebDriverClient): Promise<unknown[]> {
  return await client.executeSync("return window.__KANNA_E2E__.taskSwitchPerf.getAll();");
}
```

Use a polling loop in the E2E test if needed so it waits up to a few seconds for the latest perf record to become `completed: true`.

- [ ] **Step 4: Run the mocked E2E test and the supporting unit tests**

Run: `pnpm --dir apps/desktop exec vitest run tests/e2e/mock/task-switch-performance.test.ts src/perf/taskSwitchPerf.test.ts src/components/__tests__/TerminalView.test.ts src/composables/useTerminal.test.ts`

Expected: PASS, with the E2E test printing a structured timing record to stdout and asserting marker coverage without using a numeric threshold.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/tests/e2e/helpers/taskSwitchPerf.ts apps/desktop/tests/e2e/helpers/vue.ts apps/desktop/tests/e2e/mock/task-switch-performance.test.ts
git commit -m "test: cover task switch perf markers with mocked e2e"
```

### Task 6: Final verification pass

**Files:**
- Modify: none
- Test: `apps/desktop/src/perf/taskSwitchPerf.test.ts`
- Test: `apps/desktop/src/stores/kanna.querySnapshot.test.ts`
- Test: `apps/desktop/src/components/__tests__/TerminalView.test.ts`
- Test: `apps/desktop/src/composables/useTerminal.test.ts`
- Test: `apps/desktop/src/stores/kanna.runtimeStatusSync.test.ts`
- Test: `apps/desktop/tests/e2e/mock/task-switch-performance.test.ts`

- [ ] **Step 1: Run the focused frontend unit/component/store tests**

Run:

```bash
pnpm --dir apps/desktop exec vitest run \
  src/perf/taskSwitchPerf.test.ts \
  src/stores/kanna.querySnapshot.test.ts \
  src/components/__tests__/TerminalView.test.ts \
  src/composables/useTerminal.test.ts \
  src/stores/kanna.runtimeStatusSync.test.ts
```

Expected: PASS for all targeted tests.

- [ ] **Step 2: Run the mocked E2E test**

Run:

```bash
pnpm --dir apps/desktop exec vitest run tests/e2e/mock/task-switch-performance.test.ts
```

Expected: PASS and print a record like:

```text
[e2e][task-switch-perf] {"taskId":"...","path":"warm","measures":{"total":12.3,"mount":4.1,"ready":8.2}}
```

- [ ] **Step 3: Run desktop TypeScript verification**

Run:

```bash
pnpm --dir apps/desktop exec tsc --noEmit
```

Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/perf/taskSwitchPerf.ts \
  apps/desktop/src/perf/taskSwitchPerf.test.ts \
  apps/desktop/src/stores/selection.ts \
  apps/desktop/src/main.ts \
  apps/desktop/src/env.d.ts \
  apps/desktop/src/stores/kanna.querySnapshot.test.ts \
  apps/desktop/src/components/TerminalView.vue \
  apps/desktop/src/composables/useTerminal.ts \
  apps/desktop/src/components/__tests__/TerminalView.test.ts \
  apps/desktop/src/composables/useTerminal.test.ts \
  apps/desktop/src/tauri-mock.ts \
  apps/desktop/src/stores/kanna.runtimeStatusSync.test.ts \
  apps/desktop/tests/e2e/helpers/taskSwitchPerf.ts \
  apps/desktop/tests/e2e/helpers/vue.ts \
  apps/desktop/tests/e2e/mock/task-switch-performance.test.ts
git commit -m "feat: instrument task switch performance"
```
