# Transfer Phase 1 Local Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a destination Kanna instance approve a same-machine incoming transfer and reconstruct a new local task/worktree/session from the transferred metadata.

**Architecture:** Persist the full incoming transfer payload in `task_transfer`, add destination-side approve/reject actions in the desktop store, and reuse the existing task bootstrap path to create a fresh local task from the source metadata. Keep source closure, trust, and LAN transport changes out of this slice.

**Tech Stack:** Vue 3, Pinia, TypeScript, Vitest, Tauri v2, SQLite query helpers, existing task-transfer sidecar/runtime

---

### Task 1: Persist Full Incoming Payloads

**Files:**
- Modify: `apps/desktop/src/utils/taskTransfer.ts`
- Modify: `apps/desktop/src/stores/db.ts`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/queries.ts`
- Test: `apps/desktop/src/stores/kannaTransfer.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that expect:
- `parseIncomingTransferRequest()` to require and retain a nested payload object.
- `recordIncomingTransfer()` to persist `payload_json`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/kannaTransfer.test.ts`
Expected: FAIL because the incoming request type and persistence path do not retain payload JSON yet.

- [ ] **Step 3: Add the minimal implementation**

Implement:
- `payload_json TEXT` migration on `task_transfer`
- `payload_json` on the DB schema/query types
- full incoming payload parsing in `taskTransfer.ts`
- `recordIncomingTransfer()` persistence of `payload_json`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/kannaTransfer.test.ts`
Expected: PASS for the new incoming-payload assertions

### Task 2: Add Destination Approve/Reject Import Actions

**Files:**
- Modify: `apps/desktop/src/stores/kanna.ts`
- Modify: `apps/desktop/src/utils/taskTransfer.ts`
- Modify: `packages/db/src/queries.ts`
- Modify: `packages/db/src/schema.ts`
- Test: `apps/desktop/src/stores/kannaTransfer.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that expect:
- approving a pending incoming transfer reuses or imports the repo by local path,
- approving creates a fresh local task and provenance row,
- approving marks the transfer completed with `local_task_id`,
- rejecting marks the transfer rejected,
- `createItem()` returns the new item id so approval can wire transfer provenance/status updates.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/kannaTransfer.test.ts`
Expected: FAIL because the store has no approval/rejection path yet.

- [ ] **Step 3: Add the minimal implementation**

Implement:
- richer outgoing repo payload (`path`, `name`, `default_branch`, `remote_url`)
- store helpers to parse persisted incoming payloads
- `approveIncomingTransfer(transferId)` and `rejectIncomingTransfer(transferId)`
- `createItem()` returning the created task id
- query helpers to read/update transfer rows and insert provenance

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/kannaTransfer.test.ts`
Expected: PASS

### Task 3: Wire The Incoming Modal To Real Approve/Reject Behavior

**Files:**
- Modify: `apps/desktop/src/App.vue`
- Modify: `apps/desktop/src/components/IncomingTransferModal.vue`
- Test: `apps/desktop/tests/e2e/real/local-transfer-first-milestone.test.ts`
- Create: `apps/desktop/tests/e2e/real/local-transfer-accept-import.test.ts`

- [ ] **Step 1: Write the failing E2E**

Add a new real two-instance test that:
- pushes a task from primary to secondary,
- approves the transfer on secondary,
- verifies a new imported task exists on secondary,
- verifies transfer status/provenance point at that imported task.

- [ ] **Step 2: Run the E2E to verify it fails**

Run: `pnpm exec tsx apps/desktop/tests/e2e/run.ts real/local-transfer-accept-import.test.ts`
Expected: FAIL because approve still only dismisses the modal.

- [ ] **Step 3: Add the minimal implementation**

Implement:
- App state for current incoming transfer id
- modal approve/reject handlers calling the store
- updated modal dismissal semantics for rejection

- [ ] **Step 4: Run the E2E to verify it passes**

Run: `pnpm exec tsx apps/desktop/tests/e2e/run.ts real/local-transfer-accept-import.test.ts`
Expected: PASS

### Task 4: Re-verify The Existing Milestone And Desktop TypeScript

**Files:**
- Verify only

- [ ] **Step 1: Re-run the first milestone E2E**

Run: `KANNA_E2E_SLOW_MODE_MS=300 pnpm exec tsx apps/desktop/tests/e2e/run.ts real/local-transfer-first-milestone.test.ts`
Expected: PASS

- [ ] **Step 2: Re-run the new accept/import E2E**

Run: `KANNA_E2E_SLOW_MODE_MS=300 pnpm exec tsx apps/desktop/tests/e2e/run.ts real/local-transfer-accept-import.test.ts`
Expected: PASS

- [ ] **Step 3: Run desktop TypeScript**

Run: `cd apps/desktop && pnpm exec tsc --noEmit`
Expected: PASS
