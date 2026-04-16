# Mobile UI Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current Tauri mobile relay prototype into a usable mobile client with a floating shell, `Tasks`/`Recent` surfaces, a terminal-first task screen, a `More` command sheet, and durable task-row snippets.

**Architecture:** Keep the existing `apps/mobile` Tauri app, but split its frontend into focused shell/list/detail components and typed view models instead of raw SQL results in `App.vue`. Persist a sanitized output preview in the shared desktop database so mobile can render stable task snippets without depending on live-only relay state.

**Tech Stack:** Vue 3, TypeScript, Tauri v2 mobile, Rust relay bridge, SQLite via shared schema/query helpers, Vitest + Vue Test Utils

---

## Scope Check

The approved design covers two coupled but still separable areas:

1. a usable mobile shell and task-browsing UI
2. remote execution for mutating task actions such as stage advance and merge-agent launch

This plan executes the first area completely and lays the UI/catalog structure for the second. The current mobile and `kanna-server` command surface is still read/terminal-oriented, so fully executing task mutation commands should be handled in a follow-on plan once the usable mobile shell lands.

## File Structure

- Modify: `apps/mobile/package.json` — add test tooling for the mobile app.
- Create: `apps/mobile/vitest.config.ts` — Vitest config for Vue/mobile tests.
- Create: `apps/mobile/src/test/setup.ts` — DOM/test setup shared by mobile component tests.
- Create: `apps/mobile/src/lib/mobile-types.ts` — typed mobile view models and tab/sheet state.
- Create: `apps/mobile/src/lib/task-list.ts` — grouping, sorting, stage labels, preview normalization, recent-task shaping.
- Create: `apps/mobile/src/lib/preview.ts` — terminal-output sanitization and “latest readable line” extraction.
- Create: `apps/mobile/src/lib/mobile-data.ts` — typed mobile data access over existing Tauri commands.
- Create: `apps/mobile/src/components/MobileHeader.vue` — top header with title/search/new-task actions.
- Create: `apps/mobile/src/components/FloatingToolbar.vue` — floating bottom toolbar for `Tasks`, `Recent`, `More`.
- Create: `apps/mobile/src/components/TaskRow.vue` — shared row primitive for grouped and recent lists.
- Create: `apps/mobile/src/components/RepoSection.vue` — repo-grouped section wrapper for the `Tasks` screen.
- Create: `apps/mobile/src/components/TasksScreen.vue` — grouped task list surface.
- Create: `apps/mobile/src/components/RecentScreen.vue` — pan-repo recent task list.
- Create: `apps/mobile/src/components/CommandPaletteSheet.vue` — mobile “More” sheet with global/task-aware command entries.
- Modify: `apps/mobile/src/components/TerminalView.vue` — reduce it to terminal rendering/input responsibilities.
- Create: `apps/mobile/src/components/TaskScreen.vue` — terminal-first task screen with minimal header.
- Modify: `apps/mobile/src/App.vue` — root shell orchestration, task selection, tab state, command sheet state.
- Modify: `packages/db/src/schema.ts` — add durable `last_output_preview` task field.
- Modify: `packages/db/src/queries.ts` — expose preview update helper if needed by desktop store/mobile shaping.
- Modify: `apps/desktop/src/stores/db.ts` — migrate the new preview column into the shared DB.
- Modify: `apps/desktop/src/stores/kanna.ts` — persist sanitized preview text from existing `terminal_output` listener.
- Test: `apps/mobile/src/lib/task-list.test.ts`
- Test: `apps/mobile/src/components/TasksScreen.test.ts`
- Test: `apps/mobile/src/components/RecentScreen.test.ts`
- Test: `apps/mobile/src/components/TaskScreen.test.ts`
- Test: `apps/mobile/src/components/CommandPaletteSheet.test.ts`

## Task 1: Add Mobile Test Harness And Shared Mobile Types

**Files:**
- Modify: `apps/mobile/package.json`
- Create: `apps/mobile/vitest.config.ts`
- Create: `apps/mobile/src/test/setup.ts`
- Create: `apps/mobile/src/lib/mobile-types.ts`

- [ ] **Step 1: Add the failing test harness configuration**

```json
{
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "@vue/test-utils": "^2.4.6",
    "jsdom": "^25.0.1",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Add Vitest config and setup files**

```ts
// apps/mobile/vitest.config.ts
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
```

```ts
// apps/mobile/src/test/setup.ts
import { afterEach } from "vitest";
import { cleanup } from "@vue/test-utils";

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 3: Add the shared mobile type layer**

```ts
// apps/mobile/src/lib/mobile-types.ts
export type MobileTab = "tasks" | "recent" | "more";

export interface MobileRepo {
  id: string;
  name: string;
  path: string;
}

export interface MobileTask {
  id: string;
  repo_id: string;
  title: string;
  repoName: string;
  stage: string;
  branch: string | null;
  displayName: string | null;
  prompt: string | null;
  prNumber: number | null;
  updatedAt: string | null;
  createdAt: string | null;
  lastOutputPreview: string;
}
```

- [ ] **Step 4: Run the empty test command to verify the harness boots**

Run: `pnpm --filter @kanna/mobile test`

Expected: Vitest starts successfully and reports no tests found yet.

- [ ] **Step 5: Commit the harness baseline**

```bash
git add apps/mobile/package.json apps/mobile/vitest.config.ts apps/mobile/src/test/setup.ts apps/mobile/src/lib/mobile-types.ts
git commit -m "test(mobile): add vitest harness for mobile UI work"
```

## Task 2: Persist A Durable Task Output Preview

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/queries.ts`
- Modify: `apps/desktop/src/stores/db.ts`
- Modify: `apps/desktop/src/stores/kanna.ts`
- Create: `apps/mobile/src/lib/preview.ts`

- [ ] **Step 1: Write the failing preview-normalization test**

```ts
// apps/mobile/src/lib/task-list.test.ts
import { describe, expect, it } from "vitest";
import { extractPreviewLine } from "./preview";

describe("extractPreviewLine", () => {
  it("returns the latest readable terminal line", () => {
    const bytes = new TextEncoder().encode("\u001b[32mPASS\u001b[0m\nUpdated mobile rows\n");
    expect(extractPreviewLine(bytes)).toBe("Updated mobile rows");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails for the right reason**

Run: `pnpm --filter @kanna/mobile test apps/mobile/src/lib/task-list.test.ts`

Expected: FAIL with `Cannot find module './preview'` or missing `extractPreviewLine`.

- [ ] **Step 3: Add the preview helper and DB field**

```ts
// apps/mobile/src/lib/preview.ts
export function extractPreviewLine(data: Uint8Array): string {
  const text = new TextDecoder().decode(data).replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.at(-1) ?? "";
}
```

```ts
// packages/db/src/schema.ts
export interface PipelineItem {
  // ...
  last_output_preview: string | null;
  // ...
}
```

```ts
// apps/desktop/src/stores/db.ts
await runMigration("011_pipeline_item_last_output_preview", async () => {
  await addColumn("pipeline_item", "last_output_preview", "TEXT");
});
```

- [ ] **Step 4: Persist previews from the desktop task runtime listener**

```ts
// packages/db/src/queries.ts
export async function updatePipelineItemLastOutputPreview(
  db: DbHandle,
  id: string,
  preview: string | null
): Promise<void> {
  await db.execute(
    "UPDATE pipeline_item SET last_output_preview = ?, updated_at = datetime('now') WHERE id = ?",
    [preview, id]
  );
}
```

```ts
// apps/desktop/src/stores/kanna.ts
listen("terminal_output", async (event: any) => {
  const payload = event.payload || event;
  const sessionId = payload.session_id;
  if (typeof sessionId !== "string") return;
  scheduleRuntimeStatusSync(sessionId);
  const bytes = Array.isArray(payload.data) ? new Uint8Array(payload.data) : null;
  if (!bytes) return;
  const preview = extractPreviewLine(bytes);
  if (preview) {
    await updatePipelineItemLastOutputPreview(_db, sessionId, preview);
    bump();
  }
});
```

- [ ] **Step 5: Re-run the preview test and targeted desktop typecheck**

Run: `pnpm --filter @kanna/mobile test apps/mobile/src/lib/task-list.test.ts`

Expected: PASS

Run: `pnpm exec tsc --noEmit`

Expected: PASS

- [ ] **Step 6: Commit the durable preview support**

```bash
git add packages/db/src/schema.ts packages/db/src/queries.ts apps/desktop/src/stores/db.ts apps/desktop/src/stores/kanna.ts apps/mobile/src/lib/preview.ts apps/mobile/src/lib/task-list.test.ts
git commit -m "feat: persist task output previews for mobile lists"
```

## Task 3: Build Typed Mobile Data Shaping For Tasks And Recent

**Files:**
- Create: `apps/mobile/src/lib/task-list.ts`
- Create: `apps/mobile/src/lib/mobile-data.ts`
- Test: `apps/mobile/src/lib/task-list.test.ts`

- [ ] **Step 1: Add failing tests for grouped and recent shaping**

```ts
import { describe, expect, it } from "vitest";
import { buildRecentTasks, groupTasksByRepo } from "./task-list";

describe("groupTasksByRepo", () => {
  it("keeps desktop ordering inside each repo", () => {
    const groups = groupTasksByRepo([
      { id: "a", repo_id: "r1", repoName: "Repo", title: "PR", stage: "pr", lastOutputPreview: "", branch: null, displayName: null, prompt: null, prNumber: null, updatedAt: "2026-04-16T10:00:00Z", createdAt: "2026-04-16T09:00:00Z" },
      { id: "b", repo_id: "r1", repoName: "Repo", title: "Merge", stage: "merge", lastOutputPreview: "", branch: null, displayName: null, prompt: null, prNumber: null, updatedAt: "2026-04-16T09:00:00Z", createdAt: "2026-04-16T08:00:00Z" },
    ]);
    expect(groups[0].tasks.map((task) => task.id)).toEqual(["b", "a"]);
  });
});

describe("buildRecentTasks", () => {
  it("sorts tasks across repos by updatedAt descending", () => {
    const tasks = buildRecentTasks([
      { id: "old", repo_id: "r1", repoName: "Repo 1", title: "Old", stage: "in progress", lastOutputPreview: "", branch: null, displayName: null, prompt: null, prNumber: null, updatedAt: "2026-04-16T09:00:00Z", createdAt: "2026-04-16T08:00:00Z" },
      { id: "new", repo_id: "r2", repoName: "Repo 2", title: "New", stage: "pr", lastOutputPreview: "", branch: null, displayName: null, prompt: null, prNumber: null, updatedAt: "2026-04-16T10:00:00Z", createdAt: "2026-04-16T08:30:00Z" },
    ]);
    expect(tasks.map((task) => task.id)).toEqual(["new", "old"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @kanna/mobile test apps/mobile/src/lib/task-list.test.ts`

Expected: FAIL with missing `groupTasksByRepo` / `buildRecentTasks`.

- [ ] **Step 3: Add typed mobile data loading and shaping**

```ts
// apps/mobile/src/lib/mobile-data.ts
import { invoke } from "@tauri-apps/api/core";
import type { MobileRepo, MobileTask } from "./mobile-types";

interface PipelineItemRow {
  id: string;
  repo_id: string;
  prompt: string | null;
  display_name: string | null;
  stage: string;
  branch: string | null;
  pr_number: number | null;
  created_at: string | null;
  updated_at: string | null;
  last_output_preview: string | null;
}

export async function loadMobileRepos(): Promise<MobileRepo[]> {
  return invoke<MobileRepo[]>("list_repos");
}

export async function loadMobileTasks(repoId: string, repoName: string): Promise<MobileTask[]> {
  const rows = await invoke<PipelineItemRow[]>("list_pipeline_items", { repoId });
  return rows
    .filter((row) => row.stage !== "done")
    .map((row) => ({
      id: row.id,
      repo_id: row.repo_id,
      title: row.display_name || row.prompt || row.id.slice(0, 8),
      repoName,
      stage: row.stage,
      branch: row.branch,
      displayName: row.display_name,
      prompt: row.prompt,
      prNumber: row.pr_number,
      updatedAt: row.updated_at,
      createdAt: row.created_at,
      lastOutputPreview: row.last_output_preview || "",
    }));
}
```

```ts
// apps/mobile/src/lib/task-list.ts
import type { MobileTask } from "./mobile-types";

const stageRank: Record<string, number> = { merge: 0, pr: 1, "in progress": 2, blocked: 3 };

export function groupTasksByRepo(tasks: MobileTask[]) {
  const byRepo = new Map<string, { repoName: string; tasks: MobileTask[] }>();
  for (const task of tasks) {
    const group = byRepo.get(task.repo_id) ?? { repoName: task.repoName, tasks: [] };
    group.tasks.push(task);
    byRepo.set(task.repo_id, group);
  }
  return [...byRepo.entries()].map(([repoId, group]) => ({
    repoId,
    repoName: group.repoName,
    tasks: [...group.tasks].sort((a, b) => (stageRank[a.stage] ?? 9) - (stageRank[b.stage] ?? 9)),
  }));
}

export function buildRecentTasks(tasks: MobileTask[]): MobileTask[] {
  return [...tasks].sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));
}
```

- [ ] **Step 4: Re-run the shaping tests**

Run: `pnpm --filter @kanna/mobile test apps/mobile/src/lib/task-list.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the typed mobile data layer**

```bash
git add apps/mobile/src/lib/mobile-data.ts apps/mobile/src/lib/task-list.ts apps/mobile/src/lib/task-list.test.ts
git commit -m "feat(mobile): add typed task shaping for grouped and recent views"
```

## Task 4: Build The Floating Shell, Tasks Screen, And Recent Screen

**Files:**
- Create: `apps/mobile/src/components/MobileHeader.vue`
- Create: `apps/mobile/src/components/FloatingToolbar.vue`
- Create: `apps/mobile/src/components/TaskRow.vue`
- Create: `apps/mobile/src/components/RepoSection.vue`
- Create: `apps/mobile/src/components/TasksScreen.vue`
- Create: `apps/mobile/src/components/RecentScreen.vue`
- Modify: `apps/mobile/src/App.vue`
- Test: `apps/mobile/src/components/TasksScreen.test.ts`
- Test: `apps/mobile/src/components/RecentScreen.test.ts`

- [ ] **Step 1: Write failing UI tests for grouped tasks and recent lists**

```ts
// apps/mobile/src/components/TasksScreen.test.ts
import { mount } from "@vue/test-utils";
import TasksScreen from "./TasksScreen.vue";

it("renders repo sections with stage and preview text", () => {
  const wrapper = mount(TasksScreen, {
    props: {
      groups: [{ repoId: "r1", repoName: "Kanna", tasks: [{ id: "t1", title: "Mobile UI", stage: "in progress", lastOutputPreview: "Updated rows", repoName: "Kanna" }] }],
    },
  });
  expect(wrapper.text()).toContain("Kanna");
  expect(wrapper.text()).toContain("in progress");
  expect(wrapper.text()).toContain("Updated rows");
});
```

```ts
// apps/mobile/src/components/RecentScreen.test.ts
import { mount } from "@vue/test-utils";
import RecentScreen from "./RecentScreen.vue";

it("renders cross-repo recent rows with repo context", () => {
  const wrapper = mount(RecentScreen, {
    props: {
      tasks: [{ id: "t1", title: "Mobile UI", stage: "pr", repoName: "Kanna", lastOutputPreview: "Opened PR" }],
    },
  });
  expect(wrapper.text()).toContain("Kanna");
  expect(wrapper.text()).toContain("Opened PR");
});
```

- [ ] **Step 2: Run the screen tests to verify they fail**

Run: `pnpm --filter @kanna/mobile test apps/mobile/src/components/TasksScreen.test.ts apps/mobile/src/components/RecentScreen.test.ts`

Expected: FAIL with missing components.

- [ ] **Step 3: Add the shell/list components and refactor `App.vue`**

```vue
<!-- apps/mobile/src/components/FloatingToolbar.vue -->
<script setup lang="ts">
import type { MobileTab } from "../lib/mobile-types";
defineProps<{ currentTab: MobileTab }>();
defineEmits<{ select: [tab: MobileTab] }>();
</script>

<template>
  <nav class="toolbar">
    <button @click="$emit('select', 'tasks')">Tasks</button>
    <button @click="$emit('select', 'recent')">Recent</button>
    <button @click="$emit('select', 'more')">More</button>
  </nav>
</template>
```

```vue
<!-- apps/mobile/src/App.vue -->
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { MobileRepo, MobileTab, MobileTask } from "./lib/mobile-types";
import { buildRecentTasks, groupTasksByRepo } from "./lib/task-list";
import { loadMobileRepos, loadMobileTasks } from "./lib/mobile-data";
import TasksScreen from "./components/TasksScreen.vue";
import RecentScreen from "./components/RecentScreen.vue";
import FloatingToolbar from "./components/FloatingToolbar.vue";

const currentTab = ref<MobileTab>("tasks");
const repos = ref<MobileRepo[]>([]);
const tasks = ref<MobileTask[]>([]);

const taskGroups = computed(() => groupTasksByRepo(tasks.value));
const recentTasks = computed(() => buildRecentTasks(tasks.value));

async function refreshData() {
  repos.value = await loadMobileRepos();
  tasks.value = (await Promise.all(repos.value.map((repo) => loadMobileTasks(repo.id, repo.name)))).flat();
}

onMounted(refreshData);
</script>
```

- [ ] **Step 4: Re-run the screen tests**

Run: `pnpm --filter @kanna/mobile test apps/mobile/src/components/TasksScreen.test.ts apps/mobile/src/components/RecentScreen.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the mobile shell and list surfaces**

```bash
git add apps/mobile/src/App.vue apps/mobile/src/components/MobileHeader.vue apps/mobile/src/components/FloatingToolbar.vue apps/mobile/src/components/TaskRow.vue apps/mobile/src/components/RepoSection.vue apps/mobile/src/components/TasksScreen.vue apps/mobile/src/components/RecentScreen.vue apps/mobile/src/components/TasksScreen.test.ts apps/mobile/src/components/RecentScreen.test.ts
git commit -m "feat(mobile): add shell with tasks and recent tabs"
```

## Task 5: Build The Terminal-First Task Screen

**Files:**
- Create: `apps/mobile/src/components/TaskScreen.vue`
- Modify: `apps/mobile/src/components/TerminalView.vue`
- Modify: `apps/mobile/src/App.vue`
- Test: `apps/mobile/src/components/TaskScreen.test.ts`

- [ ] **Step 1: Write the failing task-screen test**

```ts
import { mount } from "@vue/test-utils";
import TaskScreen from "./TaskScreen.vue";

it("shows repo name and stage in a minimal header above the terminal", () => {
  const wrapper = mount(TaskScreen, {
    props: {
      task: { id: "t1", title: "Mobile UI", repoName: "Kanna", stage: "in progress", lastOutputPreview: "" },
    },
    global: {
      stubs: { TerminalView: { template: "<div>terminal</div>" } },
    },
  });
  expect(wrapper.text()).toContain("Mobile UI");
  expect(wrapper.text()).toContain("Kanna");
  expect(wrapper.text()).toContain("in progress");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kanna/mobile test apps/mobile/src/components/TaskScreen.test.ts`

Expected: FAIL with missing `TaskScreen.vue`.

- [ ] **Step 3: Add the task screen and simplify terminal responsibilities**

```vue
<!-- apps/mobile/src/components/TaskScreen.vue -->
<script setup lang="ts">
import type { MobileTask } from "../lib/mobile-types";
import TerminalView from "./TerminalView.vue";

defineProps<{ task: MobileTask }>();
defineEmits<{ back: [] }>();
</script>

<template>
  <section class="task-screen">
    <header class="task-header">
      <button @click="$emit('back')">Back</button>
      <div class="task-heading">
        <h1>{{ task.title }}</h1>
        <p>{{ task.repoName }} · {{ task.stage }}</p>
      </div>
    </header>
    <TerminalView :task="task" />
  </section>
</template>
```

```vue
<!-- apps/mobile/src/components/TerminalView.vue -->
<script setup lang="ts">
import type { MobileTask } from "../lib/mobile-types";
defineProps<{ task: MobileTask }>();
</script>
```

- [ ] **Step 4: Re-run the task-screen test**

Run: `pnpm --filter @kanna/mobile test apps/mobile/src/components/TaskScreen.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the terminal-first task screen**

```bash
git add apps/mobile/src/components/TaskScreen.vue apps/mobile/src/components/TerminalView.vue apps/mobile/src/App.vue apps/mobile/src/components/TaskScreen.test.ts
git commit -m "feat(mobile): add terminal-first task screen"
```

## Task 6: Add The `More` Command Sheet And Context Model

**Files:**
- Create: `apps/mobile/src/components/CommandPaletteSheet.vue`
- Modify: `apps/mobile/src/lib/mobile-types.ts`
- Modify: `apps/mobile/src/App.vue`
- Test: `apps/mobile/src/components/CommandPaletteSheet.test.ts`

- [ ] **Step 1: Write the failing command-sheet tests**

```ts
import { mount } from "@vue/test-utils";
import CommandPaletteSheet from "./CommandPaletteSheet.vue";

it("shows global commands when no task is selected", () => {
  const wrapper = mount(CommandPaletteSheet, {
    props: { visible: true, commands: [{ id: "new-task", label: "New Task" }] },
  });
  expect(wrapper.text()).toContain("New Task");
});

it("shows task-aware commands when a task is open", () => {
  const wrapper = mount(CommandPaletteSheet, {
    props: { visible: true, commands: [{ id: "advance-stage", label: "Promote Stage" }] },
  });
  expect(wrapper.text()).toContain("Promote Stage");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kanna/mobile test apps/mobile/src/components/CommandPaletteSheet.test.ts`

Expected: FAIL with missing `CommandPaletteSheet.vue`.

- [ ] **Step 3: Add the command sheet and root command catalog**

```ts
// apps/mobile/src/lib/mobile-types.ts
export interface MobileCommand {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
}
```

```vue
<!-- apps/mobile/src/components/CommandPaletteSheet.vue -->
<script setup lang="ts">
import type { MobileCommand } from "../lib/mobile-types";
defineProps<{ visible: boolean; commands: MobileCommand[] }>();
defineEmits<{ close: []; execute: [commandId: string] }>();
</script>

<template>
  <div v-if="visible" class="sheet">
    <button v-for="command in commands" :key="command.id" :disabled="command.disabled" @click="$emit('execute', command.id)">
      {{ command.label }}
    </button>
  </div>
</template>
```

```ts
// apps/mobile/src/App.vue
const currentCommands = computed(() =>
  selectedTask.value
    ? [
        { id: "promote-stage", label: "Promote Stage", disabled: true },
        { id: "run-merge-agent", label: "Run Merge Agent", disabled: true },
        { id: "close-task", label: "Close Task", disabled: true },
      ]
    : [
        { id: "new-task", label: "New Task", disabled: true },
        { id: "search", label: "Search", disabled: false },
        { id: "preferences", label: "Preferences", disabled: true },
      ]
);
```

- [ ] **Step 4: Re-run the command-sheet tests**

Run: `pnpm --filter @kanna/mobile test apps/mobile/src/components/CommandPaletteSheet.test.ts`

Expected: PASS

- [ ] **Step 5: Run the mobile test suite and TypeScript verification**

Run: `pnpm --filter @kanna/mobile test`

Expected: PASS

Run: `pnpm exec tsc --noEmit`

Expected: PASS

- [ ] **Step 6: Commit the `More` action surface**

```bash
git add apps/mobile/src/components/CommandPaletteSheet.vue apps/mobile/src/lib/mobile-types.ts apps/mobile/src/App.vue apps/mobile/src/components/CommandPaletteSheet.test.ts
git commit -m "feat(mobile): add command sheet for global and task-aware actions"
```

## Self-Review

- **Spec coverage:** This plan covers the floating shell, `Tasks`, `Recent`, terminal-first task screen, stage visibility, durable output snippets, and the `More` command-sheet surface. The remaining spec gap is full remote execution for task mutation commands such as stage advance and merge-agent launch; that requires new mobile/server mutation APIs and should be planned separately.
- **Placeholder scan:** No `TODO`/`TBD` placeholders remain. Disabled command entries are deliberate scope markers for the UI phase, not implementation vagueness.
- **Type consistency:** `MobileTask`, `MobileTab`, and `MobileCommand` are defined once in `mobile-types.ts` and reused by list/detail/sheet components.
