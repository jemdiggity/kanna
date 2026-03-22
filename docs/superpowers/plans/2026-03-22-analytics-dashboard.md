# Analytics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers-extended-cc:subagent-driven-development (if subagents available) or superpowers-extended-cc:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a modal-based analytics dashboard showing task throughput and agent activity time for the active repo.

**Architecture:** New `activity_log` DB table tracks every activity state transition. `useAnalytics` composable queries pipeline_item + activity_log with adaptive time bucketing. `AnalyticsModal` renders two views (Throughput, Activity Time) via Chart.js, cycled with spacebar.

**Tech Stack:** Vue 3, Chart.js 4 + vue-chartjs 5, SQLite via @tauri-apps/plugin-sql

**Spec:** `docs/superpowers/specs/2026-03-22-analytics-dashboard-design.md`

---

### Task 0: Install Chart.js dependencies

**Files:**
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: Install chart.js and vue-chartjs**

Run: `cd apps/desktop && bun add chart.js@^4 vue-chartjs@^5`

- [ ] **Step 2: Verify installation**

Run: `cd apps/desktop && bun run build 2>&1 | head -5`
Expected: No import errors (build may fail for unrelated reasons, that's fine — we just need the packages resolvable)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/package.json bun.lock
git commit -m "feat(analytics): add chart.js and vue-chartjs dependencies"
```

---

### Task 1: Add activity_log table and wire logging into queries

**Files:**
- Modify: `apps/desktop/src/App.vue` (runMigrations function, ~line 346)
- Modify: `packages/db/src/queries.ts` (updatePipelineItemActivity, insertPipelineItem)
- Modify: `packages/db/src/schema.ts` (add ActivityLog interface)

- [ ] **Step 1: Add ActivityLog type to schema.ts**

Add to `packages/db/src/schema.ts`:

```typescript
export interface ActivityLog {
  id: number;
  pipeline_item_id: string;
  activity: "working" | "unread" | "idle";
  started_at: string;
}
```

- [ ] **Step 2: Add activity_log migration in App.vue's runMigrations()**

At the end of `runMigrations()` (after the existing `try/catch` blocks around line 412), add:

```typescript
// Activity log for analytics dashboard
await database.execute(`CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_item_id TEXT NOT NULL REFERENCES pipeline_item(id) ON DELETE CASCADE,
  activity TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
await database.execute(`CREATE INDEX IF NOT EXISTS idx_activity_log_item ON activity_log(pipeline_item_id)`);
```

No `try/catch` needed — `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` are idempotent.

- [ ] **Step 3: Add activity_log INSERT inside updatePipelineItemActivity**

In `packages/db/src/queries.ts`, modify `updatePipelineItemActivity` to also insert a log row:

```typescript
export async function updatePipelineItemActivity(
  db: DbHandle,
  id: string,
  activity: "working" | "unread" | "idle"
): Promise<void> {
  await db.execute(
    "UPDATE pipeline_item SET activity = ?, activity_changed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    [activity, id]
  );
  await db.execute(
    "INSERT INTO activity_log (pipeline_item_id, activity) VALUES (?, ?)",
    [id, activity]
  );
}
```

- [ ] **Step 4: Log initial activity in insertPipelineItem**

In `packages/db/src/queries.ts`, at the end of `insertPipelineItem`, after the existing INSERT, add:

```typescript
await db.execute(
  "INSERT INTO activity_log (pipeline_item_id, activity) VALUES (?, ?)",
  [item.id, item.activity ?? "idle"]
);
```

- [ ] **Step 5: Run existing tests**

Run: `cd packages/db && bun test`
Expected: All tests pass. The mock DB's `execute` handler silently ignores unknown INSERT statements (returns `{ rowsAffected: 1 }`), so the new `activity_log` INSERT calls will not cause failures. No mock changes needed.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/queries.ts apps/desktop/src/App.vue
git commit -m "feat(analytics): add activity_log table and wire logging into activity transitions"
```

---

### Task 2: Create useAnalytics composable

**Files:**
- Create: `apps/desktop/src/composables/useAnalytics.ts`

- [ ] **Step 1: Create the composable**

Create `apps/desktop/src/composables/useAnalytics.ts`:

```typescript
import { ref, computed, watch, type Ref } from "vue";
import type { DbHandle, PipelineItem, ActivityLog } from "@kanna/db";

interface ThroughputBucket {
  label: string;
  created: number;
  completed: number;
}

interface ActivityBreakdown {
  itemId: string;
  label: string;
  working: number;  // seconds
  idle: number;     // seconds
  unread: number;   // seconds
}

type BucketSize = "daily" | "weekly" | "monthly";

export function useAnalytics(db: Ref<DbHandle | null>, repoId: Ref<string | null>) {
  const throughputBuckets = ref<ThroughputBucket[]>([]);
  const activityBreakdowns = ref<ActivityBreakdown[]>([]);
  const bucketSize = ref<BucketSize>("daily");
  const hasData = ref(false);
  const loading = ref(false);

  const headlineStats = computed(() => {
    const totalCreated = throughputBuckets.value.reduce((sum, b) => sum + b.created, 0);
    const totalCompleted = throughputBuckets.value.reduce((sum, b) => sum + b.completed, 0);
    const completionRate = totalCreated > 1 ? Math.round((totalCompleted / totalCreated) * 100) : null;

    const totalWorking = activityBreakdowns.value.reduce((sum, b) => sum + b.working, 0);
    const totalIdle = activityBreakdowns.value.reduce((sum, b) => sum + b.idle, 0);
    const totalUnread = activityBreakdowns.value.reduce((sum, b) => sum + b.unread, 0);
    const count = activityBreakdowns.value.length || 1;

    return {
      tasksCreated: totalCreated,
      tasksCompleted: totalCompleted,
      completionRate,
      avgWorking: totalWorking / count,
      avgIdle: totalIdle / count,
      avgUnread: totalUnread / count,
    };
  });

  function detectBucketSize(minDate: string): BucketSize {
    const now = Date.now();
    const min = new Date(minDate + "Z").getTime();
    const days = (now - min) / 86400000;
    if (days < 14) return "daily";
    if (days < 90) return "weekly";
    return "monthly";
  }

  function bucketKey(dateStr: string, size: BucketSize): string {
    const d = new Date(dateStr + "Z");
    if (size === "daily") return d.toISOString().slice(0, 10);
    if (size === "weekly") {
      // ISO week: Monday-based, use the Monday of the week
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d);
      monday.setDate(diff);
      return monday.toISOString().slice(0, 10);
    }
    return d.toISOString().slice(0, 7); // YYYY-MM
  }

  function bucketLabel(key: string, size: BucketSize): string {
    if (size === "daily") {
      const d = new Date(key + "T00:00:00Z");
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }
    if (size === "weekly") {
      const d = new Date(key + "T00:00:00Z");
      return "W/" + d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }
    const d = new Date(key + "-01T00:00:00Z");
    return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  }

  async function refresh() {
    if (!db.value || !repoId.value) {
      hasData.value = false;
      throughputBuckets.value = [];
      activityBreakdowns.value = [];
      return;
    }
    loading.value = true;
    try {
      // --- Throughput ---
      const items = await db.value.select<PipelineItem>(
        "SELECT * FROM pipeline_item WHERE repo_id = ? ORDER BY created_at ASC",
        [repoId.value]
      );
      hasData.value = items.length > 0;
      if (!hasData.value) {
        throughputBuckets.value = [];
        activityBreakdowns.value = [];
        return;
      }

      const size = detectBucketSize(items[0].created_at);
      bucketSize.value = size;

      const bucketMap = new Map<string, { created: number; completed: number }>();
      for (const item of items) {
        const key = bucketKey(item.created_at, size);
        const entry = bucketMap.get(key) || { created: 0, completed: 0 };
        entry.created++;
        bucketMap.set(key, entry);
      }
      for (const item of items) {
        if (item.stage === "done") {
          const key = bucketKey(item.updated_at, size);
          const entry = bucketMap.get(key) || { created: 0, completed: 0 };
          entry.completed++;
          bucketMap.set(key, entry);
        }
      }
      const sortedKeys = [...bucketMap.keys()].sort();
      throughputBuckets.value = sortedKeys.map((key) => ({
        label: bucketLabel(key, size),
        created: bucketMap.get(key)!.created,
        completed: bucketMap.get(key)!.completed,
      }));

      // --- Activity Time ---
      const logs = await db.value.select<ActivityLog>(
        `SELECT al.* FROM activity_log al
         JOIN pipeline_item pi ON al.pipeline_item_id = pi.id
         WHERE pi.repo_id = ?
         ORDER BY al.pipeline_item_id, al.started_at ASC`,
        [repoId.value]
      );

      const itemMap = new Map<string, PipelineItem>();
      for (const item of items) itemMap.set(item.id, item);

      // Group logs by pipeline_item_id
      const grouped = new Map<string, ActivityLog[]>();
      for (const log of logs) {
        const arr = grouped.get(log.pipeline_item_id) || [];
        arr.push(log);
        grouped.set(log.pipeline_item_id, arr);
      }

      const nowIso = new Date().toISOString();
      const breakdowns: ActivityBreakdown[] = [];

      // Most recent 20 items that have logs
      const recentItems = items
        .filter((i) => grouped.has(i.id))
        .slice(-20);

      for (const item of recentItems) {
        const itemLogs = grouped.get(item.id)!;
        const totals = { working: 0, idle: 0, unread: 0 };
        for (let i = 0; i < itemLogs.length; i++) {
          const endTime = i + 1 < itemLogs.length
            ? itemLogs[i + 1].started_at
            : (item.stage === "done" ? item.updated_at : nowIso);
          const start = new Date(itemLogs[i].started_at + "Z").getTime();
          const end = new Date(endTime + "Z").getTime();
          const seconds = Math.max(0, (end - start) / 1000);
          const activity = itemLogs[i].activity as keyof typeof totals;
          if (activity in totals) totals[activity] += seconds;
        }
        breakdowns.push({
          itemId: item.id,
          label: item.display_name || item.issue_title || item.prompt?.slice(0, 30) || item.id.slice(0, 8),
          ...totals,
        });
      }
      activityBreakdowns.value = breakdowns;
    } catch (e) {
      console.error("[analytics] refresh failed:", e);
    } finally {
      loading.value = false;
    }
  }

  // Auto-refresh when repo changes
  watch([db, repoId], refresh, { immediate: true });

  return {
    throughputBuckets,
    activityBreakdowns,
    bucketSize,
    headlineStats,
    hasData,
    loading,
    refresh,
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/desktop && bun run build 2>&1 | tail -5`
Expected: No errors related to useAnalytics.ts

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/composables/useAnalytics.ts
git commit -m "feat(analytics): add useAnalytics composable with throughput and activity queries"
```

---

### Task 3: Create AnalyticsModal component

**Files:**
- Create: `apps/desktop/src/components/AnalyticsModal.vue`

- [ ] **Step 1: Create the modal component**

Create `apps/desktop/src/components/AnalyticsModal.vue`:

```vue
<script setup lang="ts">
import { ref, toRef } from "vue";
import { Bar } from "vue-chartjs";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import type { DbHandle } from "@kanna/db";
import { useAnalytics } from "../composables/useAnalytics";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const props = defineProps<{
  db: DbHandle | null;
  repoId: string | null;
}>();
const emit = defineEmits<{ (e: "close"): void }>();

const activeView = ref(0);
const viewCount = 2;
const viewNames = ["Throughput", "Activity Time"];

const {
  throughputBuckets,
  activityBreakdowns,
  headlineStats,
  hasData,
  loading,
} = useAnalytics(toRef(props, "db"), toRef(props, "repoId"));

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    emit("close");
  } else if (e.key === " ") {
    e.preventDefault();
    e.stopPropagation();
    activeView.value = (activeView.value + 1) % viewCount;
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: "#888" } },
  },
  scales: {
    x: { ticks: { color: "#888" }, grid: { color: "#333" } },
    y: { ticks: { color: "#888" }, grid: { color: "#333" }, beginAtZero: true },
  },
};

const horizontalChartOptions = {
  indexAxis: "y" as const,
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: "#888" } },
    tooltip: {
      callbacks: {
        label: (ctx: any) => `${ctx.dataset.label}: ${formatDuration(ctx.raw)}`,
      },
    },
  },
  scales: {
    x: { stacked: true, ticks: { color: "#888", callback: (v: any) => formatDuration(v) }, grid: { color: "#333" }, beginAtZero: true },
    y: { stacked: true, ticks: { color: "#ccc" }, grid: { color: "#333" } },
  },
};
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')" @keydown="handleKeydown" tabindex="0">
    <div class="analytics-modal">
      <div class="modal-header">
        <h2>{{ viewNames[activeView] }}</h2>
        <span class="hint">spacebar to switch &middot; esc to close</span>
      </div>

      <template v-if="loading">
        <div class="empty-state">Loading...</div>
      </template>

      <template v-else-if="!hasData">
        <div class="empty-state">No tasks yet</div>
      </template>

      <!-- View 0: Throughput -->
      <template v-else-if="activeView === 0">
        <div class="headline-cards">
          <div class="card">
            <div class="card-value">{{ headlineStats.tasksCreated }}</div>
            <div class="card-label">Created</div>
          </div>
          <div class="card">
            <div class="card-value">{{ headlineStats.tasksCompleted }}</div>
            <div class="card-label">Completed</div>
          </div>
          <div class="card">
            <div class="card-value">{{ headlineStats.completionRate != null ? headlineStats.completionRate + '%' : '—' }}</div>
            <div class="card-label">Completion Rate</div>
          </div>
        </div>
        <div class="chart-container">
          <Bar
            :data="{
              labels: throughputBuckets.map((b) => b.label),
              datasets: [
                { label: 'Created', data: throughputBuckets.map((b) => b.created), backgroundColor: '#0066cc' },
                { label: 'Completed', data: throughputBuckets.map((b) => b.completed), backgroundColor: '#2ea043' },
              ],
            }"
            :options="chartOptions"
          />
        </div>
      </template>

      <!-- View 1: Activity Time -->
      <template v-else-if="activeView === 1">
        <template v-if="activityBreakdowns.length === 0">
          <div class="empty-state">Activity tracking started — data will appear as agents run.</div>
        </template>
        <template v-else>
          <div class="headline-cards">
            <div class="card">
              <div class="card-value">{{ formatDuration(headlineStats.avgWorking) }}</div>
              <div class="card-label">Avg Working</div>
            </div>
            <div class="card">
              <div class="card-value">{{ formatDuration(headlineStats.avgIdle) }}</div>
              <div class="card-label">Avg Idle</div>
            </div>
            <div class="card">
              <div class="card-value">{{ formatDuration(headlineStats.avgUnread) }}</div>
              <div class="card-label">Avg Waiting</div>
            </div>
          </div>
          <div class="chart-container">
            <Bar
              :data="{
                labels: activityBreakdowns.map((b) => b.label),
                datasets: [
                  { label: 'Working', data: activityBreakdowns.map((b) => b.working), backgroundColor: '#0066cc' },
                  { label: 'Waiting', data: activityBreakdowns.map((b) => b.unread), backgroundColor: '#d29922' },
                  { label: 'Idle', data: activityBreakdowns.map((b) => b.idle), backgroundColor: '#555' },
                ],
              }"
              :options="horizontalChartOptions"
            />
          </div>
        </template>
      </template>

      <!-- Dot indicators -->
      <div class="dots">
        <span v-for="i in viewCount" :key="i" class="dot" :class="{ active: activeView === i - 1 }" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  outline: none;
}

.analytics-modal {
  background: #252525;
  border: 1px solid #444;
  border-radius: 8px;
  width: 720px;
  max-width: 90vw;
  max-height: 80vh;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.modal-header h2 {
  font-size: 16px;
  font-weight: 600;
  color: #ccc;
}

.hint {
  font-size: 11px;
  color: #666;
}

.headline-cards {
  display: flex;
  gap: 12px;
}

.card {
  flex: 1;
  background: #1e1e1e;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 12px;
  text-align: center;
}

.card-value {
  font-size: 24px;
  font-weight: 600;
  color: #ccc;
}

.card-label {
  font-size: 11px;
  color: #888;
  margin-top: 4px;
}

.chart-container {
  height: 300px;
  position: relative;
}

.empty-state {
  text-align: center;
  color: #666;
  padding: 48px 0;
  font-size: 14px;
}

.dots {
  display: flex;
  justify-content: center;
  gap: 6px;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #555;
}

.dot.active {
  background: #0066cc;
}
</style>
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/desktop && bun run build 2>&1 | tail -10`
Expected: No errors related to AnalyticsModal.vue

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/AnalyticsModal.vue
git commit -m "feat(analytics): add AnalyticsModal component with throughput and activity views"
```

---

### Task 4: Register keyboard shortcut and wire into App.vue

**Files:**
- Modify: `apps/desktop/src/composables/useKeyboardShortcuts.ts`
- Modify: `apps/desktop/src/App.vue`

- [ ] **Step 1: Add showAnalytics to ActionName and shortcuts array**

In `apps/desktop/src/composables/useKeyboardShortcuts.ts`:

Add `"showAnalytics"` to the `ActionName` type union (after `"commandPalette"`):

```typescript
export type ActionName =
  | "newTask"
  // ... existing entries ...
  | "commandPalette"
  | "showAnalytics";
```

Add to the `shortcuts` array (in the "Help" group, after `commandPalette`):

```typescript
{ action: "showAnalytics", label: "Analytics", group: "Help", key: ["A", "a"], meta: true, shift: true, display: "⇧⌘A" },
```

- [ ] **Step 2: Wire analytics modal into App.vue**

In `apps/desktop/src/App.vue`:

Add import (after the other component imports):
```typescript
import AnalyticsModal from "./components/AnalyticsModal.vue";
```

Add ref (after the other modal refs, around line 50):
```typescript
const showAnalyticsModal = ref(false);
```

Add action to `keyboardActions` object (after `commandPalette`):
```typescript
showAnalytics: () => { showAnalyticsModal.value = !showAnalyticsModal.value; },
```

Add to dismiss chain (in the `dismiss` function, before the shell modal check):
```typescript
if (showAnalyticsModal.value) { showAnalyticsModal.value = false; return; }
```

Add template (after the `FilePreviewModal` block, before `</div>`):
```vue
<AnalyticsModal
  v-if="showAnalyticsModal"
  :db="db"
  :repo-id="selectedRepoId"
  @close="showAnalyticsModal = false"
/>
```

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/desktop && bun run build 2>&1 | tail -10`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/composables/useKeyboardShortcuts.ts apps/desktop/src/App.vue
git commit -m "feat(analytics): register Cmd+Shift+A shortcut and wire AnalyticsModal into App.vue"
```

---

### Task 5: Manual smoke test

- [ ] **Step 1: Start dev server**

Run: `./scripts/dev.sh`

- [ ] **Step 2: Test the dashboard**

1. Open the app, select a repo with tasks
2. Press `Cmd+Shift+A` — analytics modal should open
3. Verify Throughput view shows headline stats and bar chart (may be empty if no historical data)
4. Press spacebar — should switch to Activity Time view
5. Press spacebar again — should cycle back to Throughput
6. Press Escape — modal should close
7. Create a new task, let the agent run briefly, then check Activity Time view — should show a log entry

- [ ] **Step 3: Test empty states**

1. Select a repo with no tasks — should show "No tasks yet"
2. Check Activity Time on a repo with no activity logs — should show "Activity tracking started" message

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(analytics): address smoke test findings"
```
