# Terminal Sidecar Status Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw PTY chunk status scanning with `TerminalSidecar`-driven rendered-screen status detection and keep the existing `status_changed` UI contract.

**Architecture:** The daemon will derive task status from the live Ghostty sidecar after each mirrored PTY write, update the session record on transitions, and replay that status to late attachers. The raw scanner module and periodic flush thread will be removed so live status comes from one daemon-side terminal model.

**Tech Stack:** Rust, Tauri daemon event bridge, libghostty VT sidecar, cargo test, cargo clippy

---

### Task 1: Define Sidecar Footer Status API

**Files:**
- Modify: `crates/daemon/src/sidecar.rs`
- Test: `crates/daemon/src/sidecar.rs`

- [ ] **Step 1: Write the failing sidecar tests**

Add unit tests in `crates/daemon/src/sidecar.rs` that write Codex-like footer content into the sidecar and assert that a new footer extraction API returns normalized bottom-row text containing:

```rust
assert!(footer.contains("esc to interrupt"));
assert!(footer.contains("›"));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p kanna-daemon sidecar -- --nocapture`
Expected: FAIL because the footer extraction API does not exist yet

- [ ] **Step 3: Write minimal implementation**

Add a focused `TerminalSidecar` method that returns normalized visible footer text from the bottom few rendered rows, suitable for status detection. Keep it daemon-facing and avoid exposing raw internals.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p kanna-daemon sidecar -- --nocapture`
Expected: PASS for the new footer extraction coverage

### Task 2: Move Status Detection Into The Sidecar Path

**Files:**
- Modify: `crates/daemon/src/session.rs`
- Modify: `crates/daemon/src/main.rs`
- Modify: `crates/daemon/src/sidecar.rs`
- Delete: `crates/daemon/src/status.rs`
- Test: `crates/daemon/tests/status_scanner.rs` or replacement tests in daemon/sidecar suites

- [ ] **Step 1: Write the failing Codex regression test**

Add a focused test that models:

```rust
// Busy footer still visible even after later redraw chunks containing the prompt glyph.
// Expected: status remains Busy until the rendered footer no longer contains "esc to interrupt".
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p kanna-daemon codex -- --nocapture`
Expected: FAIL under the current raw scanner behavior

- [ ] **Step 3: Replace raw scanner wiring**

Remove the `StatusTracker` path and periodic idle flush thread from `crates/daemon/src/main.rs`. Derive provider status after `mgr.mirror_output(...)` using visible sidecar footer text and emit `StatusChanged` through the existing daemon event path only when the session status changes.

- [ ] **Step 4: Run targeted daemon tests**

Run: `cargo test -p kanna-daemon --test reconnect -- --nocapture`
Expected: PASS, including status replay behavior after attach

### Task 3: Keep Attach Replay Correct

**Files:**
- Modify: `crates/daemon/src/main.rs`
- Modify: `apps/desktop/src-tauri/src/commands/daemon.rs`
- Test: `crates/daemon/tests/reconnect.rs`

- [ ] **Step 1: Verify replay tests cover the new source of truth**

Ensure attach and attach-snapshot replay tests still assert the current daemon status is sent after the initial attach acknowledgment or snapshot.

- [ ] **Step 2: Run replay tests**

Run: `cargo test -p kanna-daemon --test reconnect -- --nocapture`
Expected: PASS with `StatusChanged` replay still intact

- [ ] **Step 3: Adjust code only if needed**

If sidecar-driven status changes any replay assumptions, update attach logic without altering the frontend event contract.

- [ ] **Step 4: Re-run replay tests**

Run: `cargo test -p kanna-daemon --test reconnect -- --nocapture`
Expected: PASS

### Task 4: Full Verification

**Files:**
- Modify: `Cargo.lock` only if dependency graph changes

- [ ] **Step 1: Format Rust code**

Run: `cargo fmt --all`
Expected: command succeeds with no output

- [ ] **Step 2: Run daemon status tests**

Run: `cargo test -p kanna-daemon -- --nocapture`
Expected: PASS for daemon unit and integration coverage touched by the change

- [ ] **Step 3: Run lint checks**

Run: `cargo clippy -p kanna-daemon -p kanna-desktop --tests -- -D warnings`
Expected: PASS with no warnings

- [ ] **Step 4: Smoke test in the worktree dev instance**

Run the existing worktree dev app, exercise a Codex task, and confirm the sidebar remains `working` while the visible footer still shows `esc to interrupt`, then returns to `idle` only after the busy footer disappears.
