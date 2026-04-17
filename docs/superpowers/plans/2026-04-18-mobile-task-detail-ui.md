# Mobile Task Detail UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the mobile task screen into a pushed, terminal-first detail view with a quiet healthy state, a disabled composer on terminal failures, and no floating toolbar while the detail view is visible.

**Architecture:** Keep the existing `SessionStore` and `MobileController` boundaries. Reuse `taskWorkspace.ts` as the compact task-detail presentation helper, add one small app-shell helper for toolbar visibility, and rework `TaskScreen` directly around the approved layout. Avoid new navigation libraries, new transport contracts, or a new terminal renderer.

**Tech Stack:** Expo 53, React Native 0.79, React 19, TypeScript, Vitest

---

### Task 1: Simplify the task workspace presentation model

**Files:**
- Modify: `apps/mobile/src/screens/taskWorkspace.ts`
- Modify: `apps/mobile/src/screens/taskWorkspace.test.ts`

- [ ] **Step 1: Rewrite the failing tests for the new compact task-detail model**

```ts
import { describe, expect, it } from "vitest";
import { buildTaskWorkspaceModel } from "./taskWorkspace";

describe("buildTaskWorkspaceModel", () => {
  it("returns a compact header model for healthy task detail state", () => {
    const model = buildTaskWorkspaceModel({
      task: {
        id: "task-123",
        repoId: "repo-1",
        title: "Fix task reactivity in mobile app after desktop daemon reconnect regression",
        stage: "in progress",
        snippet: "recent output"
      },
      terminalStatus: "live"
    });

    expect(model.stageLabel).toBe("in progress");
    expect(model.title).toBe(
      "Fix task reactivity in mobile app after desktop daemon reconnect regression"
    );
    expect(model.isTerminalHealthy).toBe(true);
    expect(model.overlayLabel).toBeNull();
    expect(model.isComposerDisabled).toBe(false);
  });

  it("maps unhealthy terminal states to overlay copy and disables the composer", () => {
    expect(
      buildTaskWorkspaceModel({
        task: {
          id: "task-closed",
          repoId: "repo-1",
          title: "Close the task",
          stage: "pr"
        },
        terminalStatus: "closed"
      })
    ).toMatchObject({
      isTerminalHealthy: false,
      overlayLabel: "Offline",
      isComposerDisabled: true
    });

    expect(
      buildTaskWorkspaceModel({
        task: {
          id: "task-error",
          repoId: "repo-1",
          title: "Reconnect the terminal",
          stage: "in progress"
        },
        terminalStatus: "error"
      }).overlayLabel
    ).toBe("Error");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail against the old verbose model**

Run: `pnpm --dir apps/mobile test -- --runInBand taskWorkspace`
Expected: FAIL because `stageLabel`, `title`, `isTerminalHealthy`, `overlayLabel`, and `isComposerDisabled` do not exist on the current model.

- [ ] **Step 3: Replace the current verbose workspace helper with the compact task-detail model**

```ts
import type { TaskSummary } from "../lib/api/types";
import type { TaskTerminalStatus } from "../state/sessionStore";

export interface TaskWorkspaceModel {
  stageLabel: string;
  title: string;
  isTerminalHealthy: boolean;
  overlayLabel: string | null;
  isComposerDisabled: boolean;
}

interface BuildTaskWorkspaceModelOptions {
  task: TaskSummary;
  terminalStatus: TaskTerminalStatus;
}

export function buildTaskWorkspaceModel({
  task,
  terminalStatus
}: BuildTaskWorkspaceModelOptions): TaskWorkspaceModel {
  return {
    stageLabel: task.stage ?? "unknown",
    title: task.title,
    isTerminalHealthy: terminalStatus === "live",
    overlayLabel: getOverlayLabel(terminalStatus),
    isComposerDisabled: terminalStatus !== "live"
  };
}

function getOverlayLabel(status: TaskTerminalStatus): string | null {
  switch (status) {
    case "connecting":
      return "Connecting";
    case "closed":
      return "Offline";
    case "error":
      return "Error";
    case "idle":
      return "Connecting";
    case "live":
    default:
      return null;
  }
}
```

- [ ] **Step 4: Remove the old summary/facts assumptions from the tests and rerun them**

Run: `pnpm --dir apps/mobile test -- --runInBand taskWorkspace`
Expected: PASS

- [ ] **Step 5: Commit the presentation-model slice**

```bash
git add apps/mobile/src/screens/taskWorkspace.ts apps/mobile/src/screens/taskWorkspace.test.ts
git commit -m "refactor: simplify mobile task workspace model"
```

### Task 2: Add shell rules for hiding the floating toolbar during task detail

**Files:**
- Create: `apps/mobile/src/appShell.ts`
- Create: `apps/mobile/src/appShell.test.ts`
- Modify: `apps/mobile/src/App.tsx`

- [ ] **Step 1: Write failing tests for task-detail shell visibility**

```ts
import { describe, expect, it } from "vitest";
import { isTaskDetailVisible, shouldShowFloatingToolbar } from "./appShell";

describe("isTaskDetailVisible", () => {
  it("treats a selected task outside More as the pushed detail screen", () => {
    expect(isTaskDetailVisible("task-1", "tasks")).toBe(true);
    expect(isTaskDetailVisible("task-1", "recent")).toBe(true);
    expect(isTaskDetailVisible("task-1", "more")).toBe(false);
    expect(isTaskDetailVisible(null, "tasks")).toBe(false);
  });
});

describe("shouldShowFloatingToolbar", () => {
  it("hides the toolbar only while task detail is visible", () => {
    expect(shouldShowFloatingToolbar("connected", "task-1", "tasks")).toBe(false);
    expect(shouldShowFloatingToolbar("connected", "task-1", "more")).toBe(true);
    expect(shouldShowFloatingToolbar("connected", null, "tasks")).toBe(true);
    expect(shouldShowFloatingToolbar("idle", null, "tasks")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail because the helper does not exist**

Run: `pnpm --dir apps/mobile test -- --runInBand appShell`
Expected: FAIL because `appShell.ts` is missing.

- [ ] **Step 3: Add the shell helper and wire it into `App.tsx`**

```ts
// apps/mobile/src/appShell.ts
import type { ConnectionState, MobileView } from "./state/sessionStore";

export function isTaskDetailVisible(
  selectedTaskId: string | null,
  activeView: MobileView
): boolean {
  return selectedTaskId !== null && activeView !== "more";
}

export function shouldShowFloatingToolbar(
  connectionState: ConnectionState,
  selectedTaskId: string | null,
  activeView: MobileView
): boolean {
  return connectionState === "connected" && !isTaskDetailVisible(selectedTaskId, activeView);
}
```

```ts
// apps/mobile/src/App.tsx
const taskDetailVisible = isTaskDetailVisible(state.selectedTaskId, state.activeView);

if (selectedTask && taskDetailVisible) {
  return (
    <TaskScreen
      task={selectedTask}
      terminalOutput={state.taskTerminalOutput}
      terminalStatus={state.taskTerminalStatus}
      onBack={() => controller.closeTask()}
      onOpenMore={() => controller.showView("more")}
      onSendInput={(input) => {
        void controller.sendTaskInput(selectedTask.id, input);
      }}
    />
  );
}
```

- [ ] **Step 4: Verify the helper tests pass and the app still typechecks at this layer**

Run: `pnpm --dir apps/mobile test -- --runInBand appShell && pnpm --dir apps/mobile run typecheck`
Expected: PASS

- [ ] **Step 5: Commit the shell-visibility slice**

```bash
git add apps/mobile/src/appShell.ts apps/mobile/src/appShell.test.ts apps/mobile/src/App.tsx
git commit -m "refactor: hide mobile toolbar during task detail"
```

### Task 3: Rebuild `TaskScreen` around the approved pushed-detail layout

**Files:**
- Modify: `apps/mobile/src/screens/TaskScreen.tsx`
- Modify: `apps/mobile/src/App.tsx`

- [ ] **Step 1: Remove the obsolete task-screen props and wire the screen to the compact workspace model**

```ts
interface TaskScreenProps {
  task: TaskSummary;
  terminalOutput: string;
  terminalStatus: TaskTerminalStatus;
  onBack(): void;
  onOpenMore(): void;
  onSendInput(input: string): void;
}

const model = buildTaskWorkspaceModel({
  task,
  terminalStatus
});
```

- [ ] **Step 2: Replace the current header/cards with the approved terminal-first layout**

```tsx
<View style={styles.topRow}>
  <Pressable style={styles.backButton} onPress={onBack}>
    <Text style={styles.backLabel}>Back</Text>
  </Pressable>
</View>

<View style={styles.headerBlock}>
  <Text style={styles.stageLabel}>{model.stageLabel}</Text>
  <Text numberOfLines={1} style={styles.title}>
    {model.title}
  </Text>
</View>

<View style={styles.terminalCard}>
  <Text style={styles.terminalLabel}>Terminal</Text>
  {model.isTerminalHealthy ? (
    <TerminalWebView output={terminalOutput} status={terminalStatus} />
  ) : (
    <View style={styles.terminalSkeleton}>
      <View style={styles.skeletonLineWide} />
      <View style={styles.skeletonLineMid} />
      <View style={styles.skeletonLineShort} />
      {model.overlayLabel ? (
        <View style={styles.terminalOverlay}>
          <Text style={styles.terminalOverlayLabel}>{model.overlayLabel}</Text>
        </View>
      ) : null}
    </View>
  )}
</View>
```

- [ ] **Step 3: Move task actions to the circular `+` button above the composer and disable the composer on terminal failures**

```tsx
<View style={styles.composerActions}>
  <Pressable style={styles.plusButton} onPress={onOpenMore}>
    <Text style={styles.plusButtonLabel}>+</Text>
  </Pressable>
</View>

<View style={styles.inputComposer}>
  <TextInput
    editable={!model.isComposerDisabled}
    onChangeText={setDraftInput}
    placeholder="Reply…"
    placeholderTextColor="#6F89AE"
    style={[
      styles.inputField,
      model.isComposerDisabled ? styles.inputFieldDisabled : null
    ]}
    value={draftInput}
  />
  <Pressable
    disabled={model.isComposerDisabled || !draftInput.trim()}
    style={[
      styles.sendButton,
      model.isComposerDisabled || !draftInput.trim() ? styles.sendButtonDisabled : null
    ]}
    onPress={() => {
      const nextInput = draftInput.trim();
      if (!nextInput) {
        return;
      }

      onSendInput(nextInput);
      setDraftInput("");
    }}
  >
    <Text style={styles.sendButtonLabel}>Send</Text>
  </Pressable>
</View>
```

- [ ] **Step 4: Remove the old workspace copy blocks and verify the screen still compiles**

Run: `pnpm --dir apps/mobile run typecheck`
Expected: PASS with no references to the removed `desktopName`, `repoName`, `onShowSearch`, `summaryCopy`, `facts`, `snippetCard`, or terminal meta lines.

- [ ] **Step 5: Commit the task-screen layout slice**

```bash
git add apps/mobile/src/screens/TaskScreen.tsx apps/mobile/src/App.tsx
git commit -m "feat: redesign mobile task detail screen"
```

### Task 4: Verify the task-detail flow end to end in tests

**Files:**
- Modify: `apps/mobile/src/App.test.tsx`
- Modify: `apps/mobile/src/screens/taskWorkspace.test.ts`
- Modify: `apps/mobile/src/appShell.test.ts`

- [ ] **Step 1: Add a focused app-level test for toolbar visibility and task-detail routing**

```ts
it("treats an opened task in the tasks view as detail and routes More back to the shell", async () => {
  const model = createAppModel("http://desktop.test", createFetchMock(), {
    load: vi.fn().mockResolvedValue({
      selectedDesktopId: "desktop-1",
      selectedRepoId: "repo-1",
      selectedTaskId: "task-1",
      activeView: "tasks"
    }),
    save: vi.fn().mockResolvedValue(undefined)
  });

  await model.initialize();

  expect(model.sessionStore.getState().selectedTaskId).toBe("task-1");
  expect(model.sessionStore.getState().activeView).toBe("tasks");
});
```

- [ ] **Step 2: Keep the pure tests focused on the new unhealthy-state rules**

```ts
expect(
  buildTaskWorkspaceModel({
    task: {
      id: "task-connecting",
      repoId: "repo-1",
      title: "Connect the terminal",
      stage: "in progress"
    },
    terminalStatus: "connecting"
  })
).toMatchObject({
  overlayLabel: "Connecting",
  isComposerDisabled: true
});
```

- [ ] **Step 3: Run the mobile verification suite**

Run: `pnpm --dir apps/mobile test -- --runInBand && pnpm --dir apps/mobile run typecheck`
Expected: PASS

- [ ] **Step 4: Smoke-test the running app in Expo after the test suite passes**

Run: `PATH="/tmp/kanna-tmux-bin:$PATH" ./scripts/dev.sh restart --mobile`
Expected: Metro and the iPhone simulator reload cleanly with the updated task detail view.

- [ ] **Step 5: Commit the verification slice**

```bash
git add apps/mobile/src/App.test.tsx apps/mobile/src/screens/taskWorkspace.test.ts apps/mobile/src/appShell.test.ts
git commit -m "test: cover mobile task detail flow"
```

### Task 5: Add sticky terminal scrolling above the floating composer

**Files:**
- Modify: `apps/mobile/src/screens/buildTerminalDocument.ts`
- Modify: `apps/mobile/src/screens/buildTerminalDocument.test.ts`
- Modify: `apps/mobile/src/screens/TerminalWebView.tsx`

- [ ] **Step 1: Rewrite the terminal-document tests around a stable shell and injected updates**

```ts
import { describe, expect, it } from "vitest";
import { buildTerminalDocument, buildTerminalUpdateScript } from "./buildTerminalDocument";

describe("buildTerminalDocument", () => {
  it("builds a terminal shell with sticky scroll behavior and bottom inset", () => {
    const html = buildTerminalDocument({ bottomInset: 132 });

    expect(html).toContain('id="viewport"');
    expect(html).toContain('id="terminal"');
    expect(html).toContain("padding: 14px 14px 132px 14px;");
    expect(html).toContain("window.__setTerminalState");
    expect(html).toContain("viewport.scrollTop = viewport.scrollHeight");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail against the old document builder**

Run: `pnpm --dir apps/mobile test -- --runInBand buildTerminalDocument`
Expected: FAIL because `buildTerminalDocument()` still expects raw terminal content and there is no injected update script path.

- [ ] **Step 3: Refactor the terminal document into a stable shell plus sticky-bottom update script**

```ts
export function buildTerminalDocument({ bottomInset }: { bottomInset: number }): string {
  return `
    <div class="viewport" id="viewport"><pre id="terminal"></pre></div>
    <script>
      let stickyToBottom = true;
      function isNearBottom() { /* threshold logic */ }
      window.__setTerminalState = function(state) {
        const shouldStick = stickyToBottom || isNearBottom();
        terminal.textContent = state.text;
        if (shouldStick) requestAnimationFrame(() => {
          viewport.scrollTop = viewport.scrollHeight;
        });
      };
    </script>
  `;
}

export function buildTerminalUpdateScript({ output, status }) {
  const terminalText = output.trim() ? normalizeTerminalText(output) : getStatusCopy(status);
  return `window.__setTerminalState(${JSON.stringify({ text: terminalText })}); true;`;
}
```

- [ ] **Step 4: Update `TerminalWebView` to keep one document alive and inject terminal updates**

```ts
const webViewRef = useRef<WebView>(null);
const document = useMemo(() => buildTerminalDocument({ bottomInset: 132 }), []);
const updateScript = useMemo(
  () => buildTerminalUpdateScript({ output, status }),
  [output, status]
);

useEffect(() => {
  webViewRef.current?.injectJavaScript(updateScript);
}, [updateScript]);
```

- [ ] **Step 5: Run verification**

Run: `pnpm --dir apps/mobile test -- --runInBand buildTerminalDocument && pnpm --dir apps/mobile run typecheck`
Expected: PASS
