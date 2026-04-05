# Headless Xterm Terminal Recovery Design

Move task terminal recovery out of the frontend and into a daemon-owned recovery subsystem. The Rust daemon remains the terminal master. A daemon-supervised long-lived Node recovery service mirrors PTY output into headless `xterm.js` instances and persists serialized snapshots to disk so task terminals can recover across terminal unmounts, daemon restarts, and app launches.

## Motivation

The current task-terminal recovery path is frontend-local:

- [`useTerminal.ts`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-524d7c7e/apps/desktop/src/composables/useTerminal.ts) restores serialized terminal state into the visible `xterm`
- [`terminalStateCache.ts`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-524d7c7e/apps/desktop/src/composables/terminalStateCache.ts) stores snapshots in browser `localStorage`
- recovery correctness depends on the browser environment, component lifetime, and how tests are invoked

That design is good enough for best-effort reconnects inside a single app instance, but it gives the wrong ownership model for terminal continuity:

- The app knows too much about recovery storage and policy
- Recovery state dies with the app process except for opportunistic browser snapshots
- Daemon handoff does not own scrollback continuity
- Recovery behavior is harder to reason about because terminal correctness is split across daemon, Tauri, and browser-local storage

The target design is that the daemon owns terminal recovery completely. The app asks for recovery state and attaches. It does not know whether the state came from memory, disk, or a fresh mirror.

## Goals

- Preserve task terminal recovery across:
  - terminal view unmount/remount
  - daemon restart and daemon swap on app launch
  - full app reload or relaunch
- Keep PTY ownership and live byte ordering in the Rust daemon
- Use headless `xterm.js` for terminal emulation instead of reimplementing terminal state in Rust
- Keep recovery optional: PTY sessions must continue running even if the recovery service is unavailable
- Remove browser `localStorage` from the task-terminal correctness path

## Non-Goals

- Perfect transactional continuity across daemon swap
- Bidirectional terminal I/O through the recovery service
- Replacing the existing daemon attach/broadcast model
- Applying this recovery path to non-task shell terminals in the first version

## Architecture

### Ownership

The Rust daemon is the source of truth for PTY sessions:

- spawns PTYs
- owns the single PTY reader
- broadcasts live output to attached clients
- manages session lifecycle and handoff
- supervises the recovery service

The Node recovery service is an internal daemon dependency:

- receives PTY output from the daemon over private IPC
- maintains one headless `xterm.js` instance per tracked task session
- periodically serializes terminal state to disk
- serves serialized snapshots back to the daemon on demand

The Tauri/frontend side does not know about Node, disk, or persistence policy. It only knows how to ask the daemon for recovery state for a session and how to attach for live output.

### Why a Separate Recovery Service

A separate Node recovery service is preferred over embedding terminal emulation into Rust because:

- `xterm.js` already solves terminal emulation and serialization
- PTY management and terminal emulation stay cleanly separated
- recovery failure does not take down PTY session management
- iteration and debugging are simpler than binding a JS runtime into the daemon process

This service is not public infrastructure. It is supervised by and hidden behind the daemon.

## Session Data Flow

### Live Output

For each task PTY session:

1. The daemon spawns the PTY as it does today
2. The daemon tells the recovery service to start tracking the session with its initial geometry
3. The daemon's single PTY reader reads output bytes in order
4. For each output chunk, the daemon:
   - broadcasts the bytes to attached clients
   - forwards the same bytes to the recovery service over internal IPC
5. The recovery service writes those bytes into the session's headless `xterm.js`
6. A debounce timer periodically serializes the terminal and writes a snapshot to disk

The daemon remains the only PTY reader. The recovery service is a mirror, not a consumer.

### Restore

When a visible task terminal mounts:

1. The frontend creates the visible `xterm`
2. The frontend invokes a new daemon command to get recovery state for `session_id`
3. If the daemon returns a compatible snapshot, the frontend writes the serialized state into the visible terminal
4. The frontend performs the existing `attach_session`
5. Live daemon output resumes into the restored terminal

The app does not know whether the snapshot came from an in-memory mirror, a persisted file, or no recovery source at all.

## Daemon Swap and App Launch

Kanna always performs daemon handoff on app launch. Recovery must follow that lifecycle.

### Swap Model

The recovery service does not perform service-to-service handoff. Disk snapshots are the continuity mechanism.

During daemon swap:

1. The old daemon stops forwarding PTY output to the recovery service
2. The old daemon sends `FlushAndShutdown` to the recovery service
3. The recovery service synchronously writes dirty session snapshots to disk and exits
4. PTY processes continue running without any recovery consumer during the swap window
5. PTY output accumulates only in the kernel PTY buffer during that interval
6. The new daemon receives PTY FDs through the existing daemon handoff process
7. The new daemon starts a fresh recovery service
8. The new recovery service starts tracking live sessions again and resumes mirroring from newly read PTY bytes

This intentionally accepts a small continuity gap if output exceeds kernel PTY buffering during the swap window. That trade-off is acceptable in exchange for much simpler lifecycle management.

### Why Not Recovery-Service Handoff

Avoiding service-to-service handoff keeps the design simpler:

- no mirrored terminal state transfer protocol
- no dual live consumers during swap
- no exact in-memory continuity requirement
- crash-tolerant recovery because disk is the interchange format

## Internal IPC Contract

The daemon-to-recovery protocol should stay minimal.

### Commands Sent by the Daemon

- `StartSession { sessionId, cols, rows }`
- `WriteOutput { sessionId, data, sequence }`
- `ResizeSession { sessionId, cols, rows }`
- `EndSession { sessionId }`
- `GetSnapshot { sessionId }`
- `FlushAndShutdown`

### Responses from the Recovery Service

- `Ok`
- `Error { message }`
- `Snapshot { sessionId, serialized, cols, rows, savedAt, sequence }`
- `NotFound`

### Protocol Rules

- `WriteOutput` is fire-and-forget from the daemon's perspective and must never block PTY broadcast
- `GetSnapshot` is request/response because it backs frontend restore
- `sequence` is assigned by the daemon and monotonically increases per session so freshness comparisons do not depend on clocks alone
- the recovery service never sends PTY input or lifecycle control back to the daemon

## Public Daemon API

Add one new Tauri command:

- `get_session_recovery_state(session_id)`

This command asks the daemon for the current recovery snapshot and returns either:

```ts
interface SessionRecoveryState {
  serialized: string
  cols: number
  rows: number
  savedAt: number
  sequence: number
}
```

or `null` if recovery state is unavailable.

This is the only frontend-facing recovery API. The frontend should not speak directly to the recovery service.

## Persistence Model

### Snapshot Storage

Each tracked session has one snapshot file under the daemon data directory. The snapshot file stores:

- `sessionId`
- `serialized`
- `cols`
- `rows`
- `savedAt`
- `sequence`

Writes use atomic replace semantics such as write-to-temp plus rename.

### Flush Policy

Persistence is timer-based only. The recovery service maintains dirty in-memory state and flushes snapshots on a debounce timer.

This keeps the hot output path simple:

- PTY output delivery never waits on disk writes
- no byte-threshold or mutation-threshold policy is needed in v1
- `FlushAndShutdown` is the only required synchronous flush path

### Recovery Freshness

Snapshots are best-effort. They can lag behind the live PTY by up to the debounce interval, plus any unflushed output lost during daemon swap. Recovery quality is therefore approximate, but session correctness remains intact because the daemon owns the live PTY.

## Frontend Changes

### Simplified Restore Flow

[`useTerminal.ts`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-524d7c7e/apps/desktop/src/composables/useTerminal.ts) should stop owning task-terminal snapshot persistence. For task PTY terminals, its responsibility becomes:

1. create the visible `xterm`
2. ask the daemon for recovery state
3. restore it if present and geometry-compatible
4. attach for live output

### Remove Browser-Owned Task Snapshot State

Task-terminal correctness should no longer depend on:

- [`terminalStateCache.ts`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-524d7c7e/apps/desktop/src/composables/terminalStateCache.ts)
- browser `localStorage`
- unmount-time serialization in the frontend

That logic can either be removed entirely for task PTY sessions or retained only for unrelated shell-terminal behavior if still useful there.

### Geometry Handling

The frontend still needs to guard against obviously incompatible restores. A snapshot should be applied only when its geometry is compatible with the current visible terminal policy. If incompatible, the frontend skips replay and attaches live.

The geometry decision remains a frontend concern because it depends on the visible terminal's actual layout.

## Failure Behavior

Recovery is strictly best-effort. PTY sessions must remain usable when the recovery service fails.

### Recovery Service Down

If the recovery service is unavailable:

- PTY output continues to attached clients
- user input continues to the PTY
- `get_session_recovery_state` returns `null`
- the daemon may log recovery errors, but should not surface them as user-visible terminal failures

### Recovery Service Restart

If the recovery service dies while the daemon is alive:

- the daemon restarts it
- live sessions are re-registered with `StartSession`
- mirroring resumes from subsequent PTY output
- previously persisted snapshots remain available on disk

The daemon should not attempt to reconstruct missing historical output since the crash. Recovery remains approximate.

## Session Scope

This design applies to task PTY terminals first. Shell terminals can continue using their current recovery behavior until there is a reason to unify them.

That keeps scope controlled and avoids changing shell semantics while the daemon-owned recovery path is being validated.

## Testing Strategy

### Unit Tests

- recovery-service snapshot serialization and deserialization
- per-session sequence monotonicity
- daemon-side behavior when recovery service returns `NotFound` or errors
- frontend restore logic using daemon-provided snapshots
- geometry compatibility decisions

### Integration Tests

- restore a task terminal after unmount/remount without browser `localStorage`
- restore after daemon restart while session remains alive
- restore after full app relaunch and daemon swap using disk snapshots
- degrade cleanly when recovery service is unavailable

### Non-Regression Checks

- no PTY input/output regression for live sessions
- no extra PTY readers introduced
- daemon swap still preserves PTY sessions
- task terminal reconnect behavior remains correct for Claude, Copilot, and Codex providers

## Implementation Notes

Likely code areas:

- daemon protocol and lifecycle in [`crates/daemon/src/main.rs`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-524d7c7e/crates/daemon/src/main.rs)
- daemon/Tauri command surface in [`apps/desktop/src-tauri/src/commands/daemon.rs`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-524d7c7e/apps/desktop/src-tauri/src/commands/daemon.rs)
- app reattach and daemon startup coordination in [`apps/desktop/src-tauri/src/lib.rs`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-524d7c7e/apps/desktop/src-tauri/src/lib.rs)
- terminal restore logic in [`apps/desktop/src/composables/useTerminal.ts`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-524d7c7e/apps/desktop/src/composables/useTerminal.ts)
- recovery policy helpers in [`apps/desktop/src/composables/terminalSessionRecovery.ts`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-524d7c7e/apps/desktop/src/composables/terminalSessionRecovery.ts)

## Open Questions Resolved

- Recovery owner: the daemon
- Terminal emulator: headless `xterm.js` in Node
- App awareness: daemon-only API, no direct recovery-service knowledge
- Swap behavior: flush to disk and restart, no recovery-service handoff
- Persistence cadence: debounce timer only
- Target scope: task PTY terminals first
