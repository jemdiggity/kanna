# `clean.sh` Bazel Output Cleanup Design

## Goal

Extend `./scripts/clean.sh` so the default cleanup path removes the Bazel local
output tree for the current workspace, alongside the existing Rust build
artifacts.

The cleanup must be safe for teardown usage from a single Kanna worktree. It
must only remove Bazel state owned by the current workspace and must not touch
shared caches used by other worktrees.

## Current State

`scripts/clean.sh` currently removes:

- `ROOT/.build`
- `ROOT/apps/desktop/src-tauri/target`

With `--all`, it additionally removes frontend artifacts such as `node_modules`,
`dist`, and `.turbo`.

The script does not currently remove any Bazel state, even though Bazel output
for one workspace lives outside the repo under:

- `~/Library/Caches/bazel/_bazel_$USER/<output-base-hash>`

Bazel derives `output_base` from the workspace path, so each Kanna worktree has
its own isolated local Bazel output tree.

## Requirements

### Functional

1. Running `./scripts/clean.sh` from a workspace removes that workspace's Bazel
   local output tree by default.
2. Running `./scripts/clean.sh --dry` shows the Bazel path and reclaimed size
   without deleting it.
3. The script must work from the repo root and from any Kanna worktree.
4. The cleanup target must be derived from the current workspace path, not from
   global scanning or heuristics.

### Safety

1. Do not remove `~/Library/Caches/bazel-disk-cache`.
2. Do not remove `~/Library/Caches/bazel-repository-cache`.
3. Do not remove shared Bazel directories such as
   `~/Library/Caches/bazel/_bazel_$USER/cache`.
4. Do not remove Bazel output bases for any workspace other than the current
   one.

## Proposed Approach

### Option A: `bazel clean --expunge`

Pros:

- Uses Bazel's built-in cleanup command.

Cons:

- Requires Bazel to be installed and runnable during teardown.
- Adds more failure modes to cleanup.
- Makes `--dry` behavior awkward.
- Slower and less predictable than deleting the known local output-base path.

### Option B: Delete the current workspace's Bazel output-base directory

Pros:

- Matches Bazel's actual storage model on disk.
- Removes the large local state directly: `execroot`, `bazel-out`, `external`,
  and per-workspace action metadata.
- Safe for teardown because it only targets the current workspace's hash.
- Works even if Bazel itself is unavailable.
- Fits naturally with the existing `remove()` helper and `--dry` mode.

Cons:

- Reimplements a small piece of Bazel's path derivation logic in shell.

### Recommendation

Use Option B.

The script should derive the current workspace's Bazel output-base hash from the
workspace path and then remove exactly that directory under
`~/Library/Caches/bazel/_bazel_$USER/`.

## Implementation Design

### Path derivation

Given the resolved workspace root `ROOT`, compute:

- Bazel user cache root:
  `"$HOME/Library/Caches/bazel/_bazel_${USER:-$(id -un)}"`
- Output-base hash:
  `printf %s "$ROOT" | md5`
- Workspace-local Bazel output-base:
  `"$bazel_user_root/$hash"`

This matches the observed output-base layout for this repo and its worktrees.

### Cleanup flow

Default cleanup will remove:

- `ROOT/.build`
- `ROOT/apps/desktop/src-tauri/target`
- current workspace Bazel output-base

`--all` remains additive and continues to remove frontend artifacts only.

### Failure handling

- If the Bazel output-base directory does not exist, treat it as a no-op.
- If `md5` is unavailable, fail with a clear error rather than guessing.
- If `USER` is unset, fall back to `id -un`.

## Testing

1. Add a shell test that creates a fake workspace-local Bazel output-base for a
   temporary workspace path and verifies default `clean.sh` removes it.
2. Verify `--dry` reports the Bazel output-base without removing it.
3. Verify shared cache directories are not targeted by the cleanup logic.

## Non-Goals

- Pruning stale Bazel output bases from other worktrees.
- Cleaning the shared disk cache.
- Cleaning the shared repository cache.
- Reducing Bazel's per-workspace materialization behavior.

Those are separate concerns from safe per-workspace teardown.
