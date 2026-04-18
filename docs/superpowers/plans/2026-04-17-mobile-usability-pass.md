# Mobile Usability Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Expo mobile app usable for day-to-day task scanning, task opening, live terminal reading, agent input, and task actions from the More surface.

**Architecture:** Keep the existing session store and controller boundaries, add a small amount of presentation-focused derivation, and rework the current screens/components around that derived data. Avoid new navigation state or API contracts in this pass.

**Tech Stack:** Expo 53, React Native 0.79, React 19, TypeScript, Vitest

---

### Task 1: Add presentation helpers for task lists and workspace context

**Files:**
- Create: `apps/mobile/src/screens/taskPresentation.ts`
- Create: `apps/mobile/src/screens/taskPresentation.test.ts`
- Modify: `apps/mobile/src/screens/taskWorkspace.ts`
- Modify: `apps/mobile/src/screens/taskWorkspace.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  buildTaskListItemModel,
  buildTaskWorkspaceHeaderModel
} from "./taskPresentation";

describe("buildTaskListItemModel", () => {
  it("prefers repo names and trims snippets for task cards", () => {
    const model = buildTaskListItemModel(
      {
        id: "task-1",
        repoId: "repo-1",
        title: "Refactor mobile task cards",
        stage: "in progress",
        snippet: "  Recent output line  "
      },
      "kanna-tauri",
      false
    );

    expect(model.repoLabel).toBe("kanna-tauri");
    expect(model.stageLabel).toBe("in progress");
    expect(model.preview).toBe("Recent output line");
    expect(model.scopeLabel).toBe("Repo Task");
  });
});

describe("buildTaskWorkspaceHeaderModel", () => {
  it("builds task workspace header copy for an active task", () => {
    const model = buildTaskWorkspaceHeaderModel({
      desktopName: "Studio Mac",
      repoName: "kanna-tauri",
      task: {
        id: "task-9",
        repoId: "repo-1",
        title: "Tighten mobile workspace",
        stage: "pr",
        snippet: "Latest agent output"
      }
    });

    expect(model.repoLabel).toBe("kanna-tauri");
    expect(model.desktopLabel).toBe("Studio Mac");
    expect(model.stageLabel).toBe("pr");
    expect(model.snippetLabel).toContain("Latest agent output");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir apps/mobile test -- --runInBand taskPresentation`
Expected: FAIL because `taskPresentation.ts` does not exist yet

- [ ] **Step 3: Write the minimal implementation**

```ts
export function buildTaskListItemModel(task, repoName, isRecent) {
  return {
    repoLabel: repoName ?? task.repoId,
    stageLabel: task.stage ?? "unknown",
    preview: task.snippet?.trim() || "Latest desktop activity is available in the task detail view.",
    scopeLabel: isRecent ? "Recent Task" : "Repo Task"
  };
}
```

- [ ] **Step 4: Expand `taskWorkspace.ts` to expose richer header/context copy**

```ts
export function buildTaskWorkspaceHeaderModel({ desktopName, repoName, task }) {
  return {
    desktopLabel: desktopName ?? "Unknown desktop",
    repoLabel: repoName ?? task.repoId,
    stageLabel: task.stage ?? "unknown",
    snippetLabel: task.snippet?.trim() || "Live terminal output will appear here as the desktop daemon streams data."
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --dir apps/mobile test -- --runInBand taskPresentation taskWorkspace`
Expected: PASS

### Task 2: Rework task list surfaces for denser scanning

**Files:**
- Modify: `apps/mobile/src/components/TaskCard.tsx`
- Modify: `apps/mobile/src/components/TaskList.tsx`
- Modify: `apps/mobile/src/screens/TasksScreen.tsx`
- Modify: `apps/mobile/src/App.tsx`

- [ ] **Step 1: Thread repo-name and scope metadata into task lists**

```ts
<TaskList
  tasks={filteredTasks}
  repoNameById={repoNameById}
  isRecentView={heading === "Recent"}
  onOpenTask={onOpenTask}
/>
```

- [ ] **Step 2: Update `TaskCard` to use the presentation helper**

```ts
const model = buildTaskListItemModel(task, repoName, isRecentView);
```

- [ ] **Step 3: Replace the current loose card hierarchy with denser metadata**

```tsx
<Text style={styles.scopeLabel}>{model.scopeLabel}</Text>
<Text style={styles.title}>{task.title}</Text>
<Text style={styles.meta}>{model.repoLabel}</Text>
<Text numberOfLines={3} style={styles.preview}>{model.preview}</Text>
```

- [ ] **Step 4: Keep repo chips and list framing compact in `TasksScreen`**

```ts
const filteredTasks = selectedRepoId
  ? tasks.filter((task) => task.repoId === selectedRepoId)
  : tasks;
```

- [ ] **Step 5: Run verification**

Run: `pnpm --dir apps/mobile run typecheck && pnpm --dir apps/mobile test -- --runInBand`
Expected: PASS

### Task 3: Make the task screen feel like the primary workspace

**Files:**
- Modify: `apps/mobile/src/screens/TaskScreen.tsx`
- Modify: `apps/mobile/src/screens/taskWorkspace.ts`
- Modify: `apps/mobile/src/App.tsx`

- [ ] **Step 1: Build a tighter workspace header around the task context**

```tsx
<View style={styles.workspaceHeader}>
  <Text style={styles.workspaceEyebrow}>{header.desktopLabel}</Text>
  <Text style={styles.workspaceTitle}>{task.title}</Text>
  <Text style={styles.workspaceMeta}>{header.repoLabel}</Text>
</View>
```

- [ ] **Step 2: Make the terminal body dominant**

```tsx
<View style={styles.terminalShell}>
  <ScrollView style={styles.terminalViewport}>
    <Text style={styles.terminalLine}>{terminalText}</Text>
  </ScrollView>
  <TextInput ... />
</View>
```

- [ ] **Step 3: Keep active-task actions discoverable without leaving context**

```tsx
<Pressable style={styles.headerAction} onPress={onOpenMore}>
  <Text style={styles.headerActionLabel}>More</Text>
</Pressable>
```

- [ ] **Step 4: Preserve the selected task when opening More from the workspace**

```ts
if (selectedTask && state.activeView !== "more") {
  return <TaskScreen ... />;
}
```

- [ ] **Step 5: Run verification**

Run: `pnpm --dir apps/mobile run typecheck && pnpm --dir apps/mobile test -- --runInBand`
Expected: PASS

### Task 4: Strengthen More and the floating shell

**Files:**
- Modify: `apps/mobile/src/screens/MoreScreen.tsx`
- Modify: `apps/mobile/src/screens/moreCommands.ts`
- Modify: `apps/mobile/src/components/FloatingToolbar.tsx`
- Modify: `apps/mobile/src/screens/moreCommands.test.ts`

- [ ] **Step 1: Extend command metadata to distinguish global vs task-scoped actions**

```ts
sectionTitle: section.title,
sectionHeadline: section.headline
```

- [ ] **Step 2: Add a selected-task summary card at the top of `MoreScreen`**

```tsx
{selectedTask ? (
  <View style={styles.activeTaskCard}>
    <Text style={styles.commandLabel}>Selected Task</Text>
    <Text style={styles.commandValue}>{selectedTask.title}</Text>
  </View>
) : null}
```

- [ ] **Step 3: Tighten the floating toolbar layout and emphasis**

```tsx
<View style={styles.bar}>
  {tabs.map((tab) => (
    <Pressable ...>
      <Text ...>{tab.label}</Text>
    </Pressable>
  ))}
</View>
```

- [ ] **Step 4: Verify command filtering still works for task actions**

```ts
expect(buildMoreCommandPalette(..., "merge")).toEqual(
  expect.arrayContaining([expect.objectContaining({ id: "merge-agent" })])
);
```

- [ ] **Step 5: Run verification**

Run: `pnpm --dir apps/mobile run typecheck && pnpm --dir apps/mobile test -- --runInBand`
Expected: PASS
