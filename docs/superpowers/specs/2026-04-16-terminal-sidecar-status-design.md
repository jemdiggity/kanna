# Terminal Sidecar Status Detection Design

## Goal

Replace raw PTY chunk scanning for agent task status detection with sidecar-driven status derived from the daemon's live Ghostty terminal model.

## Problem

Current status detection in `crates/daemon/src/status.rs` infers `busy`, `idle`, and `waiting` from recent output chunks. That is fragile for redraw-heavy TUIs such as Codex because a later repaint chunk can contain the prompt glyph without re-sending the still-visible busy footer. The result is false `idle` transitions while the rendered screen still shows `esc to interrupt`.

The daemon already maintains a live terminal model per session via `TerminalSidecar`, and the recovery service also maintains a mirrored screen for persistence. Status should come from currently visible terminal content, not from history-dependent chunk heuristics.

## Decision

Use `TerminalSidecar` as the daemon's single live source of truth for agent status. After each PTY output write, the daemon will derive status from the rendered bottom rows of the sidecar and emit `StatusChanged` only on transitions.

`crates/daemon/src/status.rs` and its flush thread will be removed.

## Scope

This change covers daemon-side live status detection and event emission for task terminals. It does not change the frontend event contract and does not change the recovery service protocol.

The frontend will continue listening to the existing `status_changed` event. Recovery attach replay logic remains in place so late attachers receive the current daemon status.

## Architecture

### Live Source Of Truth

`TerminalSidecar` already mirrors PTY output and can snapshot the current screen. Extend it with a small API that returns normalized visible footer text from the bottom rendered rows.

The daemon session mirror path will:

1. write PTY output into the sidecar
2. ask the sidecar for visible footer text
3. derive agent status from that visible footer
4. update session status and emit `StatusChanged` on transitions

### Provider Rules

Codex:
- `busy` when visible footer text contains `esc to interrupt`
- `waiting` when visible footer text contains `Do you want to allow`
- `idle` when the footer shows the Codex prompt glyph and does not show the busy marker

Claude:
- preserve current visible-content semantics, but derive them from sidecar footer text instead of raw chunk history
- approval prompt still maps to `waiting`

Copilot:
- preserve current visible-content semantics
- if no stable busy footer can be rendered from the sidecar, keep a minimal provider-specific fallback only if needed after verification

### Event Model

No new frontend events are needed. The daemon will continue to emit `StatusChanged`, and attach replay will continue to send the current session status after `Attach` and `AttachSnapshot`.

## Error Handling

If the sidecar cannot produce footer text for a given frame, the daemon should keep the previous status rather than forcing a transition. Detection failure must degrade to "no change", not false `idle`.

## Testing

Add unit tests covering:
- Codex remains `busy` while the visible footer still contains `esc to interrupt`
- Codex becomes `idle` only when the visible busy marker disappears from the rendered footer
- attach and attach-snapshot still replay current status

Add daemon integration coverage where practical for live attach behavior.

## Consequences

Benefits:
- status is based on rendered screen truth instead of brittle chunk ordering
- Codex redraws stop producing false idle transitions
- the daemon has one live status source of truth

Tradeoffs:
- status detection now depends on the sidecar API surface
- if sidecar rendering semantics change, status tests must catch regressions
