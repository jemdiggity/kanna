# Transfer Phase 2 Ownership Handoff Design

## Goal

Complete the next transfer milestone after destination-side local import: once the destination successfully imports a task, the source instance must receive an explicit success acknowledgment and close the original source task locally. The source task must remain open on rejection, import failure, or acknowledgment failure.

## Scope

This design covers:

- source-side outgoing transfer persistence,
- destination-to-source import success acknowledgment,
- source-side completion of the outgoing transfer record,
- source-side closure of the original task through the normal close path,
- idempotent handling of duplicate acknowledgments,
- success and failure coverage in unit, runtime, and real two-instance E2E tests.

This design does not cover:

- Bonjour discovery,
- pairing or trust UX,
- encrypted transport,
- cross-machine repo acquisition,
- provider resume semantics,
- a distinct visible "transferred" task state on the source.

## Current State

Phase 1 already supports:

- outgoing local transfer preflight and commit,
- destination persistence of incoming transfer payloads,
- destination approval and local import,
- destination provenance recording,
- real two-instance local transfer tests for first milestone and accept/import.

The current gap is ownership cutover:

- the destination can import successfully,
- the source has no success callback,
- the source task remains open after a successful import,
- there is no explicit protocol boundary for "the destination committed the import."

## Core Decision

Use an explicit **destination-to-source `import_committed` acknowledgment**.

The transfer runtime, not the destination desktop store, should signal that the import committed. The source desktop store remains responsible for local task lifecycle and must close the original task only after receiving that acknowledgment.

This preserves the main invariant from the broader LAN transfer design:

- no source task is closed until the destination import is committed.

## Approaches Considered

### 1. Explicit runtime acknowledgment

The destination sends `import_committed` back through the transfer sidecar/runtime. The source app receives a dedicated event and finalizes its local transfer/task state.

Pros:

- clean ownership boundary,
- aligns with the LAN transfer design,
- easy to make idempotent,
- failure-safe because missing ack means no source closure.

Cons:

- requires protocol, runtime, and desktop event changes.

### 2. Source polling of shared local state

The source periodically checks registry/shared state to infer that destination import succeeded.

Pros:

- smaller short-term change.

Cons:

- weaker protocol boundary,
- brittle once the feature leaves same-machine mode,
- harder to reason about retries and duplicates.

### 3. Destination directly commands source closure

The destination sends a high-level "close task" instruction to the source.

Pros:

- straightforward on paper.

Cons:

- destination reaches into source-local lifecycle concerns,
- couples protocol behavior to desktop store internals,
- makes later error handling harder.

## Recommendation

Use **approach 1**.

The runtime should acknowledge import success. The source store should interpret that acknowledgment and close the local task through the existing close path, preserving session teardown, port cleanup, selection behavior, and hidden-task semantics.

## Phase 2 Architecture

### Protocol

Add a new destination-to-source peer message:

- `ImportCommitted`

Fields:

- `request_id`,
- `transfer_id`,
- `source_task_id`,
- `destination_local_task_id`.

Add a corresponding sidecar event for the desktop app:

- `OutgoingTransferCommitted`

Fields:

- `transfer_id`,
- `source_task_id`,
- `destination_local_task_id`.

### Source-side transfer record

The source should persist an outgoing `task_transfer` row during commit so the acknowledgment has a stable local record to finalize.

Required row fields:

- `id = transfer_id`,
- `direction = 'outgoing'`,
- `status = 'pending'`,
- `source_task_id = source task id`,
- `local_task_id = source task id`,
- `target_peer_id = destination peer id`,
- `payload_json = serialized outgoing payload`.

Phase 2 continues using the existing `task_transfer` table rather than adding a second source-specific table.

### Destination commit flow

When the destination approves and successfully imports:

1. import the task locally,
2. mark the incoming transfer row completed,
3. record provenance,
4. send `ImportCommitted` back to the source runtime.

If import fails:

- do not send `ImportCommitted`,
- leave the source untouched.

### Source completion flow

When the source receives `OutgoingTransferCommitted`:

1. load the outgoing transfer row by `transfer_id`,
2. verify it is an outgoing row for the matching `source_task_id`,
3. ignore the event if the transfer is already completed,
4. mark the outgoing transfer `completed`,
5. close the original task via the existing `closeTask()` path.

The source must not mutate `pipeline_item` directly for this transition.

## Failure Handling

### Destination reject

- Destination marks incoming transfer `rejected`.
- No commit acknowledgment is emitted.
- Source task remains open.

### Destination import failure

- Destination leaves the transfer non-complete or marks it failed locally.
- No commit acknowledgment is emitted.
- Source task remains open.

### Acknowledgment delivery failure

- Destination may already have imported successfully.
- Source remains open until an acknowledgment is successfully delivered.
- This phase fails safe by preserving source ownership.

### Duplicate acknowledgments

Duplicate `ImportCommitted` events must be idempotent:

- if the outgoing transfer row is already completed, do nothing,
- if the source task is already closed, do nothing.

## Testing

### Desktop unit tests

Add or extend tests for:

- persisting outgoing transfer rows on source commit,
- completing the outgoing transfer after commit acknowledgment,
- closing the source task only after acknowledgment,
- ignoring duplicate acknowledgments,
- leaving the source task open when destination rejects or import fails.

### Runtime tests

Add task-transfer runtime coverage for:

- destination import success producing an acknowledgment visible to the source runtime,
- reject/failure paths producing no success acknowledgment.

### Real E2E

Add a two-instance success test that verifies:

1. primary pushes task to secondary,
2. secondary approves and imports,
3. imported task appears on secondary,
4. original task closes on primary after acknowledgment.

Add a failure test that verifies:

1. transfer starts,
2. destination import is forced to fail,
3. source task remains open on primary.

## Out Of Scope

Phase 2 explicitly does not include:

- pairing UX,
- trust persistence,
- encrypted transport,
- repo clone or bundle fallback,
- resume-session ownership cutover,
- visible source-side "transferred" stage or tag.
