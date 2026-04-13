# Worktree-Scoped Task Config

## Problem

New tasks currently create their git worktrees from the intended source branch, but Kanna reads repo-level task runtime config from the root repository checkout at `repo.path/.kanna/config.json`.

That creates a snapshot mismatch:

- task code can come from `origin/main` or from a previous task branch
- repo-level `setup` and `teardown` commands come from the local main checkout

This means a task can execute setup or teardown commands that do not belong to the code snapshot the task is actually running.

## Goal

Make task runtime config come from the task worktree itself so task code and task config always come from the same checked-out snapshot.

## Non-Goals

- Changing how the base branch for worktree creation is chosen
- Redefining which values in `.kanna/config.json` are repo-scoped vs task-scoped outside the task lifecycle paths touched here
- Adding a fallback merge between root config and worktree config

## Proposed Change

Add a worktree-scoped config reader that loads `.kanna/config.json` from a specific worktree path.

Use that reader for task lifecycle operations that should follow the task snapshot:

- task bootstrap setup commands
- task teardown commands
- other task-session setup paths that currently infer runtime setup from `repo.path`

The behavior becomes:

- a new task created from `origin/main` uses the checked-out worktree's `.kanna/config.json`
- a stage-advance task created from another task branch uses that new worktree's `.kanna/config.json`
- teardown for a task uses the same task worktree's `.kanna/config.json`

## Design Details

### Config Resolution

Introduce a helper that accepts a filesystem path and reads:

`<path>/.kanna/config.json`

This helper should be usable for both repo-root paths and worktree paths, but task lifecycle code should pass the worktree path once it exists.

### Task Creation Flow

During task creation:

1. Create the worktree
2. Read `.kanna/config.json` from the new worktree
3. Use that config's `setup` commands and related runtime values for bootstrap

This preserves the existing architectural ownership:

- worktree creation still decides the git snapshot
- bootstrap still runs inside the worktree
- config resolution now matches that snapshot

### Task Teardown Flow

During task close:

1. Compute the task worktree path from the task branch
2. Read `.kanna/config.json` from that worktree
3. Use that config's `teardown` commands

If the worktree config is missing or unreadable, return an empty config and continue without failing task close.

### Error Handling

- Missing `.kanna/config.json` in a worktree remains non-fatal and resolves to an empty config
- Parse errors should continue to surface the same way current repo-config parsing errors do in the touched code paths
- Task teardown must remain resilient: inability to read config should not block close

## Testing

Add or update tests that verify:

- setup commands are loaded from the worktree path, not `repo.path`
- teardown commands are loaded from the task worktree path
- missing worktree config falls back to empty config without breaking task creation or close

## Risks

- Some existing flows may still intentionally read config from `repo.path`; changing those blindly could alter repo-level behavior outside task lifecycle
- If a task worktree has been manually removed before close, teardown config lookup will resolve empty and skip repo-level teardown; this is acceptable because snapshot consistency is the priority and close must stay robust

## Recommendation

Implement the smallest consistent change:

- keep a generic config reader by path
- switch task lifecycle runtime config reads to worktree paths
- leave unrelated repo-root config reads untouched unless they are proven to be task-snapshot-dependent
