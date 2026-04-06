# Defensive Daemon Handoff Design

## Goal

Make daemon handoff preserve live PTY sessions even when snapshot serialization or recovery seeding fails. Session liveness must not depend on snapshot availability.

## Problem

The current handoff path couples three different concerns:

- PTY ownership transfer
- in-memory sidecar snapshot generation
- durable recovery snapshot seeding

When `session.sidecar.snapshot()` fails during handoff, the old daemon logs the error and skips that session entirely. The new daemon never adopts the PTY, and the frontend later gets `session not found` even though the underlying session was alive before restart.

This is the wrong failure mode. Snapshot failure should degrade restore capability, not destroy session continuity.

## Requirements

### Primary invariant

For any session whose PTY is alive at handoff time, the new daemon should adopt the PTY if fd transfer succeeds, regardless of snapshot success.

### Secondary invariant

If snapshot metadata is available, the new daemon should restore sidecar state and seed the recovery service. If snapshot metadata is unavailable, the adopted session should still be attachable and usable, but without guaranteed historical restore state.

### Failure handling

- Snapshot serialization failure must not drop the PTY from handoff.
- Recovery seeding failure must not drop the PTY from handoff.
- Handoff logs must distinguish:
  - live adopted with snapshot
  - live adopted without snapshot
  - handoff lost because fd transfer failed

## Design

### Protocol

`protocol::HandoffSession.snapshot` becomes optional.

This lets the old daemon describe:

- live PTY + snapshot available
- live PTY + snapshot unavailable

without silently omitting the session from `HandoffReady`.

### Old daemon handoff behavior

For each live session:

1. Attempt sidecar snapshot.
2. If it succeeds, include it in `HandoffReady`.
3. If it fails, log the failure and include `snapshot: null`.
4. In both cases, still call `detach_for_handoff()` and send the PTY fd.

The only reason to omit a live session from handoff should be inability to transfer its PTY fd.

### New daemon adoption behavior

For each handed-off session:

- Always adopt the PTY.
- If a snapshot exists:
  - restore `TerminalSidecar::from_snapshot(...)`
  - seed recovery snapshot store
- If no snapshot exists:
  - create a fresh `TerminalSidecar::new(...)` using the PTY dimensions carried in handoff metadata
  - skip recovery seeding
  - log the session as degraded but live

The adopted session should be fully attachable in both cases.

### Geometry metadata

When snapshot is absent, the new daemon still needs initial dimensions for a blank sidecar. Handoff metadata should therefore carry `rows` and `cols` independently from the optional snapshot.

That keeps adoption workable without inventing fake snapshot content.

## Data flow

### Successful snapshot case

old daemon:
- snapshot succeeds
- detach PTY
- send fd + snapshot + geometry

new daemon:
- adopt PTY
- restore sidecar from snapshot
- seed recovery store

### Snapshot failure case

old daemon:
- snapshot fails
- detach PTY anyway
- send fd + `snapshot: null` + geometry

new daemon:
- adopt PTY
- create blank sidecar from geometry
- skip recovery seeding
- live attach still works

## Testing

Add daemon handoff coverage for the degraded path:

- a live session whose snapshot generation fails is still handed off and attachable through the new daemon
- the session remains usable for I/O after handoff
- the new daemon does not return `session not found`
- optional snapshot protocol round-trip is covered

## Non-goals

- Fixing Codex prompt redraw behavior after reconnect resize
- Improving snapshot fidelity when serialization succeeds
- Adding new daemon/frontend handshake semantics

## Success criteria

- No live PTY is lost solely because snapshot serialization failed
- `session not found` no longer appears for live sessions that survived handoff but lacked snapshots
- degraded sessions remain interactive after daemon restart
