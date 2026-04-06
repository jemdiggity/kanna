# Ghostty Recovery Service Design

## Goal

Replace Kanna's headless xterm/Node terminal recovery stack with a Rust/Ghostty-based recovery service while preserving the recovery-service architecture that already worked on `main`.

The recovery service remains the durable source of truth for terminal restoration. The live PTY daemon remains responsible only for owning processes, PTY IO, and mirroring state changes into the recovery service.

## Problem

The direct daemon-side snapshot/handoff path is too tightly coupled to daemon restart timing. We observed real restore failures where:

- the frontend correctly fetched and applied a snapshot
- the live post-attach stream only emitted a prompt-sized redraw
- but scrollback was already missing because the daemon handoff snapshot had been truncated before the frontend ever saw it

This is the wrong architectural boundary. Restore correctness should not depend on live daemon handoff timing, PTY fd transfer order, or adopted sidecar state surviving perfectly across daemon replacement.

`main` already had a better shape:

- live daemon mirrors terminal output into a separate long-lived recovery service
- recovery service persists per-session snapshots to disk
- frontend restore reads from that durable snapshot source

The weakness in `main` was the headless engine/runtime:

- headless xterm.js
- Node runtime packaging

So the right long-term fix is to keep the `main` architecture and replace only the recovery engine/runtime.

## Architecture

### Recovery Service

The recovery service remains a separate long-lived sidecar process with the same narrow command protocol used by `main`:

- `StartSession`
- `WriteOutput`
- `ResizeSession`
- `EndSession`
- `GetSnapshot`
- `FlushAndShutdown`

Its implementation becomes Rust + Ghostty + xterm-compatible serialization.

The service owns:

- per-session terminal mirror state
- per-session disk snapshot files
- restart recovery of its own mirrored sessions from disk

The service does not own:

- PTY processes
- daemon handoff
- worktree metadata beyond what is required to key a session snapshot

### PTY Daemon

The daemon remains responsible for:

- spawning and owning PTY child processes
- attach/detach/input/resize/signal
- daemon handoff and fd transfer
- mirroring output and geometry changes into the recovery service

The daemon no longer acts as the authoritative snapshot store for UI restore.

It should treat the recovery service as a write-through persistence layer:

- on spawn/attach lifecycle changes, notify recovery service
- on output, mirror bytes with monotonically increasing sequence numbers
- on resize, mirror cols/rows
- on session end, close recovery session
- on frontend restore requests, read from recovery service rather than generating live snapshots from adopted state

### Frontend

The frontend restore contract stays aligned with `main`:

- fetch durable snapshot from the recovery path
- destructively reset terminal state
- apply snapshot
- attach live stream

The frontend should not care whether the recovery service is backed by xterm or Ghostty.

## Component Boundaries

### `crates/daemon/src/recovery.rs`

Keep the same ownership boundary and command vocabulary, but switch the launcher/runtime target from Node/xterm to the Rust/Ghostty recovery sidecar.

Responsibilities:

- lifecycle management for the recovery sidecar
- command serialization and response parsing
- replaying tracked sessions after recovery-sidecar restart
- exposing `start_session`, `write_output`, `resize_session`, `end_session`, `get_snapshot`, `flush_and_shutdown`

It should not contain terminal emulation logic.

### Recovery Sidecar Package

Preserve the existing package boundary at `packages/terminal-recovery`, but reimplement it as a Rust-backed service instead of a Node program.

Long-term, this package becomes the home for:

- the recovery service entrypoint/build wiring
- protocol tests
- session persistence tests

The headless terminal implementation itself should live in focused Rust modules or a Rust crate, not in the daemon.

### Ghostty Snapshot Engine

The Ghostty-backed mirror/serializer owns:

- applying PTY output bytes into Ghostty terminal state
- applying resize updates
- serializing terminal state into xterm-compatible restore payloads
- loading persisted snapshots back into Ghostty-backed mirror sessions where needed

This layer should know about terminal state, not Kanna task metadata.

## Data Flow

### Live Session

1. Daemon spawns PTY session.
2. Daemon tells recovery service `StartSession(session_id, cols, rows, resume_from_disk=false)`.
3. PTY output arrives.
4. Daemon mirrors `WriteOutput(session_id, bytes, sequence)` into recovery service.
5. Recovery service updates Ghostty mirror state and writes durable snapshot file.
6. Resize events mirror through `ResizeSession`.

### App Restart / Daemon Restart

1. App starts a fresh daemon.
2. Daemon handoff preserves live PTY processes as it already does.
3. Recovery service remains long-lived and keeps disk snapshots authoritative.
4. Frontend reconnect asks for snapshot through the recovery path.
5. Frontend resets local xterm state and applies the durable snapshot.
6. Frontend attaches live PTY stream.

This intentionally decouples restore fidelity from daemon-side adopted terminal state.

### Recovery Service Restart

1. Daemon notices recovery service stopped.
2. `RecoveryManager` restarts it.
3. `RecoveryManager` replays tracked sessions with `resume_from_disk=true`.
4. Recovery service reloads durable snapshots and resumes mirroring.

This preserves the `main` service contract and isolates recovery-sidecar crashes from PTY ownership.

## Persistence Contract

Each session has a durable snapshot file keyed by session ID.

Stored fields should continue to include:

- serialized terminal payload
- cols
- rows
- saved timestamp
- mirror sequence number

The snapshot format should remain stable at the protocol level so the daemon/frontend boundary does not churn during the engine swap.

The recovery service should write snapshots atomically so the frontend never reads partially-written state.

## Packaging

The long-term solution removes the Node runtime from the headless recovery path.

Requirements:

- bundled as a normal Kanna sidecar/binary
- no dependency on Node or Bun at runtime
- release-safe on end-user macOS systems without dev tools
- follows existing vendoring/static-linking expectations

This is one of the main reasons to prefer a Rust/Ghostty recovery service over preserving the Node-based implementation.

## Migration Plan

### Phase 1: Restore the `main` Recovery Architecture

Bring back:

- `crates/daemon/src/recovery.rs`
- recovery-service command path
- frontend snapshot retrieval through recovery manager rather than direct daemon-side sidecar snapshots

Do this without changing the frontend restore contract.

### Phase 2: Swap the Recovery Engine

Replace the headless xterm/Node service internals with:

- Rust process
- Ghostty-backed terminal mirror
- xterm-compatible serializer

Keep the external recovery protocol unchanged.

### Phase 3: Remove Temporary Direct Snapshot Path

Delete the current direct daemon snapshot/handoff restore flow that was introduced during the Ghostty experiment.

After this, all restore requests should flow through the recovery service boundary again.

## Error Handling

- If recovery snapshot fetch fails, frontend should still attach live session and surface reconnect degradation visibly.
- If recovery service is unavailable, daemon should continue running PTY sessions and attempt to re-establish the recovery sidecar.
- Recovery-sidecar failure must not be fatal to daemon PTY ownership.
- Snapshot persistence errors must be logged with session ID and sequence context.
- Sequence regression or malformed snapshot payloads should be rejected explicitly, not silently.

## Testing

### Unit

- Ghostty mirror applies output/resize and serializes expected xterm-compatible payloads
- disk snapshot read/write roundtrip
- recovery manager request/restart/replay behavior

### Integration

- daemon mirrors a live PTY session into the recovery service
- recovery snapshot survives daemon restart
- frontend restore from recovery snapshot shows scrollback before attach
- recovery service restart while daemon stays alive replays tracked sessions from disk

### Regression

Cover the exact failure shape we just saw:

- live session has large scrollback
- daemon restarts
- restored snapshot must still contain full history
- prompt-sized post-attach redraw must not be the only visible output

## Success Criteria

- frontend restore fidelity no longer depends on daemon handoff snapshot generation
- no Node runtime in the headless recovery path
- same narrow recovery-service interface as `main`
- Ghostty powers snapshot generation
- xterm frontend restores from recovery snapshots without losing scrollback across daemon restart
