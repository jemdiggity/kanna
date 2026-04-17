# LAN Task Transfer Design

## Goal

Let a user push a PTY-backed task from one Kanna desktop instance to another machine on the same LAN. The destination should reconstruct the task as a new local task, restore its worktree and terminal state, resume the agent when the provider supports a durable resume UUID, and take over ownership only after a successful import.

## Scope

This design covers:

- desktop-to-desktop task transfer on the local subnet,
- Bonjour discovery,
- explicit peer pairing and trust,
- end-to-end encrypted transfer sessions,
- stop-and-transfer ownership handoff,
- Claude and Copilot PTY tasks with resumable provider UUIDs,
- repo reconstruction by remote URL first, with source-sent repo data as fallback,
- worktree, terminal snapshot, and task metadata export/import.

This design does not cover:

- SDK task transfer,
- internet relay transfer,
- multi-user Kanna accounts,
- Codex automatic session resume,
- continuous synchronization between peers.

## Current State

Kanna already has two relevant primitives:

- PTY tasks can be resumed with provider-specific session identifiers stored on the task row. Claude and Copilot already use durable resume IDs in the desktop store.
- The daemon already persists terminal recovery snapshots that can recreate VT state, geometry, and cursor state.

Kanna also has a separate remote/mobile path built around `kanna-server`, but that path is designed for remote observation and command proxying, not ownership transfer. Task migration should therefore use a dedicated transfer service instead of extending the existing relay architecture.

## User Experience

### Outgoing transfer

1. User chooses `Push to Machine` on a task.
2. Kanna shows Bonjour-discovered peers.
3. If the peer is untrusted, Kanna runs a one-time pairing flow.
4. Once trusted, the source starts a transfer.
5. Kanna gracefully stops the local agent CLI and PTY session, captures a final package, uploads it, and waits for destination acknowledgment.
6. When the destination commits the import, the source marks the original task transferred and closes it locally.

### Incoming transfer

1. Kanna receives a transfer request from a peer.
2. If the peer is trusted, Kanna accepts automatically.
3. If the peer is untrusted, Kanna prompts for approval and a pairing code verification.
4. Kanna downloads and decrypts the package.
5. Kanna restores the repo, task metadata, worktree state, terminal recovery snapshot, and provider resume context.
6. Kanna creates a new local task identity and resumes ownership on that machine.

## Core Decisions

### Stop-and-transfer ownership

Transfers are transactional ownership moves, not live mirrors. The source must stop the agent CLI before packaging the task. This is required for consistent terminal capture and for providers whose durable session UUID is only finalized when the CLI exits.

The source task remains authoritative until the destination returns a committed import acknowledgment. If import fails, the source task stays local.

### New local identities on import

The transferred task is not a database replica. The destination allocates fresh local runtime identities:

- new `pipeline_item.id`,
- new `worktree.id`,
- new `terminal_session.id`,
- new local worktree path,
- new local branch name when branch naming depends on the local task id.

The package preserves source provenance separately:

- source peer id,
- source task id,
- source branch,
- transfer timestamp.

### Repo reconstruction prefers remote URL

If the destination does not already have the repo, the package should first provide the repo remote URL, default branch, and required refs so the destination can clone or fetch the repo directly.

If the destination cannot resolve the repo from an existing local checkout or from the remote URL, the source falls back to sending repo data in the package. That fallback covers repos without usable remotes, unreachable remotes, and local-only repositories.

### Trust is per local Kanna user data

Trust is not machine-wide. Pairings are stored inside the current user's Kanna data directory, so another OS user on the same machine does not automatically trust the same peers.

### End-to-end encryption is required

Bonjour only discovers peers. Every transfer session must be authenticated and encrypted end-to-end using paired peer identities plus per-transfer ephemeral keys.

## Architecture

### New transfer sidecar

Add a dedicated Rust sidecar responsible for local network transfer:

- Bonjour advertise/browse,
- pairing handshake,
- peer trust validation,
- encrypted session establishment,
- transfer request/response protocol,
- package streaming,
- import/export progress reporting.

This sidecar should be separate from the PTY daemon. The PTY daemon owns sessions and recovery state. The transfer sidecar owns network trust and transport.

### Tauri orchestration layer

Add desktop Tauri commands that orchestrate transfer workflows:

- list discovered peers,
- start pairing,
- accept or reject pairing,
- start outgoing transfer,
- accept or reject incoming transfer,
- query progress,
- cancel transfers,
- import package,
- export package.

The Tauri layer coordinates between the desktop store, the PTY daemon, git commands, and the transfer sidecar.

### Database additions

Add local tables for:

- trusted peers,
- transfer audit history,
- imported task provenance.

These tables are operational metadata. Imported task provenance should link to the new local task without turning the destination task row into a copy of the source row.

## Discovery And Pairing

### Discovery

Each desktop instance advertises a Bonjour service on the local subnet. The service metadata should include only:

- protocol version,
- peer id,
- device display name,
- transfer capability version,
- accepting-transfers status.

Task names, prompts, repo paths, and user content must never appear in Bonjour metadata.

### Pairing

Pairing is explicit. When a user selects an untrusted peer, Kanna starts a one-time handshake:

1. source sends pairing intent,
2. target prompts the user,
3. both sides display the same short verification code,
4. user confirms the code on both sides,
5. both sides store the peer's long-lived identity key and metadata.

Stored trust record fields:

- `peer_id`,
- `display_name`,
- `public_key`,
- `paired_at`,
- `last_seen_at`,
- `capabilities_json`,
- `revoked_at`.

Trusted peers auto-accept transfer requests. Untrusted peers require local approval.

## Transfer Protocol

### Preflight

Before stopping the source task, the source sends a small encrypted `prepare_transfer` request containing:

- source peer id,
- source task id,
- task summary,
- agent provider,
- package format version,
- capability requirements.

The destination responds with:

- acceptance or rejection,
- whether the repo already exists locally,
- whether remote clone is possible,
- whether provider resume is supported,
- a one-time ready token for the upload.

### Export

After the destination signals readiness:

1. source gracefully stops the agent CLI,
2. source captures the final provider resume id if available,
3. source captures the terminal recovery snapshot,
4. source reads task metadata and worktree state,
5. source resolves repo acquisition mode,
6. source builds and encrypts the transfer package,
7. source streams the package to the destination.

### Import

The destination imports in ordered stages:

1. validate trust, token, manifest version, and checksums,
2. resolve or acquire the repo,
3. create a new local task id and worktree path,
4. restore the worktree content,
5. insert new local DB rows,
6. seed the daemon recovery snapshot store,
7. spawn the local PTY session with provider-specific resume flags when supported,
8. mark the import committed,
9. return success acknowledgment to the source.

Only after step 9 may the source close the original task.

## Package Format

Use a versioned archive format with explicit top-level entries.

### `manifest.json`

Contains:

- package format version,
- source peer id,
- source task id,
- sender Kanna version,
- created timestamp,
- agent provider,
- resume capability flags,
- repo acquisition mode,
- payload inventory,
- checksums.

### `task.json`

Portable task metadata:

- prompt,
- stage,
- display name,
- provider,
- agent type,
- base ref,
- port env,
- previous stage,
- source branch,
- provenance metadata.

This file must not contain source-only absolute paths or local daemon session ids.

### `repo/`

Repo acquisition metadata plus fallback content when direct reconstruction is unavailable.

Primary path:

- remote URL,
- default branch,
- required refs or commits.

Fallback path:

- source-provided repo bundle or source snapshot when the destination cannot obtain the repo directly.

### `worktree/`

Worktree payload describing the task branch state:

- branch metadata,
- tracked file content,
- untracked files,
- executable bits,
- minimal metadata needed to reconstruct the working tree cleanly.

### `terminal/`

Final terminal recovery snapshot:

- serialized VT state,
- cols,
- rows,
- cursor row,
- cursor col,
- cursor visibility,
- sequence metadata.

### `agent/`

Provider-specific resume metadata.

Claude:

- resume UUID,
- any local history artifacts needed by the CLI to attach to the same session.

Copilot:

- resume UUID,
- any local history artifacts needed by the CLI to attach to the same session.

Codex:

- provider metadata when available,
- no automatic agent resume requirement in v1.

## Resume Semantics

Import has three distinct outcomes:

- `full_resume`: task, terminal state, and provider session resumed.
- `task_restored_agent_resume_pending`: task and terminal restored, provider launched, resume not yet confirmed.
- `task_restored_manual_resume`: task and worktree restored, but agent could not be resumed automatically.

Claude and Copilot should target `full_resume`. Codex should restore the task and terminal context, but v1 should not depend on automatic provider resume.

## Source And Destination State Changes

### Source on success

- mark transfer history entry successful,
- mark original task transferred and close it locally,
- keep provenance of the destination peer and transfer id.

### Source on failure

- leave original task local,
- surface the failure phase to the user,
- do not mark ownership transferred.

### Destination on success

- create a new local task row,
- create a new local worktree row,
- create a new local terminal session row,
- link imported provenance,
- show the imported task in the UI.

### Destination on failure

- roll back partial DB state,
- remove partial worktree materialization if safe,
- leave no visible half-imported task.

## Error Handling

Transfers should fail explicitly by phase:

- discovery failure,
- pairing failure,
- preflight rejection,
- source stop failure,
- terminal snapshot capture failure,
- repo acquisition failure,
- package integrity failure,
- import restore failure,
- provider resume failure,
- acknowledgment or cutover failure.

The system invariant is:

- no source task is closed until the destination import is committed,
- no destination task is visible until its import is committed.

## File And Responsibility Changes

- `crates/task-transfer/`
  - new sidecar for Bonjour, pairing, encrypted transport, and package streaming.
- `apps/desktop/src-tauri/src/commands/transfer.rs`
  - new Tauri transfer commands.
- `apps/desktop/src/stores/kanna.ts`
  - outgoing transfer orchestration, incoming transfer handling, and UI-facing progress integration.
- `packages/db/src/schema.ts`
  - peer and transfer metadata types.
- `packages/db/src/queries.ts`
  - peer, transfer, and provenance queries.
- `apps/desktop/src/components/`
  - peer picker, pairing approval modal, incoming transfer modal, and progress UI.
- daemon recovery integration
  - import path seeds terminal snapshots into the existing recovery store and reuses current recovery commands.

## Testing

### Unit tests

- peer trust record creation and revocation,
- manifest validation,
- repo acquisition decision rules,
- provenance mapping from source ids to destination ids,
- package integrity validation,
- provider capability negotiation.

### Integration tests

Run with two local transfer-sidecar instances:

- Bonjour discovery sees peers,
- pairing succeeds with matching codes,
- untrusted peer requires approval,
- trusted peer auto-accepts,
- source stop failure aborts export,
- destination import failure leaves source task untouched,
- remote clone path succeeds,
- repo fallback bundle path succeeds,
- terminal snapshot round-trips,
- Claude resume metadata round-trips,
- Copilot resume metadata round-trips.

### Desktop end-to-end tests

- pair a peer from the UI,
- push a task,
- accept an incoming task,
- imported task appears locally,
- source task closes only after success.

The deepest reliability coverage should live in Rust integration tests around the transfer sidecar and import/export orchestration. Browser-only tests are not sufficient for Bonjour and encrypted streaming behavior.

## Notes

- The design intentionally keeps task transfer separate from the existing mobile relay path because migration is an ownership-transfer problem, not a read-only remote-control problem.
- Repo remote reconstruction is the default because it is cheaper and simpler than shipping whole repositories on every transfer.
- Source-sent repo data remains necessary as a fallback for local-only or unreachable repos.
