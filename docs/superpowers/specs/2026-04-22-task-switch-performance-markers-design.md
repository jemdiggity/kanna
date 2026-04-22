# Task Switch Performance Markers Design

## Goal

Add frontend performance instrumentation for PTY task switching and cover it with a mocked E2E test.

The first slice is intentionally narrow:

- instrument task switch latency only
- focus on PTY task terminals
- expose measurements to the existing E2E harness
- add one mocked E2E test that validates marker coverage and prints timings
- do not fail the test on a hard timing threshold yet

This is meant to answer a specific product question: when switching tasks, where is time spent between selection and the terminal becoming usable again?

## Non-Goals

- no performance budgets or pass/fail latency thresholds in this slice
- no instrumentation for task creation, diff loading, shell modals, or SDK terminals
- no backend or daemon timing channel
- no persisted telemetry or analytics upload
- no user-facing performance UI

## Current Problem

Task switching is now faster for recently viewed PTY tasks because we keep a warm cache of terminals, but there is no reliable, testable measurement of:

- when a task switch starts
- whether the switch hit a warm terminal or cold path
- when the terminal is visually ready again
- when the first live output arrives after the switch

We currently have scattered `performance.now()` logging in some store paths, but those logs are not structured, are not centered on task switching, and are not easy for E2E tests to assert against.

## Design Summary

Introduce a small browser-side task switch performance recorder that:

- writes `performance.mark` and `performance.measure` entries
- maintains a bounded in-memory list of recent task switch records
- is exposed through `window.__KANNA_E2E__` in dev/E2E builds

Instrumentation will be emitted at four boundaries:

1. task selected
2. terminal host becomes active
3. terminal ready for interaction
4. first output observed after the switch

The mocked E2E test will create two PTY tasks, switch between them, read the latest performance record from `window.__KANNA_E2E__`, assert that the expected markers and measures exist, and log the measured durations.

## Approaches Considered

### 1. Browser Performance API plus structured in-memory records

Use `performance.mark` / `performance.measure` for raw timings, and mirror the important results into a small structured task-switch record store.

Pros:

- uses a standard timing primitive
- easy to inspect manually in dev tools
- easy for E2E to consume through a stable app-owned API
- lets us attach metadata like task id and warm/cold path

Cons:

- requires a small amount of bookkeeping code around marks and cleanup

### 2. Browser Performance API only

Let the E2E test query raw browser performance entries directly.

Pros:

- less app-owned state

Cons:

- brittle once multiple switches happen in a single run
- harder to associate entries with a specific task id or switch attempt
- harder to reset between tests

### 3. Console log timings only

Log timing data and scrape logs in tests.

Pros:

- fastest to add

Cons:

- poor structure
- brittle in tests
- harder to evolve into richer instrumentation later

### Recommendation

Use approach 1. It preserves native browser timing entries while giving the E2E suite a stable structured API.

## Architecture

### New module: task switch performance recorder

Add a small frontend-only module, likely under `apps/desktop/src/perf/` or `apps/desktop/src/composables/`, that owns task switch timing state.

Its responsibilities:

- start a new switch record
- emit named marks
- emit measures between known marks
- store recent completed or in-flight switch records in memory
- bound memory with a small ring buffer
- expose read/reset helpers for E2E

Suggested API shape:

```ts
interface TaskSwitchPerfRecord {
  switchId: number;
  taskId: string;
  terminalKind: "pty";
  path: "warm" | "cold" | "unknown";
  startedAt: number;
  marks: Partial<Record<
    "start" | "terminal-mounted" | "terminal-ready" | "first-output",
    number
  >>;
  measures: Partial<Record<
    "total" | "mount" | "ready" | "first-output",
    number
  >>;
  completed: boolean;
}
```

Suggested public methods:

- `beginTaskSwitch(taskId: string): number`
- `markTaskSwitchMounted(taskId: string): void`
- `markTaskSwitchReady(taskId: string, path: "warm" | "cold" | "unknown"): void`
- `markTaskSwitchFirstOutput(taskId: string): void`
- `getLatestTaskSwitchRecord(): TaskSwitchPerfRecord | null`
- `getTaskSwitchRecords(): TaskSwitchPerfRecord[]`
- `clearTaskSwitchRecords(): void`

The recorder should tolerate repeated or out-of-order calls by ignoring duplicate marks for the same switch phase.

### E2E exposure

Extend the existing `window.__KANNA_E2E__` dev hook to expose the recorder API or a narrow facade around it.

Suggested shape:

```ts
window.__KANNA_E2E__.taskSwitchPerf = {
  getLatest: () => TaskSwitchPerfRecord | null,
  getAll: () => TaskSwitchPerfRecord[],
  clear: () => void,
}
```

This keeps tests from reaching into internal module instances directly.

## Marker Definitions

### 1. `task-switch:start`

Emitted when the selected task changes through the normal selection path.

Source of truth:

- store selection layer, immediately after `selectedItemId` is updated

Why here:

- this is the first moment the app has committed to the new task
- it avoids guessing from DOM changes

### 2. `task-switch:terminal-mounted`

Emitted when the `TerminalView` for the selected PTY task becomes the active visible terminal host.

Source of truth:

- `TerminalView` `onMounted` for a cold path
- `TerminalView` `onActivated` for a warm-cache hit

Why here:

- it distinguishes “selection changed” from “terminal host is now on screen”

### 3. `task-switch:terminal-ready`

Emitted when the terminal is usable again.

Definition:

- warm path: after activation refit/refocus work has completed
- cold path: after the initial attach/snapshot startup path has completed enough for the terminal to be shown and interacted with

Source of truth:

- `TerminalView` after `startListening()` completes on first mount
- `TerminalView` after activation fit/focus completes on warm reuse

This marker is the primary “switch complete” signal for the first slice.

### 4. `task-switch:first-output`

Emitted on the first observed terminal output event for the selected task after a given switch begins.

Source of truth:

- terminal output listener path in `useTerminal`

Why include it:

- it helps distinguish “terminal became ready” from “agent resumed visibly producing output”
- it is useful diagnostic context even if it is not the main completion signal

## Derived Measures

For each switch record, compute:

- `total`: `start -> terminal-ready`
- `mount`: `start -> terminal-mounted`
- `ready`: `terminal-mounted -> terminal-ready`
- `first-output`: `start -> first-output`

If `first-output` never occurs before the next switch or test end, the record should simply omit that measure.

## Warm vs Cold Path Detection

The recorder should annotate each completed switch with a path:

- `warm`: terminal came from `KeepAlive` reactivation
- `cold`: terminal required first mount/attach path
- `unknown`: fallback if the instrumentation cannot determine the path cleanly

The warm/cold flag should be set by the terminal view lifecycle boundary, not guessed later from timing.

## Data Flow

### Switch start

`selection.ts`
→ selected item changes
→ recorder begins a new switch record for that task id
→ `performance.mark("task-switch:<id>:start")`

### Terminal host active

`TerminalView.vue`
→ mount or activation for the selected PTY task
→ recorder marks terminal mounted
→ `performance.mark("task-switch:<id>:terminal-mounted")`

### Terminal ready

`TerminalView.vue`
→ cold path waits for startup attach flow to complete
→ warm path waits for activation fit/focus completion
→ recorder marks ready with `path`
→ `performance.mark("task-switch:<id>:terminal-ready")`
→ measures are computed

### First output

`useTerminal.ts`
→ first output chunk observed after switch start
→ recorder marks first output if not already marked
→ `performance.mark("task-switch:<id>:first-output")`
→ optional measure computed

## Error Handling and Edge Cases

### Rapid repeated selection changes

If the user switches tasks again before the previous switch reaches ready:

- the previous record remains incomplete
- a new switch record starts for the new selected task
- later terminal events only apply to the currently active matching task id

We do not retroactively force-complete abandoned switch attempts in this slice.

### Non-PTY tasks

Do not emit task switch records for SDK terminals in this slice. The recorder should simply ignore non-PTY selection flows.

### Missing output

If no output arrives after a switch, the record remains valid without a `first-output` mark or measure.

### Repeated lifecycle callbacks

Warm terminals may activate multiple times. Duplicate marks for the same switch phase should be ignored once recorded.

### Test isolation

The E2E facade must provide a `clear()` method so each test can reset state before starting measurements.

## Testing Plan

### Unit tests

Add focused tests for the recorder module:

- begins a record on switch start
- records mounted, ready, and first-output once
- computes derived measures correctly
- ignores duplicate phase marks
- keeps bounded history

### Component/composable tests

Add narrow tests where useful for wiring:

- selection start marker is fired when `selectItem` changes the selected task
- warm `TerminalView` activation emits a ready marker without remounting
- first terminal output records the first-output mark once

### Mocked E2E test

Add one new mocked E2E test under `apps/desktop/tests/e2e/mock/` that:

1. resets DB and app state
2. creates/imports a fixture repo
3. creates two PTY tasks using mocked agent session behavior
4. clears task switch perf state
5. selects task A, then task B, then task A again
6. reads the latest and/or all task switch records from `window.__KANNA_E2E__`
7. asserts:
   - at least one completed PTY switch record exists
   - the latest record has `start`, `terminal-mounted`, and `terminal-ready`
   - `total`, `mount`, and `ready` measures are present
   - `path` is one of `warm`, `cold`, or `unknown`
8. prints the record timings for inspection

The test should not assert a latency threshold in this slice.

## Mocked Agent Strategy

The mocked E2E should stay inside the existing browser/mock mode. We do not need a real agent CLI.

The existing Tauri mock already stubs terminal-related commands. For this test, extend the mock behavior just enough to make PTY task switching exercise the terminal lifecycle:

- attaching a session should succeed
- a small synthetic `terminal_output` event should be emitted for the selected mock PTY session
- warm switches should still flow through the real frontend terminal lifecycle

This preserves the actual task selection and terminal UI wiring while avoiding real PTY dependencies.

## Observability

The recorder should be dev-safe and low-noise:

- no persistent storage
- no analytics upload
- no console spam by default

The E2E test can log the structured timings intentionally.

## Rollout

Implement in one slice:

1. add recorder module
2. wire markers at selection and terminal boundaries
3. expose E2E facade
4. add mocked E2E test

Future slices can add:

- numeric budgets
- creation-flow instrumentation
- SDK terminal coverage
- diff viewer performance coverage

## Acceptance Criteria

- selecting a PTY task emits a structured task switch performance record
- the record includes start, mounted, and ready phases
- recent records are accessible via `window.__KANNA_E2E__`
- a mocked E2E test validates the marker sequence and prints measured timings
- no hard timing threshold is enforced yet
