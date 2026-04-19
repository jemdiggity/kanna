# Transfer Identity And Bonjour Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give LAN transfer a stable peer identity and human-facing machine label, and add the macOS bundle metadata required for Bonjour/local-network discovery.

**Architecture:** Add a small Tauri-side helper that persists a stable transfer identity record under app data and resolves a display label from nickname-or-machine-name fallback. `transfer_sidecar.rs` will use that helper to pass explicit `KANNA_TRANSFER_PEER_ID` and `KANNA_TRANSFER_DISPLAY_NAME` into the sidecar, while `Info.plist` will declare the Bonjour service type and local-network usage string for packaged macOS builds.

**Tech Stack:** Rust, Tauri v2, serde/serde_json, macOS bundle `Info.plist`, cargo tests

---

### Task 1: Add Failing Tests For Stable Transfer Identity

**Files:**
- Create: `apps/desktop/src-tauri/src/transfer_identity.rs`
- Test: `apps/desktop/src-tauri/src/transfer_identity.rs`

- [ ] **Step 1: Write the failing tests**

Add unit tests in `transfer_identity.rs` covering:

```rust
#[test]
fn loads_existing_transfer_identity_from_app_data() {}

#[test]
fn creates_and_persists_transfer_identity_when_missing() {}

#[test]
fn resolves_display_name_from_nickname_before_machine_name() {}

#[test]
fn resolves_display_name_from_machine_name_when_nickname_missing() {}

#[test]
fn falls_back_to_kanna_when_no_machine_name_is_available() {}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop/src-tauri && cargo test transfer_identity --lib`
Expected: FAIL because the helper module and tests do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement a focused helper that:

- stores a JSON record under app data, for example `transfer/identity.json`
- persists `peer_id` and optional `nickname`
- generates a new opaque `peer_id` when missing
- resolves `display_name` as `nickname -> machine_name -> "Kanna"`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop/src-tauri && cargo test transfer_identity --lib`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/transfer_identity.rs
git commit -m "Add stable transfer identity helper"
```

### Task 2: Wire Stable Identity Into Transfer Sidecar Spawn

**Files:**
- Modify: `apps/desktop/src-tauri/src/transfer_sidecar.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Test: `apps/desktop/src-tauri/src/transfer_sidecar.rs`

- [ ] **Step 1: Write the failing test**

Add a small focused test around env preparation, for example:

```rust
#[test]
fn transfer_sidecar_env_includes_stable_peer_id_and_display_name() {}
```

The test should assert that sidecar startup uses explicit values rather than relying on runtime defaults.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop/src-tauri && cargo test transfer_sidecar --lib`
Expected: FAIL because spawn currently only passes port and registry directory.

- [ ] **Step 3: Write minimal implementation**

Refactor sidecar spawn so it:

- resolves app data dir
- loads transfer identity
- resolves display name
- passes:
  - `KANNA_TRANSFER_PEER_ID`
  - `KANNA_TRANSFER_DISPLAY_NAME`
  - existing port and registry env vars

Keep process spawning behavior unchanged otherwise.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop/src-tauri && cargo test transfer_sidecar --lib`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/transfer_sidecar.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "Pass stable transfer identity to sidecar"
```

### Task 3: Add Bonjour And Local-Network Bundle Metadata

**Files:**
- Modify: `apps/desktop/src-tauri/Info.plist`

- [ ] **Step 1: Write the failing assertion**

Use a simple content assertion step rather than adding a new framework:

Run:

```bash
cd apps/desktop/src-tauri && rg -n "NSBonjourServices|NSLocalNetworkUsageDescription|_kanna-xfer._tcp" Info.plist
```

Expected: no matches for the Bonjour/local-network keys yet.

- [ ] **Step 2: Write minimal implementation**

Update `Info.plist` to include:

- `NSBonjourServices`
  - `_kanna-xfer._tcp`
- `NSLocalNetworkUsageDescription`
  - concise user-facing description for nearby machine discovery and transfer

- [ ] **Step 3: Run assertion to verify it passes**

Run:

```bash
cd apps/desktop/src-tauri && rg -n "NSBonjourServices|NSLocalNetworkUsageDescription|_kanna-xfer._tcp" Info.plist
```

Expected: all three matches are present.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/Info.plist
git commit -m "Add Bonjour metadata to macOS bundle"
```

### Task 4: Verify The Full Slice

**Files:**
- Modify: `apps/desktop/src-tauri/src/transfer_identity.rs`
- Modify: `apps/desktop/src-tauri/src/transfer_sidecar.rs`
- Modify: `apps/desktop/src-tauri/Info.plist`

- [ ] **Step 1: Run targeted Rust tests**

Run: `cd apps/desktop/src-tauri && cargo test transfer_identity transfer_sidecar --lib`
Expected: PASS

- [ ] **Step 2: Run desktop type and transfer regressions**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/kannaTransfer.test.ts`
Expected: PASS

- [ ] **Step 3: Run Rust formatting**

Run: `cd apps/desktop/src-tauri && cargo fmt --check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/transfer_identity.rs apps/desktop/src-tauri/src/transfer_sidecar.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/Info.plist
git commit -m "Stabilize transfer identity and Bonjour packaging"
```
