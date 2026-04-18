# Transfer Source Finalization Design

## Summary

LAN transfer should not interrupt the source task while the destination is still deciding whether to accept it. Once the destination approves the incoming transfer, the source side should stop the running agent session, wait briefly for exit-driven resume metadata, refresh any provider-specific transfer artifacts, and then allow the destination to import the freshest possible session state. If the destination rejects the transfer, the source session should continue uninterrupted.

## Goals

- Keep source tasks running while an incoming transfer is only pending.
- Stop the source agent only after the destination explicitly approves the transfer.
- Improve Codex transfer fidelity by waiting for the exit-emitted resume UUID before packaging the final payload when possible.
- Preserve best-effort behavior if source shutdown or artifact refresh does not complete in time.
- Keep rejection non-destructive: rejecting a pending transfer must not interrupt the source session.

## Non-Goals

- Adding a progress UI for transfer finalization.
- Changing the trust or pairing model.
- Making transfer import transactional across both machines.
- Refactoring the broader task close/teardown lifecycle beyond what transfer finalization needs.

## Current Problem

Today `pushTaskToPeer()` builds the outgoing transfer payload immediately after preflight and stages any session artifacts from the source machine's current on-disk state. That is acceptable for providers whose resumable session state already exists on disk, but it is incomplete for Codex because the resumable session UUID is often only emitted when the session exits. The current flow therefore snapshots the task too early and can send a payload without the best available resume data.

The current timing is also backwards relative to the desired UX. The source task is effectively prepared up front even though the destination may reject the transfer. The source should only be interrupted after the destination has chosen to proceed.

## Options Considered

### 1. Stop the source during outgoing preflight

This is operationally simple, but it violates the required behavior because the source agent is interrupted before the destination has approved the transfer.

### 2. Finalize the source only after destination approval

This adds one extra handshake step, but it matches the intended product behavior. The source session remains live while the transfer is pending, and the source is only stopped once the destination commits to importing the task.

### 3. Never stop the source and rely entirely on pre-staged artifacts

This keeps the transfer path simple, but it does not fix the Codex resume-ID problem and continues to ship stale session state when the freshest metadata is only available on exit.

## Chosen Approach

Use a two-phase ownership handoff where destination approval triggers a source-side finalization step before import begins.

The transfer will still start with the existing preflight plus commit flow so the destination can receive a pending incoming transfer request and show it in the UI. That phase remains non-destructive. When the destination user presses Approve, the destination must call back to the source through the transfer runtime and ask it to finalize the source task for transfer.

Source finalization will:

- locate the source outgoing transfer row and current task metadata
- send `SIGINT` to the source agent PTY session
- wait for a short bounded window for `session_exit`
- persist any newly emitted Codex `resume_session_id`
- re-read the source task row from the database
- restage provider-specific session artifacts from the freshest local state
- replace the stored outgoing transfer payload with the refreshed payload
- return the refreshed payload to the destination

The destination import path will then continue using this refreshed payload. If source finalization times out or artifact refresh fails, the transfer still proceeds best-effort using the last valid payload the source can produce. Rejection skips this handshake entirely and leaves the source session untouched.

## Detailed Flow

### Outgoing initiation

When the source user chooses `Push to Machine`, the source still:

- runs transfer preflight
- creates a pending outgoing transfer row
- sends the initial payload to the destination

This initial payload is treated as provisional. It is sufficient for the destination to render an incoming transfer request, but it is not yet the final import snapshot.

### Incoming approval

When the destination user approves an incoming transfer, the destination does not import immediately. Instead it requests source finalization for that transfer ID.

The runtime validates that:

- the transfer reservation still exists
- the request comes from the expected peer
- the transfer is still pending

Then it emits a source-finalization event or handles an explicit finalization request path that allows the desktop store to perform source-local work before responding.

### Source-side finalization

The source desktop store owns finalization because it already knows how to:

- signal daemon sessions
- wait for `session_exit`
- persist exit-derived Codex session IDs
- locate and stage provider artifacts
- rebuild outgoing transfer payloads
- update the `task_transfer` table

The store sends `SIGINT` to the source agent session and waits only briefly. The wait is bounded so transfer cannot hang indefinitely behind a stuck PTY. If the session exits in time, the existing `session_exit` listener persists the Codex resume session ID, and finalization then reloads the task row to pick up the fresh `agent_session_id`.

After that, the store rebuilds the outgoing payload from the refreshed task row, stages fresh artifacts, and saves the final payload back to the source-side `task_transfer` row.

### Destination import

Once finalization returns, the destination imports using the refreshed payload returned by the source. This is the payload that should contain the best available Codex resume ID and the freshest provider artifact set.

If finalization returns a degraded-but-valid payload because timeout or artifact refresh fell back to best effort, the destination still proceeds with import.

### Incoming rejection

Rejecting a pending transfer marks the incoming transfer rejected locally and does not send any source-finalization request. The source agent continues running.

## Data And Protocol Changes

The protocol needs one additional step beyond the existing preflight and commit flow: a destination-triggered source-finalization request tied to an existing transfer ID.

That request should return the final payload that the destination must import. The finalization response should not require the destination to infer freshness from local DB state or fetch separate metadata later. The response should be explicit: same transfer ID, refreshed payload, and an indicator of whether finalization completed cleanly or fell back to best effort.

On the desktop side, the source `task_transfer` row remains the source of truth for the current outgoing payload. Finalization updates that row in place.

## Error Handling

- If the destination rejects the transfer, no source finalization is attempted.
- If the source task no longer exists, finalization fails and the destination approval should surface an error instead of importing stale state.
- If `SIGINT` fails, finalization logs the failure and continues best effort.
- If the source session does not exit within the bounded wait window, finalization continues best effort with the latest available task row.
- If artifact restaging fails, finalization keeps the transfer alive and returns a payload without the missing artifact rather than failing the whole transfer.
- If the finalization handshake itself fails, destination approval fails and the incoming transfer remains pending so the user can retry or reject it.

## Testing Strategy

### Store tests

Add focused `kannaTransfer.test.ts` coverage for:

- destination rejection does not trigger source finalization
- approval requests source finalization before import
- source finalization signals the PTY and waits briefly for session exit
- Codex finalization reloads the refreshed `agent_session_id` after exit
- best-effort fallback still returns a valid payload when the source does not exit in time

### Runtime and sidecar tests

Add protocol and runtime tests for the new finalization request/response path, including request validation and payload round-tripping.

### Integration confidence

Keep the existing import-ack handoff behavior intact. The source task should still only close after destination import succeeds and the destination sends the existing commit acknowledgment back.

## Risks And Tradeoffs

- This introduces another transfer handshake, so the state machine becomes slightly more complex.
- The runtime must expose a source-local finalization path without smearing desktop-specific task logic into the transfer crate.
- A bounded wait means some Codex transfers will still fall back to degraded recovery if Codex does not emit exit metadata promptly, but that is preferable to hanging transfer entirely.

## Success Criteria

- Pending incoming transfers do not interrupt the source task.
- Approving an incoming transfer attempts to stop the source task before import.
- Codex transfers can capture exit-derived resume IDs when the source exits promptly.
- Rejected transfers leave the source session running.
- A stuck source session degrades gracefully instead of blocking transfer forever.
