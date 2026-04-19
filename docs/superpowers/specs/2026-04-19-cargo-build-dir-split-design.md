# Cargo Build Dir Split Design

## Goal

Fix Kanna's Rust build layout so we stop duplicating multi-gigabyte intermediate build artifacts in every worktree while keeping final binaries private to each checkout.

## Problem

Today the repo uses `.cargo/config.toml` with `build.target-dir = ".build"`. That makes each worktree keep its own full Cargo output tree, including:

- final binaries
- dependency outputs in `deps/`
- incremental compilation state
- build-script output

This is correct for output isolation, but expensive in a Kanna workflow where many `.kanna-worktrees/...` checkouts exist at once. Individual `.build/` directories can grow to ~10GB, so disk usage scales with worktree count.

An attempted workaround exported a shared `CARGO_TARGET_DIR` for worktree dev sessions. That reduced duplicate intermediates, but it also made final executable paths contested across worktrees. That is unsafe for sidecar staging, daemon launch, and Tauri `externalBin` packaging because one worktree can observe another worktree's final binary.

## Desired Outcome

Use Cargo's built-in split between final artifacts and intermediate artifacts:

- keep `build.target-dir = ".build"` so each checkout owns its final binaries
- set `build.build-dir` to a single shared Kanna cache under `~/Library/Caches/kanna/rust-build`

This gives us:

- shared heavy intermediates across all Kanna worktrees
- private final outputs per checkout
- no contested final sidecar binaries
- much smaller per-worktree `.build/` directories

## Approach Options

### Option 1: Repo-wide Cargo split using `build.build-dir`

Checked-in Cargo config keeps the local `.build` target dir and adds a shared `build.build-dir` path under `~/Library/Caches/kanna/rust-build`.

Pros:

- uses Cargo's intended artifact model
- applies consistently to any Cargo invocation in the repo
- removes need for the shared `CARGO_TARGET_DIR` dev-session experiment
- lets sidecars build into normal local `.build` outputs again

Cons:

- requires auditing scripts/tests that assume all Cargo state lives under `.build`

### Option 2: Dev-only environment override

Keep checked-in config mostly unchanged and export `CARGO_BUILD_BUILD_DIR` only from `scripts/dev.sh`.

Pros:

- smaller initial patch
- limits behavior changes to dev sessions

Cons:

- manual Cargo runs still duplicate intermediates
- build behavior depends on using the right launcher
- less correct than a repo-wide source of truth

### Option 3: Keep per-worktree target dirs and add `sccache`

Treat compiler caching as the main reuse layer.

Pros:

- can improve Rust compile times

Cons:

- does not fix duplicated Cargo intermediate trees
- adds another moving part without fixing the layout problem
- not the architectural solution to Kanna's disk explosion

## Recommended Design

Use Option 1.

### Cargo configuration

Set the repo's default Cargo artifact layout to:

- `build.target-dir = ".build"`
- `build.build-dir = "/Users/$USER/Library/Caches/kanna/rust-build"` conceptually, but expressed using Cargo's home-relative path support so it stays user-local without hardcoding a username

The important behavior is:

- `.build/` remains checkout-local
- shared intermediate state moves out of worktrees and into `~/Library/Caches/kanna/rust-build`

### Dev workflow

Remove the worktree-only shared `CARGO_TARGET_DIR` export from `scripts/dev.sh`.

After this change:

- worktree desktop dev sessions use the repo default Cargo split
- the desktop app still gets per-worktree `.build` outputs
- shared compile reuse comes from Cargo's shared `build.build-dir`

### Sidecar build flow

Simplify the sidecar wrapper and staging flow to match the corrected Cargo model:

- `scripts/build-sidecars.sh` should stop forcing a separate private `CARGO_TARGET_DIR`
- sidecars should build into the checkout's normal `.build`
- `scripts/stage-sidecars.sh` should stage from the local `.build` path

This preserves correctness because final outputs remain private to the checkout even though intermediates are shared.

### Cleanup expectations

`scripts/clean.sh` should continue removing local `.build` from the current checkout. It should not blindly remove the shared `~/Library/Caches/kanna/rust-build` cache as part of normal local cleanup unless there is an explicit "clean shared cache" mode, because that cache is now intentionally shared across all Kanna worktrees.

### Compatibility notes

Anything that assumed `.build` contains Cargo intermediates like `deps/` or `incremental/` should be rechecked. After the split, `.build` should mainly contain final outputs and any files Cargo still associates with the target dir, while the heavyweight intermediate tree lives in the shared build-dir cache.

## Files Expected To Change

- `.cargo/config.toml`
- `scripts/dev.sh`
- `scripts/dev.sh.test.sh`
- `scripts/build-sidecars.sh`
- `scripts/build-sidecars.sh.test.sh`
- `scripts/stage-sidecars.sh`
- `scripts/stage-sidecars.sh.test.sh`
- `scripts/clean.sh`
- `scripts/clean.sh.test.sh`
- `apps/desktop/src/sidecars.test.ts`
- `AGENTS.md` if any guidance needs to be reconciled with the final architecture

## Testing Strategy

1. Script regression tests

- `scripts/dev.sh.test.sh` should assert we no longer export shared `CARGO_TARGET_DIR`
- add assertions for `CARGO_BUILD_BUILD_DIR` if we still use an env override anywhere
- sidecar tests should verify sidecars build into local `.build` and stage from there
- cleanup tests should keep local `.build` behavior correct and avoid deleting shared cache unintentionally

2. Desktop packaging contract

- `pnpm --dir apps/desktop test -- src/sidecars.test.ts`

3. TypeScript verification

- `pnpm --dir apps/desktop exec tsc --noEmit`

4. Runtime validation

- start a worktree dev session with `./scripts/dev.sh start`
- confirm the dev app launches successfully
- confirm local `.build` remains the source for final sidecar binaries
- confirm shared compile reuse works across worktrees by observing the shared cache path

## Risks

### Risk: Cargo path syntax for `build.build-dir`

Cargo config path semantics must be verified so the checked-in config resolves to the intended user-local cache path. If Cargo's config cannot express the desired `~/Library/Caches/...` path portably enough for this repo, fall back to exporting `CARGO_BUILD_BUILD_DIR` from launcher/setup paths, but keep that as an implementation constraint, not the target architecture.

### Risk: Scripts assuming old `.build` contents

Some scripts or tests may assume `.build` holds full Cargo intermediates. They must be updated to treat `.build` as local final-artifact storage rather than the complete Cargo cache.

### Risk: Shared cache cleanup

If normal cleanup removes the shared intermediate cache too eagerly, compile reuse disappears and users lose the intended disk/performance tradeoff. Shared-cache deletion should be explicit.

## Success Criteria

- per-worktree `.build` size drops substantially because heavy intermediates move to the shared cache
- worktrees no longer duplicate the full Rust intermediate tree
- final binaries remain private per checkout
- sidecar staging and daemon launch never read contested shared final outputs
- `./scripts/dev.sh start` still launches successfully in a worktree
