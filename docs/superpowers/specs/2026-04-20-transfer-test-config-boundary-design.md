# Transfer Test Config Boundary Design

## Summary

Transfer-related desktop code currently treats `KANNA_TRANSFER_ROOT` as an implicit global input. That is acceptable at the runtime boundary, but it leaks into tests: one test mutates process-global env to simulate an alternate transfer root, while other tests read that same env indirectly through helper functions. Because Rust tests run in parallel by default, this creates order-dependent failures.

The design here is to keep env lookup at the outer production boundary and move all meaningful behavior behind explicit-input helpers. Tests will target those explicit helpers directly and will stop mutating process env.

## Goals

- Eliminate transfer test reliance on mutating process-global env.
- Preserve current production behavior for transfer root resolution.
- Make the transfer code path the reference pattern for env-dependent testability.
- Keep the change narrowly scoped to transfer root and transfer identity code.

## Non-Goals

- Refactoring every env-dependent test in the repository in this change.
- Changing the meaning of `KANNA_TRANSFER_ROOT` at runtime.
- Changing the transfer sidecar runtime contract beyond what the desktop app already passes.
- Reworking unrelated transfer runtime concepts such as registry layout, discovery mode, or peer identity format.

## Current Problem

Today [`apps/desktop/src-tauri/src/transfer_identity.rs`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-e4028c55/apps/desktop/src-tauri/src/transfer_identity.rs) resolves the transfer root by reading `KANNA_TRANSFER_ROOT` in `resolve_transfer_root(app_data_dir)`. That implicit lookup flows into `transfer_identity_path(app_data_dir)` and `load_or_create_transfer_identity(app_data_dir)`.

[`apps/desktop/src-tauri/src/transfer_sidecar.rs`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-e4028c55/apps/desktop/src-tauri/src/transfer_sidecar.rs) then builds the sidecar environment by calling those helpers, and one test in that file sets and unsets `KANNA_TRANSFER_ROOT` to verify instance-scoped behavior.

This test layout creates two problems:

- Tests that should be local to a temp directory become dependent on ambient process state.
- The suite becomes unsafe under parallel execution because one test changes a global value while another test is reading it.

## Design Principles

1. Read env once at the boundary.
2. Pass concrete paths through internal logic.
3. Test behavior through explicit parameters, not ambient globals.
4. Preserve existing runtime defaults and override semantics.

## Options Considered

### 1. Shared test lock around env access

Add a single global lock used by all transfer tests that read or write env.

Pros:

- Small patch.
- Minimal production code changes.

Cons:

- Tests still depend on global env.
- The pattern remains available for future misuse.
- Parallel safety depends on every test remembering to opt in.

### 2. Test helper that snapshots and restores env

Add a reusable helper that temporarily sets env inside a closure, then restores it.

Pros:

- Cleaner than ad hoc `setenv` and `unsetenv`.
- Potentially reusable outside transfer code.

Cons:

- Still uses mutable process-global state.
- Still wants serialization or careful coordination.
- Does not improve production/test boundaries.

### 3. Explicit configuration helpers with env-based wrappers

Introduce helpers that accept an explicit transfer root path and use env-reading wrappers only at production entry points.

Pros:

- Removes the root cause instead of coordinating around it.
- Preserves existing runtime behavior.
- Produces a clear pattern for other env-dependent code.
- Keeps tests deterministic and parallel-safe.

Cons:

- Slightly larger API surface inside the transfer modules.
- Requires touching both identity and sidecar builder code.

## Chosen Design

Implement option 3.

### Transfer Identity

Add explicit-root helpers in [`transfer_identity.rs`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-e4028c55/apps/desktop/src-tauri/src/transfer_identity.rs):

- a helper that resolves the default transfer root from `app_data_dir` plus an optional override path
- a helper that builds `identity.json` from an explicit transfer root
- a helper that loads or creates transfer identity from an explicit transfer root

The existing public flow remains:

- production code starts with `app_data_dir`
- env-based wrapper resolves the effective transfer root
- deeper logic works only with an explicit `&Path`

This means tests can call explicit-root helpers with a temp directory and avoid env entirely.

### Transfer Sidecar

Add an explicit-root helper in [`transfer_sidecar.rs`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-e4028c55/apps/desktop/src-tauri/src/transfer_sidecar.rs) for building sidecar env from:

- `app_data_dir`
- `transfer_root`
- `machine_name`

The production wrapper will still derive `transfer_root` using the current env-aware behavior, then call the explicit helper. The explicit helper will:

- populate `KANNA_TRANSFER_ROOT`
- derive the default `KANNA_TRANSFER_REGISTRY_DIR` as `<transfer_root>/registry`
- resolve transfer identity from that same explicit root

### Test Strategy

Replace transfer-root env mutation tests with explicit-root tests.

The new coverage should prove:

- transfer identity loads and persists correctly when given an explicit transfer root
- sidecar env derives `KANNA_TRANSFER_ROOT` and default registry dir from an explicit transfer root
- no test in this path needs `setenv`, `unsetenv`, or `std::env::set_var`

Existing tests that validate runtime defaults can continue using the env-free default path, as long as they do not mutate globals.

## Data Flow After Change

Production:

1. Desktop app resolves `app_data_dir`.
2. Desktop wrapper resolves effective transfer root from env override or default `app_data_dir/transfer`.
3. Wrapper calls explicit-root identity and sidecar-env helpers.
4. Sidecar receives `KANNA_TRANSFER_ROOT`, `KANNA_TRANSFER_REGISTRY_DIR`, `KANNA_TRANSFER_PEER_ID`, and `KANNA_TRANSFER_DISPLAY_NAME`.

Tests:

1. Test creates temp directory.
2. Test chooses explicit transfer root inside that temp directory.
3. Test calls explicit-root helper directly.
4. Assertions inspect files and env maps under that explicit path only.

## Error Handling

This change should preserve current error behavior:

- invalid or unreadable identity files still fail with the same path-specific errors
- missing identity files still create a new identity record
- explicit helpers should surface the concrete path they used so debugging remains straightforward

No new fallback behavior should be introduced.

## Risks

The main risk is accidentally creating two parallel code paths with slightly different semantics, where the env-based wrapper and explicit helper drift apart. To avoid that, the wrapper should be thin and should delegate all substantive behavior to the explicit helper.

Another risk is over-generalizing the abstraction. This change only needs explicit transfer-root handling, not a new generic configuration framework.

## Testing

Required verification after implementation:

- `cd apps/desktop/src-tauri && cargo test`

The success condition is that transfer-related tests pass under the default parallel test runner, without serializing the suite and without mutating process env in tests.

## Scope Boundary For Follow-Up Work

This change establishes the preferred pattern for env-dependent testability in transfer code. Follow-up refactors elsewhere in the repo should reuse the same shape:

- env lookup at the boundary
- explicit inputs underneath
- tests targeting explicit inputs
