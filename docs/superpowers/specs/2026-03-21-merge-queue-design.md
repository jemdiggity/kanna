# Merge Queue Task Type

Add a merge queue task type that spawns a Claude agent to safely rebase, test, and merge pull requests sequentially without breaking the target branch.

## Motivation

After the PR agent creates a pull request, there is no in-app way to merge it. Users must leave Kanna and merge manually on GitHub. With multiple agents producing PRs concurrently, merging without testing against latest main risks breaking the target branch.

## Design

### New stage tag: `merge`

Add `"merge"` to the `Stage` union type. This is just a label for sidebar grouping — no transition rules enforced.

**Files:**
- `packages/core/src/pipeline/types.ts` — add `"merge"` to `Stage`, add transitions `in_progress → merge` and `merge → done`

### Badge

Purple badge labeled "Merge".

**Files:**
- `apps/desktop/src/components/StageBadge.vue` — add `merge: "#8b5cf6"` to `stageColors`, `merge: "Merge"` to `stageLabels`

### Sidebar section

New "Merge Queue" section between "Pull Requests" and "In Progress".

**Files:**
- `apps/desktop/src/components/Sidebar.vue` — add `sortedMerge()` filter (same pattern as `sortedPR()`), add draggable section with "Merge Queue" label

### `startMergeAgent()`

New function in `usePipeline.ts`. Creates a pipeline item with stage `"merge"`, branched off the repo root's current HEAD (no `baseBranch` option).

Agent prompt:

```
You are a merge agent. Your job is to safely merge pull requests without breaking the target branch.

## Process

1. Ask the user which PR(s) to merge and the target branch (default: main).

2. Your worktree is your staging area. Fetch and reset it to the latest origin target branch.

3. Determine what checks to run:
   a. Check .kanna/config.json for a configured test script.
   b. If none, discover what checks the repo has (CI config, test scripts, Makefile, etc.).
   c. If you can't determine what to run, ask the user.

4. For each PR, sequentially:
   a. Rebase the PR branch onto your worktree's HEAD.
   b. If there are conflicts, attempt to resolve them. Show the user your resolutions and get approval before continuing.
   c. Run the checks determined in step 3.
   d. If checks fail, attempt to fix the issue. Show the user your fix and get approval before continuing.
   e. If checks pass, merge the PR to the target branch on origin.
   f. Update your worktree HEAD to match the new origin target branch.
   g. Delete the merged remote branch.

5. Report results — which PRs merged, which failed, and why.

## Principles

- Each PR is merged individually. Don't hold passing PRs hostage to failing ones.
- Always rebase onto the latest target branch before running checks.
- Work in your worktree. Never modify the user's local main.
- When in doubt, ask the user. Don't force-push, skip tests, or resolve ambiguous conflicts silently.
- Keep the user informed of progress but don't be verbose.
```

**Files:**
- `apps/desktop/src/composables/usePipeline.ts` — add `startMergeAgent()`, export it

### Keyboard shortcut and command palette

`Shift+Cmd+M` triggers `startMergeAgent()`. Command palette auto-populates from the shortcuts array.

**Files:**
- `apps/desktop/src/composables/useKeyboardShortcuts.ts` — add `"mergeQueue"` to `ActionName`, add shortcut def `{ action: "mergeQueue", label: "Merge Queue", group: "Pipeline", key: ["M", "m"], meta: true, shift: true, display: "⇧⌘M" }`
- `apps/desktop/src/App.vue` — wire `mergeQueue` action to call `startMergeAgent()`

### Config: test scripts

The merge agent checks `.kanna/config.json` for a `test` field (array of shell commands, same shape as `setup`/`teardown`). If present, the agent runs those instead of auto-discovering checks.

**Files:**
- `packages/core/src/config/parser.ts` — add `test` field to `RepoConfig` type (if not already present)
- `.kanna/config.json` schema — document the new `test` field

## Summary of file changes

| File | Change |
|------|--------|
| `packages/core/src/pipeline/types.ts` | Add `"merge"` to Stage, add transitions |
| `apps/desktop/src/components/StageBadge.vue` | Add merge color + label |
| `apps/desktop/src/components/Sidebar.vue` | Add "Merge Queue" section |
| `apps/desktop/src/composables/usePipeline.ts` | Add `startMergeAgent()` |
| `apps/desktop/src/composables/useKeyboardShortcuts.ts` | Add `mergeQueue` action + shortcut |
| `apps/desktop/src/App.vue` | Wire `mergeQueue` action handler |
| `packages/core/src/config/parser.ts` | Add `test` field to config type |
