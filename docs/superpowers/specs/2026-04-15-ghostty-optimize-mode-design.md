# Ghostty Optimize Mode Design

## Goal

Ensure Kanna's vendored Ghostty terminal library is built in an optimized mode for release builds so packaged apps do not ship with Ghostty slow runtime safety checks enabled.

## Problem

Kanna vendors Ghostty through `libghostty-rs`, which builds the native library in `libghostty-vt-sys/build.rs` by invoking `zig build -Demit-lib-vt`. That invocation does not pass an explicit `-Doptimize` mode.

Ghostty's build config derives `slow_runtime_safety` from Zig optimize mode and enables expensive page integrity checks in `.Debug`. Runtime sampling of the installed app showed `Page.verifyIntegrity` and `DebugAllocator` on the hot path for both `kanna-daemon` and `kanna-terminal-recovery`, which strongly indicates the vendored Ghostty library was built in an unsafe default mode for the packaged app.

## Constraints

- The fix must live in the repository, not in `~/.cargo/git/checkouts`.
- Release builds must explicitly select an optimized Ghostty build mode.
- Dev/debug workflows should remain usable and predictable.
- The repo should gain a regression check so future dependency updates do not silently reintroduce a debug Ghostty build.

## Approach

Use a local workspace override for `libghostty-rs` and patch Cargo to resolve `libghostty-vt` and `libghostty-vt-sys` from that local copy.

Inside the local `libghostty-vt-sys/build.rs`, map Cargo profile to Zig optimize mode:

- Cargo debug/dev profiles: do not force a release optimize mode.
- Cargo release profile: pass `-Doptimize=ReleaseFast`.

Add a small release-mode regression test in Kanna that calls `libghostty_vt::build_info::optimize_mode()` and asserts release builds are not `Debug` or `ReleaseSafe`.

## Files

- Add local vendor override directory for `libghostty-rs`
- Modify workspace [`Cargo.toml`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-40f0260e/Cargo.toml)
- Modify vendored `libghostty-vt-sys/build.rs`
- Add release-mode regression test under the Rust crates already linked against Ghostty

## Verification

- Run the new regression test in debug mode as needed for coverage.
- Run the regression test in release mode and confirm `optimize_mode()` reports `ReleaseFast` or another optimized mode, but not `Debug` / `ReleaseSafe`.
- Run targeted existing tests for the touched Rust crates.
