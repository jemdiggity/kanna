# Transfer Phase 2 Ownership Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the original source task only after the destination successfully imports it and sends an explicit commit acknowledgment back through the transfer runtime.

**Architecture:** Persist a source-side outgoing transfer row during commit, extend the transfer protocol/runtime with an `import_committed` acknowledgment, and let the source desktop store complete the outgoing transfer and close the source task through the normal close path. Keep reject/failure behavior fail-safe by never closing the source without a success acknowledgment.

**Tech Stack:** Vue 3, Pinia, TypeScript, Vitest, Tauri v2, Rust, SQLite query helpers, task-transfer sidecar/runtime

---

### Task 1: Add Source-Side Outgoing Transfer Persistence

**Files:**
- Modify: `apps/desktop/src/stores/kanna.ts`
- Modify: `packages/db/src/queries.ts`
- Modify: `packages/db/src/queries.test.ts`
- Test: `apps/desktop/src/stores/kannaTransfer.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that expect:

```ts
await store.pushTaskToPeer("task-source", "peer-target");
expect(await getTaskTransfer(db, "transfer-123")).toMatchObject({
  id: "transfer-123",
  direction: "outgoing",
  status: "pending",
  local_task_id: "task-source",
  source_task_id: "task-source",
  target_peer_id: "peer-target",
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/kannaTransfer.test.ts`
Expected: FAIL because `pushTaskToPeer()` does not persist an outgoing transfer row yet.

- [ ] **Step 3: Write the minimal implementation**

Implement source-side persistence during commit:

```ts
await insertTaskTransfer(_db, {
  id: preflight.transferId,
  direction: "outgoing",
  status: "pending",
  source_peer_id: preflight.sourcePeerId,
  target_peer_id: peerId,
  source_task_id: task.id,
  local_task_id: task.id,
  error: null,
  payload_json: JSON.stringify(payload),
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/kannaTransfer.test.ts`
Expected: PASS for the new outgoing-transfer assertions.

### Task 2: Add Commit Acknowledgment To The Transfer Protocol

**Files:**
- Modify: `crates/task-transfer/src/protocol.rs`
- Modify: `crates/task-transfer/src/runtime.rs`
- Modify: `crates/task-transfer/tests/protocol.rs`
- Modify: `crates/task-transfer/tests/runtime.rs`
- Modify: `apps/desktop/src-tauri/src/transfer_sidecar.rs`
- Modify: `apps/desktop/src-tauri/src/commands/transfer.rs`

- [ ] **Step 1: Write the failing Rust tests**

Add protocol/runtime tests that expect:

```rust
assert_roundtrip(PeerRequest::ImportCommitted {
    request_id: "ack-1".into(),
    transfer_id: "transfer-1".into(),
    source_task_id: "task-source".into(),
    destination_local_task_id: "task-dest".into(),
});
```

and:

```rust
let event = source_events.recv().await?;
assert_eq!(event.transfer_id, "transfer-1");
assert_eq!(event.source_task_id, "task-source");
assert_eq!(event.destination_local_task_id, "task-dest");
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p kanna-task-transfer --test protocol --test runtime`
Expected: FAIL because the protocol/runtime does not support import commit acknowledgments yet.

- [ ] **Step 3: Write the minimal implementation**

Add:

```rust
PeerRequest::ImportCommitted { ... }
SidecarEvent::OutgoingTransferCommitted { ... }
```

Wire destination import success to emit the peer request and wire source receipt to emit the sidecar event up to Tauri.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p kanna-task-transfer --test protocol --test runtime`
Expected: PASS.

### Task 3: Finalize Source Transfers On Commit Acknowledgment

**Files:**
- Modify: `apps/desktop/src/App.vue`
- Modify: `apps/desktop/src/stores/kanna.ts`
- Modify: `packages/db/src/queries.ts`
- Modify: `apps/desktop/src/stores/kannaTransfer.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that expect:

```ts
await store.handleOutgoingTransferCommitted({
  transferId: "transfer-123",
  sourceTaskId: "task-source",
  destinationLocalTaskId: "task-dest",
});

expect(await getTaskTransfer(db, "transfer-123")).toMatchObject({
  status: "completed",
});
expect((await getItem("task-source")).closed_at).not.toBeNull();
```

Add a duplicate-ack test that calls the handler twice and expects no throw and no extra state change.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/kannaTransfer.test.ts src/App.test.ts`
Expected: FAIL because the app does not listen for an outgoing commit event and the store has no completion handler.

- [ ] **Step 3: Write the minimal implementation**

Implement a store handler:

```ts
async function handleOutgoingTransferCommitted(event: OutgoingTransferCommitted): Promise<void> {
  const transfer = await getTaskTransfer(_db, event.transferId);
  if (!transfer || transfer.direction !== "outgoing") return;
  if (transfer.status === "completed") return;
  if (transfer.source_task_id !== event.sourceTaskId) return;

  await markTaskTransferCompleted(_db, event.transferId, event.sourceTaskId);
  await closeTask(event.sourceTaskId, { selectNext: false });
}
```

Then register an `outgoing-transfer-committed` listener in `App.vue` that forwards the parsed event into the store.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/kannaTransfer.test.ts src/App.test.ts`
Expected: PASS.

### Task 4: Verify Success And Failure In Real Two-Instance Flows

**Files:**
- Modify: `apps/desktop/tests/e2e/real/local-transfer-accept-import.test.ts`
- Create or Modify: `apps/desktop/tests/e2e/real/local-transfer-source-handoff-failure.test.ts`
- Modify: `apps/desktop/tests/e2e/helpers/*` as needed for deterministic failure setup

- [ ] **Step 1: Write the failing success/failure E2E assertions**

Add success assertions:

```ts
expect(await queryPrimarySourceTask(taskId)).toMatchObject({
  stage: "done",
});
```

Add failure assertions:

```ts
expect(await queryPrimarySourceTask(taskId)).toMatchObject({
  stage: "in progress",
  closed_at: null,
});
```

- [ ] **Step 2: Run the success E2E to verify it fails**

Run: `cd apps/desktop && KANNA_E2E_SLOW_MODE_MS=300 pnpm exec vitest run --config ./tests/e2e/vitest.config.ts tests/e2e/real/local-transfer-accept-import.test.ts`
Expected: FAIL because the primary task does not close after destination import yet.

- [ ] **Step 3: Run the failure E2E to verify it fails**

Run: `cd apps/desktop && KANNA_E2E_SLOW_MODE_MS=300 pnpm exec vitest run --config ./tests/e2e/vitest.config.ts tests/e2e/real/local-transfer-source-handoff-failure.test.ts`
Expected: FAIL because the failure path is not asserted yet.

- [ ] **Step 4: Adjust the implementation/helpers until both pass**

Keep the source-side invariant:

```text
success ack => source closes
no success ack => source stays open
```

- [ ] **Step 5: Re-run both E2E files**

Run:

```bash
cd apps/desktop
KANNA_E2E_SLOW_MODE_MS=300 pnpm exec vitest run --config ./tests/e2e/vitest.config.ts tests/e2e/real/local-transfer-accept-import.test.ts
KANNA_E2E_SLOW_MODE_MS=300 pnpm exec vitest run --config ./tests/e2e/vitest.config.ts tests/e2e/real/local-transfer-source-handoff-failure.test.ts
```

Expected: PASS.

### Task 5: Final Verification

**Files:**
- Verify only

- [ ] **Step 1: Run desktop TypeScript**

Run: `cd apps/desktop && pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 2: Run targeted desktop tests**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/kannaTransfer.test.ts src/App.test.ts`
Expected: PASS

- [ ] **Step 3: Run DB query tests**

Run: `cd packages/db && pnpm exec vitest run src/queries.test.ts`
Expected: PASS

- [ ] **Step 4: Run task-transfer Rust tests**

Run: `cargo test -p kanna-task-transfer --test protocol --test runtime`
Expected: PASS

- [ ] **Step 5: Run Rust formatter and clippy**

Run:

```bash
cargo fmt --all
cargo clippy -p kanna-task-transfer -p kanna-daemon -p kanna-desktop --tests -- -D warnings
```

Expected: PASS
