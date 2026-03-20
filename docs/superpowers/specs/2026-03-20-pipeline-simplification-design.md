# Pipeline Simplification Design

## Summary

Replace the 5-stage pipeline (`queued`, `in_progress`, `needs_review`, `merged`, `closed`) with a 3-stage pipeline (`in_progress`, `pr`, `done`). Add a PR agent stage that spawns a haiku-model Claude session to rename the branch and create a GitHub PR via `gh`.

## Stages

| Stage | Type | Description |
|-------|------|-------------|
| `in_progress` | Interactive | Coding agent working, human reviewing. Same as today. |
| `pr` | Interactive | Haiku-model agent creates PR. User can interact if needed. Auto-advances to `done` on Stop hook. |
| `done` | Terminal | Task complete (PR created or abandoned). Ready for GC. |

## Transitions

```
in_progress → pr      (Cmd+S "Make PR")
in_progress → done    (Cmd+Delete, abandon)
pr → done             (automatic, Stop hook fires)
```

## PR Agent

**Trigger**: User presses Cmd+S on an `in_progress` task.

**Behavior**:
1. Transition task stage to `pr` in DB.
2. Spawn a new PTY session in the task's worktree via the daemon.
3. Claude CLI with `--model haiku` and hardcoded prompt:
   `Rename the branch to something reasonable based on the work done, push it, and create a GitHub PR using gh. You may need to exit your sandbox to use gh.`
4. Same hook infrastructure as the coding agent (Stop, StopFailure, PostToolUse, etc.).
5. Terminal is live and interactive — user can type into it if needed.
6. On Stop hook → auto-transition to `done`.

**Implementation**: New `startPrAgent(itemId)` function in `usePipeline.ts`. Reuses `spawnPtySession()` with different model and prompt args.

## Code Changes

### Modify

- **`packages/core/src/pipeline/types.ts`** — Replace `Stage` type with `"in_progress" | "pr" | "done"`. Simplify `VALID_TRANSITIONS` to 3 rules. Remove label references.
- **`packages/core/src/pipeline/transitions.ts`** — No logic changes, just works with new types.
- **`packages/core/src/pipeline/transitions.test.ts`** — Update tests for new stages.
- **`apps/desktop/src/composables/usePipeline.ts`** — Add `startPrAgent()`. Modify `spawnPtySession()` to accept model override.
- **`apps/desktop/src/composables/useKeyboardShortcuts.ts`** — Cmd+S calls `startPrAgent`. Remove Cmd+M handler.
- **`apps/desktop/src/components/StageBadge.vue`** — 3 stage variants.
- **`apps/desktop/src/components/ActionBar.vue`** — Remove merge button.
- **`apps/desktop/src/components/TaskHeader.vue`** — Update for new stages.
- **`apps/desktop/src/App.vue`** — DB migration mapping old stages to new. Update Stop hook handler to auto-transition `pr` → `done`. Update GC to trigger on `done`.

### Delete

- **`apps/desktop/src/composables/usePRWorkflow.ts`** — Entire composable (direct GitHub API PR creation/merge/close).
- **`packages/core/src/pr-workflow/`** — `workflow.ts`, `workflow.test.ts`.
- **`packages/core/src/github/client.ts`** — PR/merge API calls. Keep `types.ts` if useful.

### Keep (unchanged)

- `pr_number`, `pr_url` DB columns — avoid unnecessary migration. Not populated by Kanna but harmless.
- `KANNA_GITHUB_TOKEN` env var reference — may be useful later.

## DB Migration

Map existing rows:
- `queued` → `in_progress`
- `in_progress` → `in_progress` (no change)
- `needs_review` → `done`
- `merged` → `done`
- `closed` → `done`

## Hook Changes

The Stop hook handler in `App.vue` currently marks activity as `unread`. For tasks in `pr` stage, it should additionally auto-transition to `done`.

## Keyboard Shortcuts

| Shortcut | Before | After |
|----------|--------|-------|
| Cmd+S | `handleMakePR` (direct GitHub API) | `startPrAgent` (spawn haiku PTY) |
| Cmd+M | Merge PR | Removed |
| Cmd+Delete | Close task → `closed` | Abandon task → `done` |
