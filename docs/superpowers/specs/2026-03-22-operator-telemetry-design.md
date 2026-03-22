# Operator Telemetry Design

**Date:** 2026-03-22
**Goal:** Capture and visualize how the human operator interacts with Kanna — task switching frequency, dwell time, response time to unread tasks, and overall focus discipline. If you can measure it, you can optimize it.

## Motivation

Kanna already tracks *agent* behavior well (activity_log records working/idle/unread transitions). What's missing is *operator* behavior — how the human uses the app. The sidebar is effectively an inbox; we want inbox-style metrics: how long do "emails" sit unread, how much time is spent reading each one, how often is the operator context-switching.

## Data Capture

### New table: `operator_event`

```sql
CREATE TABLE operator_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  pipeline_item_id TEXT,
  repo_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_operator_event_repo ON operator_event(repo_id, created_at);
```

### Event types

| Event | Trigger | pipeline_item_id |
|-------|---------|-----------------|
| `task_selected` | `selectItem()` in kanna store | the selected task |
| `app_blur` | window loses focus | NULL |
| `app_focus` | window regains focus | NULL |

### Emission points

- **`task_selected`** — single INSERT inside `selectItem()` in `kanna.ts`, the only place `selectedItemId` is set.
- **`app_blur` / `app_focus`** — new `useOperatorEvents` composable that listens to `document` `visibilitychange` (or `window` blur/focus). Inserts into `operator_event` on each transition.

App focus/blur events distinguish "operator left Kanna open and walked away" from "operator is actively dwelling on a task." Without this, dwell time inflates when they alt-tab.

## Derived Metrics

All metrics computed at query time in `useAnalytics`. No pre-aggregation — the raw event stream is the source of truth.

### Dwell Time

For each `task_selected` event, dwell = time until the next `task_selected` or `app_blur`, whichever comes first. App blur/focus gaps are excluded (not counted as dwell time on the previous task).

### Response Time

For each task that transitions to `activity = "unread"` (from `activity_log`), response time = time from the unread timestamp until the first `task_selected` event for that `pipeline_item_id` afterward. Tasks the operator never selects while unread (agent resumes before they look) are excluded.

### Context Switch Rate

Count of `task_selected` events where `pipeline_item_id` differs from the previous selection, divided by active hours (total time minus app blur gaps). Reselecting the same task does not count as a switch.

### Focus Score

Sum of dwells > 30s / total active dwell time. Ranges 0.0–1.0. A score of 0.8 means 80% of the operator's active time was in sustained focus blocks.

### Inbox Pressure (future)

Snapshot count of `pipeline_item` rows where `activity = "unread"` at each `task_selected` event. Tracks whether the operator stays on top of things or falls behind.

### Triage Speed (future)

When 2+ tasks are unread simultaneously, time from first selection to last unread cleared in that batch. Second-order metric to add once basics are working.

## UI

### New "Operator" view in AnalyticsModal

Third view in the existing spacebar carousel: Throughput → Activity Time → **Operator**.

`viewCount` goes from 2 → 3. `viewNames` adds `"Operator"`.

### Headline cards (4)

| Card | Example | Meaning |
|------|---------|---------|
| Avg Response Time | `3m 22s` | How long unread tasks wait before operator looks |
| Avg Dwell Time | `1m 45s` | How long they stay on each task |
| Switches/Hour | `12.4` | Context switch frequency during active time |
| Focus Score | `78%` | Ratio of deep-focus time to total active time |

### Chart

Horizontal stacked bar chart (matching Activity Time view style) showing the 20 most recent tasks:

- **Dwell time** (blue) — total active time the operator spent looking at this task
- **Response time** (amber) — how long it sat unread before they got to it

At-a-glance view of which tasks got attention quickly vs. which ones languished.

## Files Changed

| File | Change |
|------|--------|
| `apps/desktop/src/stores/db.ts` | Add migration: `CREATE TABLE operator_event` |
| `apps/desktop/src/stores/kanna.ts` | Insert `task_selected` event in `selectItem()` |
| `apps/desktop/src/composables/useOperatorEvents.ts` | **New.** Emit `app_blur`/`app_focus` events on visibility change |
| `apps/desktop/src/composables/useAnalytics.ts` | Add operator metric queries and computed properties |
| `apps/desktop/src/components/AnalyticsModal.vue` | Add third "Operator" view with headline cards + chart |
| `packages/db/src/schema.ts` | Add `OperatorEvent` interface |

## Non-goals

- No real-time indicators or session summaries outside the modal (keep scope tight)
- No pre-aggregated session tables (derive everything from the event stream)
- Inbox Pressure and Triage Speed are future work — noted in the spec but not implemented in this pass
