# Ghostty Optimize Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure Kanna release builds vendor Ghostty in an optimized mode and fail verification if Ghostty is built in a debug-safe mode again.

**Architecture:** Patch Cargo resolution to use a repo-local override of `libghostty-rs`, then update `libghostty-vt-sys/build.rs` to pass an explicit Zig optimize mode for release builds. Add a release-mode regression test that queries `libghostty_vt::build_info::optimize_mode()` through Kanna's existing Rust crates.

**Tech Stack:** Cargo workspace patching, Rust build scripts, Zig vendor build, Rust tests

---

### Task 1: Add Workspace-Local Ghostty Override

**Files:**
- Create: `vendor/libghostty-rs/**`
- Modify: `Cargo.toml`

- [ ] Copy the pinned `libghostty-rs` checkout into `vendor/libghostty-rs`.
- [ ] Add a workspace `[patch."https://github.com/jemdiggity/libghostty-rs.git"]` entry pointing `libghostty-vt` and `libghostty-vt-sys` at the local vendor paths.
- [ ] Run `cargo metadata` or an equivalent targeted Cargo command to confirm the workspace resolves the local override.

### Task 2: Force Optimized Ghostty Release Builds

**Files:**
- Modify: `vendor/libghostty-rs/crates/libghostty-vt-sys/build.rs`

- [ ] Add a helper that reads Cargo's profile environment and selects a Zig optimize mode.
- [ ] Update the `zig build` invocation to pass `-Doptimize=ReleaseFast` for release builds.
- [ ] Keep debug/dev behavior unchanged unless the build script already needs an explicit debug mode for clarity.
- [ ] Re-run a targeted Cargo build to ensure the vendor build still succeeds.

### Task 3: Add Regression Coverage

**Files:**
- Create or modify a Rust test file in a crate that already links `libghostty-vt`

- [ ] Write a failing test that asserts release builds do not report `OptimizeMode::Debug` or `OptimizeMode::ReleaseSafe`.
- [ ] Run the targeted test in release mode and verify it fails before the build-script fix.
- [ ] Implement the minimal supporting code, if needed, to make the test pass.
- [ ] Re-run the targeted release test and confirm it passes.

### Task 4: Verify the End-to-End Change

**Files:**
- No additional code files required

- [ ] Run targeted Rust tests for the touched area.
- [ ] Run `cargo test --release` for the new regression test target.
- [ ] If practical, run a release build command for the sidecar crate(s) that link Ghostty to confirm the patched vendor build path works in release mode.
