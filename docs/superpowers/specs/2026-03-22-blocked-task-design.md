# Blocked Task Feature

## Problem

Sometimes a new task depends on a task that is currently in progress. There's no point starting it because it would have to be re-written on top of the blocker's code. We need a way to put a task into a blocked state, where it queues up and starts automatically once all its blockers leave `in_progress`.

## Overview

- New `blocked` pipeline stage for tasks waiting on other tasks
- New `task_blocker` junction table for many-to-many dependency tracking
- Two command palette commands: "Block Task" and "Edit Blocked Task"
- Auto-unblock logic triggers when any task leaves `in_progress`
- Blocked tasks have no worktree or agent until they unblock

**Dependency:** This feature targets the post-refactor codebase from branch `task-8a29c9c0` (Pinia store refactor). The orchestration logic lives in `stores/kanna.ts`.

## Data Model

### Stage type

Add `blocked` to the Stage union:

```typescript
type Stage = "in_progress" | "pr" | "merge" | "done" | "blocked";
```

### Transition matrix

One new transition:

- `blocked → in_progress` (automatic, when all blockers leave `in_progress`)

No transitions *into* `blocked` — tasks are created in that state.

### `task_blocker` table

```sql
CREATE TABLE IF NOT EXISTS task_blocker (
  blocked_item_id TEXT NOT NULL REFERENCES pipeline_item(id),
  blocker_item_id TEXT NOT NULL REFERENCES pipeline_item(id),
  PRIMARY KEY (blocked_item_id, blocker_item_id)
);
```

### DB query helpers (`packages/db`)

- `insertTaskBlocker(db, blockedItemId, blockerItemId)`
- `removeTaskBlocker(db, blockedItemId, blockerItemId)`
- `listBlockersForItem(db, blockedItemId)` → blocker PipelineItems
- `listBlockedByItem(db, blockerItemId)` → items blocked by this one
- `getUnblockedItems(db)` → items in `blocked` stage where ALL blockers are no longer `in_progress`

### TypeScript types (`packages/db`)

```typescript
interface TaskBlocker {
  blocked_item_id: string;
  blocker_item_id: string;
}
```

## "Block Task" Command

Triggered from command palette when selected task is `in_progress`.

1. User opens command palette, selects "Block Task"
2. Fuzzy search shows all other `in_progress` tasks (multi-select)
3. User selects one or more blockers, confirms
4. Close the current task via existing `closeTask()` logic (kill agent, teardown, remove worktree, set to `done`)
5. Insert a new `pipeline_item` with:
   - Same `prompt`, `repo_id`, `agent_type` as the closed task
   - `stage = 'blocked'`
   - No `branch`, `port_offset`, `port_env` (created on unblock)
   - `activity = 'idle'`
6. Insert `task_blocker` rows linking new item to each selected blocker
7. Select next available task in sidebar

## "Edit Blocked Task" Command

Triggered from command palette when selected task is `blocked`.

1. User opens command palette, selects "Edit Blocked Task"
2. Fuzzy search of `in_progress` tasks, with current blockers pre-selected
3. User adds/removes blockers, confirms
4. Diff selection against existing `task_blocker` rows — insert new, delete removed
5. Run `checkUnblocked()` on the task — if all blockers are now clear (including zero blockers), auto-start immediately

Removing all blockers is the manual unblock path — no separate "unblock" command needed.

## Auto-Unblock Logic

### Trigger

After every `updatePipelineItemStage` call that moves a task out of `in_progress`. This happens in three places in `stores/kanna.ts`:

- `makePR()` — `in_progress → pr`
- `mergeQueue()` — `in_progress → merge`
- `closeTask()` — `in_progress → done`

### `checkUnblocked(itemId)`

1. Query `listBlockedByItem(db, itemId)` — get all tasks blocked by the one that just transitioned
2. For each blocked task, query `listBlockersForItem(db, blockedItemId)`
3. Check if ALL blockers are no longer `in_progress` (stage is `pr`, `merge`, `done`, or `blocked`)
4. If yes, call `startBlockedTask(blockedItemId)`

### `startBlockedTask(blockedItemId)`

1. Look up the blocked item's `prompt`, `repo_id`, `agent_type`
2. Look up its blockers (for prompt context) — their display names and branch names
3. Augment the prompt:
   ```
   Note: this task was previously blocked by the following tasks which have now completed:
   - {display_name or first line of prompt} (branch: {branch})
   Their changes may be on branches that haven't merged to main yet.

   Original task:
   {original prompt}
   ```
4. Create a worktree (branched from repo root)
5. Assign a port_offset
6. Update the pipeline_item: set `branch`, `port_offset`, `port_env`, `stage = 'in_progress'`, `activity = 'working'`
7. Spawn the PTY agent

## Sidebar & UI

### Sidebar sections (top to bottom)

1. Pinned
2. Pull Requests (`stage = 'pr'`)
3. Merge Queue (`stage = 'merge'`)
4. In Progress (`stage = 'in_progress'`)
5. Blocked (`stage = 'blocked'`)

Blocked items show display name (or prompt snippet) plus small text: "Blocked by: {task name(s)}".

Sorted by creation time (oldest first).

### StageBadge

`blocked` — grey (`#666`, same family as `done`)

### Main panel for blocked tasks

No terminal view (no worktree/agent exists). Show a placeholder with:
- The task prompt
- List of blockers with status indicators for each

### Command palette visibility

- "Block Task" — visible when selected task is `in_progress`
- "Edit Blocked Task" — visible when selected task is `blocked`

## Files to Modify

All changes target the post-refactor branch (`task-8a29c9c0`).

| File | Changes |
|------|---------|
| `packages/core/src/pipeline/types.ts` | Add `blocked` to Stage, add `blocked → in_progress` transition |
| `packages/db/src/schema.ts` | Add `TaskBlocker` interface |
| `packages/db/src/queries.ts` | Add blocker CRUD + `getUnblockedItems()` |
| `apps/desktop/src/stores/db.ts` | Add `task_blocker` table migration |
| `apps/desktop/src/stores/kanna.ts` | `blockTask()`, `editBlockedTask()`, `checkUnblocked()`, `startBlockedTask()`, hook into `makePR`/`mergeQueue`/`closeTask` |
| `apps/desktop/src/components/Sidebar.vue` | Add "Blocked" section below "In Progress" |
| `apps/desktop/src/components/StageBadge.vue` | Add grey for `blocked` |
| `apps/desktop/src/components/CommandPalette.vue` | Add "Block Task" and "Edit Blocked Task" commands with fuzzy task search |
| `apps/desktop/src/components/MainPanel.vue` | Blocked task placeholder view |

## Edge Cases

- **Blocker abandoned (Cmd+Delete):** Still counts as unblocked. The agent prompt mentions the dependency so it can adapt.
- **All blockers removed via edit:** Zero dependencies = immediately unblocked → task auto-starts.
- **Multiple blocked tasks share a blocker:** Each is checked independently when the blocker transitions.
- **Blocked task during GC:** Blocked tasks should NOT be garbage collected (they're not `done`). No changes needed — GC only targets `stage = 'done'`.
- **App restart with blocked tasks:** On `init()`, run `checkUnblocked()` for all `blocked` items in case blockers transitioned while the app was closed.
