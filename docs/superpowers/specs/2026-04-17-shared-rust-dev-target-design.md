# Shared Rust Dev Target Design

## Goal

Reduce duplicated Rust/Tauri dev build artifacts across Kanna worktrees by
sharing one repo-level Cargo target directory for the normal `./scripts/dev.sh`
workflow.

The experiment should target the largest current disk bucket without changing
release packaging or every manual Cargo workflow on day one.

## Current State

Rust dev builds currently write artifacts into a per-worktree `.build`
directory:

- checked-in `.cargo/config.toml` sets `target-dir = ".build"`
- `scripts/setup-worktree.sh` writes the same config into new worktrees
- `git_worktree_add` in the Tauri backend also writes `.cargo/config.toml`
  with `target-dir = ".build"`

That means every worktree that runs `./scripts/dev.sh` accumulates its own full
Rust artifact tree even when the backend code is nearly identical.

Measured disk usage on the current machine:

- total per-worktree `.build` usage: about `35.2G`
- total per-worktree `node_modules` usage: about `7.8G`
- shared Bazel caches: about `19.8G`
- live Bazel `output_base` directories: negligible at inspection time

The main storage problem is therefore repeated Tauri/Cargo dev artifacts, not
workspace-local Bazel output trees.

## Requirements

### Functional

1. Running `./scripts/dev.sh` from two worktrees of the same repo should point
   both Tauri dev sessions at the same Cargo target root.
2. Different repositories must not share the same Rust target directory.
3. Existing worktree isolation for database path, daemon directory, ports, and
   tmux session naming must remain unchanged.
4. Manual Cargo usage outside `./scripts/dev.sh` should remain unchanged for
   the first experiment.

### Safety

1. Release/Bazel packaging flows must remain separate from this shared dev
   target experiment.
2. The shared target path must be stable and deterministic for a repo.
3. The design must tolerate two worktrees building the backend concurrently.
4. Rollback must be one small change in `scripts/dev.sh`, not a large migration.

## Proposed Approaches

### Option A: Shared target dir only in `dev.sh`

Export `CARGO_TARGET_DIR` from `scripts/dev.sh` when running inside a Kanna
worktree so the Tauri dev process uses a shared repo-level Rust cache.

Pros:

- targets the actual storage problem directly
- low blast radius
- easy rollback
- preserves current behavior for manual Cargo commands

Cons:

- manual `cargo test` or `cargo run` from a worktree still use per-worktree
  `.build`
- shared-target reuse is limited to the standard dev workflow

### Option B: Shared target dir for all worktree Cargo usage

Change worktree `.cargo/config.toml` and related setup code so every Cargo
command in a worktree shares the same repo-level target directory.

Pros:

- maximum disk reduction
- one consistent Rust cache story across worktrees

Cons:

- larger behavior change
- higher risk of surprising users who expect isolated manual Cargo behavior
- harder rollback because both bootstrap and runtime paths change

### Option C: Keep per-worktree target dirs and prune aggressively

Preserve `.build` per worktree, but add cleanup or eviction for old build trees.

Pros:

- strongest worktree isolation
- smallest runtime behavior change

Cons:

- does not improve warm rebuild reuse between active worktrees
- saves less disk than sharing
- keeps paying repeated compile cost for nearly unchanged backend code

## Recommendation

Use Option A first.

This experiment attacks the main disk problem while keeping the behavior change
small and reversible. If the shared dev target works well, it can later be
extended to broader Cargo usage.

## Design

### Shared target boundary

Only the Tauri dev path launched by `./scripts/dev.sh` will use the shared Rust
target directory.

The following remain unchanged in this phase:

- checked-in `.cargo/config.toml`
- `scripts/setup-worktree.sh`
- Tauri backend worktree creation code that writes `.cargo/config.toml`
- manual Cargo commands run outside `./scripts/dev.sh`
- Bazel release graph and Bazel caches

### Target path derivation

`scripts/dev.sh` will derive a repo-level shared path from the actual
repository identity rather than the worktree path.

Recommended shape:

- `~/Library/Caches/kanna/rust-target/<repo-hash>/dev`

Where `<repo-hash>` is derived from the stable main repo path, not the worktree
path. Two worktrees from the same repo should therefore converge on the same
shared target directory, while different repos remain separated.

### Runtime flow

When `./scripts/dev.sh` starts a desktop dev session from a Kanna worktree:

1. detect that the current checkout is a worktree, as it does today
2. resolve a shared repo-level Rust target path
3. export `CARGO_TARGET_DIR` into the tmux-launched Tauri dev environment
4. leave all existing DB, daemon, and port isolation logic untouched

When `./scripts/dev.sh` runs from a non-worktree checkout, the first experiment
should leave current behavior unchanged unless the implementation naturally
reuses the same shared path without adding risk.

### Concurrency model

If two worktrees compile the backend at the same time, they share the same
Cargo target directory.

That does not mean two processes blindly overwrite one output file at once.
Cargo coordinates shared target-dir access with its build-directory locking and
freshness tracking. In practice:

- one build gets the target-dir lock first
- the other waits, then rechecks whether its units are still fresh
- if both worktrees are similar, much of the cache is reused
- if both changed the same backend crates, the second build will rebuild those
  units instead of keeping two isolated copies

This may introduce rebuild churn for rare backend-heavy parallel worktrees, but
that churn is preferable to keeping many multi-gigabyte duplicate `.build`
trees for mostly identical backend code.

### Rollback

Rollback is intentionally small:

- remove the `CARGO_TARGET_DIR` export from `scripts/dev.sh`
- existing per-worktree `.cargo/config.toml` behavior remains in place

No migration is required because the experiment only redirects the dev-session
environment.

## Testing

Add or update tests that verify:

1. `scripts/dev.sh` exports a shared `CARGO_TARGET_DIR` when run in a worktree.
2. Two worktrees from the same repo resolve the same shared target path.
3. Different repos resolve different shared target paths.
4. Existing tmux/env behavior in `scripts/dev.sh` still includes the expected
   DB name, DB path, and daemon dir.

## Non-Goals

- Changing manual Cargo behavior outside `./scripts/dev.sh`
- Rewriting `.cargo/config.toml` everywhere in this first experiment
- Solving duplicated `node_modules`
- Replacing Bazel release caching with Cargo/Tauri caching
- Guaranteeing zero rebuild churn between two backend-divergent worktrees
