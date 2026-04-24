# kanna-daemon Design

PTY session daemon for Kanna. Runs as a standalone process, persists terminal sessions across app restarts, and communicates with the Tauri frontend over a Unix socket using line-delimited JSON.

## Architecture

```
┌─────────────┐     Unix Socket      ┌──────────────┐
│  Tauri App   │◄───────────────────►│ kanna-daemon  │
│  (frontend)  │   JSON commands/     │               │
│              │   events             │  ┌──────────┐ │
│  invoke()    │                      │  │ Session  │ │
│  listen()    │                      │  │ Manager  │ │
└─────────────┘                      │  └────┬─────┘ │
                                     │       │       │
                                     │  ┌────▼─────┐ │
                                     │  │ PTY      │ │
                                     │  │ Sessions │ │
                                     │  └──────────┘ │
                                     └──────────────┘
```

### Components

- **Socket layer** (`socket.rs`): Binds Unix socket, reads/writes line-delimited JSON.
- **Protocol** (`protocol.rs`): Command/Event enums, serde-tagged JSON.
- **Session Manager** (`session.rs`): HashMap of session_id → PtySession.
- **PTY** (`pty.rs`): Raw libc PTY (`openpty`/`fork`/`execvp`). Exposes raw fd for handoff.
- **FD Transfer** (`fd_transfer.rs`): `SCM_RIGHTS` fd passing over Unix sockets.
- **Main** (`main.rs`): Connection handling, command dispatch, output streaming, handoff.

## Session Lifecycle

```
Spawn ──► create PTY, store session, start stream_output
               │
PTY output ──► stream_output updates the headless terminal
               │
AttachSnapshot ──► send headless snapshot + add live writer
               │
Detach ──► remove live writer (headless terminal keeps updating)
               │
Kill ──────► kill child process, stream_output exits on read() EOF
               │
Handoff ──► transfer master fd to new daemon via SCM_RIGHTS
```

## Single-Reader Architecture

The most critical design decision. Each PTY session has exactly **one** reader task that runs for the session's entire lifetime.

### The Problem It Solves

The original design cloned the PTY master file descriptor on each `Attach` and spawned a new `stream_output` task per connection. This caused a fatal bug:

- On Unix, when multiple file descriptors point to the same PTY master, `read()` delivers each byte to **only one** reader.
- On reattach (e.g., app restart), the old reader's `read()` was blocked and couldn't be cancelled — it held a cloned fd that would compete with the new reader.
- Result: bytes split between old and new readers, causing "every Nth character" display corruption.

Cancel flags were added as a mitigation, but they only work when `read()` returns. With an idle PTY (no output), `read()` blocks indefinitely, so zombie readers accumulate.

### The Solution

```
                    ┌─────────────────────────┐
                    │     stream_output        │
                    │     (one per session)     │
                    │                           │
  PTY master ──────►│  reader.read(&mut buf)    │
  (one fd)          │         │                 │
                    │         ▼                 │
                    │  update headless terminal │
                    │  broadcast to live writers│
                    │                           │
                    └─────────────────────────┘
                                ▲
                                │ AttachSnapshot adds
                                │ a live writer
                    ┌───────────┴───────────┐
                    │    SessionWriters      │
                    │    broadcast list      │
                    └───────────────────────┘
```

- **Spawn**: Creates PTY, clones the reader once, spawns one `stream_output` task, and creates the headless terminal.
- **AttachSnapshot**: Sends the current headless terminal snapshot and adds the new connection's writer to the broadcast list. Instant, no new tasks or readers for spawned sessions.
- **Detach**: Removes the connection's writer. Output continues to be read and applied to the headless terminal.
- **Process exit**: `read()` returns 0 (EOF), `stream_output` cleans up the session.

### Trade-offs

| Aspect | Decision | Trade-off |
|--------|----------|-----------|
| Reader count | One per session | Simpler, no byte-splitting. But if the single reader panics, the session is lost. |
| Writer registry | Per-session broadcast list | Extra lock per output chunk. In practice, PTY output is ~4KB chunks at ~60Hz, so this is negligible. |
| No raw scrollback buffer | Hydrate from the headless terminal snapshot | Eliminates raw replay races and overwritten-output resurrection. Detached state has one source of truth. |
| Blocking read | `spawn_blocking` with `std::io::Read` | Can't use async I/O for PTY reads (portable-pty gives `Box<dyn Read>`). The blocking thread is pinned for the session lifetime. One thread per session is acceptable for expected scale (<100 sessions). |

## Reconnection Strategy

The daemon does **not** buffer raw scrollback. Instead, `stream_output` continuously applies PTY bytes to the per-session headless terminal. Reconnection is:

1. **AttachSnapshot** — send the serialized headless terminal state and add the live writer
2. **Hydrate xterm.js** — frontend resets xterm.js and writes the snapshot VT stream
3. **Send Resize** — `resize_session` updates PTY dimensions and may trigger a child redraw
4. **Stream live output** — later PTY bytes flow to all attached clients and the headless terminal

This leaves detached terminal state with one authority. Raw PTY bytes are never replayed after they have already been interpreted by the headless terminal.

## Protocol

Line-delimited JSON over Unix socket. Each message is a single JSON object terminated by `\n`.

### Commands (client → daemon)

| Command | Description |
|---------|-------------|
| `Spawn` | Create a new PTY session |
| `AttachSnapshot` | Snapshot current headless terminal and start receiving live output |
| `Detach` | Stop receiving output |
| `Input` | Send keystrokes to the PTY |
| `Resize` | Update terminal dimensions |
| `Signal` | Send a Unix signal (SIGTSTP, SIGCONT, etc.) |
| `Kill` | Terminate and remove a session |
| `List` | List all sessions with status |
| `Handoff` | Request session transfer (new daemon → old daemon) |

### Events (daemon → client)

| Event | Description |
|-------|-------------|
| `Ok` | Command acknowledged |
| `Error` | Command failed |
| `Output` | PTY output data (binary as JSON byte array) |
| `Exit` | Process exited with code |
| `SessionCreated` | New session ready |
| `SessionList` | Response to List |
| `HandoffReady` | Session metadata for handoff (followed by SCM_RIGHTS fds) |

## Daemon Handoff

When a new daemon starts and detects an old daemon running (via PID file), it performs a handoff to adopt live sessions:

```
New daemon                          Old daemon
    │                                    │
    ├──► Handoff{version:1} ────────────►│
    │                                    ├── collect live sessions
    │                                    ├── detach fds (no close)
    │◄── HandoffReady{sessions} ◄───────┤
    │◄── SCM_RIGHTS (master fds) ◄──────┤
    │                                    ├── exit
    ├── adopt sessions from fds          │
    ├── bind socket                      ✗
    ├── ready for clients
```

Key details:
- **SCM_RIGHTS** transfers PTY master fds at the kernel level. The child process's PTY connection is unbroken.
- The old daemon calls `detach_for_handoff()` which extracts the raw fd via `std::mem::forget` to prevent the `OwnedFd` destructor from closing it.
- The new daemon creates `PtySession::adopt()` from the received fds. Adopted sessions don't own the child process (can't `waitpid`), so liveness is checked via `kill(pid, 0)`.
- Version check prevents incompatible handoffs.
- If handoff fails, old daemon is killed and sessions are lost.

### Dev Workflow

`bun tauri dev` builds the daemon before starting Vite:

1. `cargo build -p kanna-daemon`
2. Vite starts
3. Tauri app starts, calls `ensure_daemon_running()`
4. New daemon spawns, performs handoff from old daemon
5. Claude sessions continue uninterrupted

## Configuration

| Env Var | Description | Default |
|---------|-------------|---------|
| `KANNA_DAEMON_DIR` | Override data directory (socket, PID file) | `~/Library/Application Support/Kanna` |

`KANNA_DAEMON_DIR` is primarily for testing — integration tests use it to isolate each test's daemon instance in a temp directory.

## Testing

Integration tests spawn real daemon processes and communicate over Unix sockets:

```bash
cd crates/daemon
cargo test --test reconnect --test handoff -- --test-threads=1
```

Tests must run single-threaded (`--test-threads=1`) because each test spawns and kills daemon processes.

### Test Coverage

**Reconnect** (`tests/reconnect.rs`):
- Basic spawn/attach/I/O roundtrip
- Separate-connection spawn/attach/input (mirrors real Tauri architecture)
- Reattach on same connection (no byte splitting)
- Reattach on new connection (simulates app restart)
- Input works after reattach
- Rapid reattach (5 connections, no delays)

**Handoff** (`tests/handoff.rs`):
- Single session transfer: spawn on A, handoff to B, I/O works through B
- Empty handoff: no sessions, B starts fresh
- Multiple sessions: 3 sessions all survive handoff

**FD Transfer** (unit tests in `fd_transfer.rs`):
- Single fd transfer over socketpair
- Multiple fd transfer
- Empty transfer
- Invalid fd rejection
