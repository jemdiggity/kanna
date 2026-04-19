# Transfer Identity And Bonjour Packaging Design

## Goal

Make LAN task transfer present peers as stable machines instead of transient process instances, and ensure the packaged macOS app has the Bonjour/local-network metadata required for peer discovery.

## Scope

- Persist a stable transfer peer identity for this Kanna app data directory.
- Resolve a single user-facing machine label for transfer discovery.
- Pass stable peer identity and display name into the transfer sidecar when it starts.
- Keep Bonjour service identity and human-facing display concerns separate.
- Add required macOS bundle metadata for Bonjour/local-network access.

## Non-Goals

- No editable machine nickname UI in this slice.
- No change to transfer protocol semantics beyond the existing `display_name` payload value.
- No change to pairing, trust, or transfer package structure.
- No change to source stop/finalize semantics in this slice.

## Current Problem

The transfer runtime currently falls back to PID- and port-derived defaults when `KANNA_TRANSFER_PEER_ID` and `KANNA_TRANSFER_DISPLAY_NAME` are not provided. That makes peers show up as unstable names like `Kanna 12711` and gives them unstable identities across restarts. Pairing should be machine-scoped and durable, not process-scoped.

The runtime itself already uses Bonjour/mDNS discovery, but the packaged macOS bundle does not currently declare Bonjour service types or local-network usage text in `Info.plist`. That risks discovery failures or confusing system prompts in signed end-user builds.

## Core Decisions

### Stable identity is separate from display

Transfer identity should be a stable opaque identifier persisted under Kanna app data. It should not be derived from process id, port, or any current runtime detail.

The user-facing label should remain separate from that identity. Bonjour service identity stays technical; presentation stays human-readable.

### One user-facing display label

Kanna should keep using a single `display_name` value in transfer discovery metadata and UI. That label should be resolved as:

1. user-defined nickname, if present
2. otherwise the machine/computer name

This keeps the protocol surface small and avoids inventing parallel discovery fields that the app does not yet need.

### Bonjour service instance remains technical

The Bonjour service instance name should continue to derive from the stable `peer_id`, not from the machine label. This avoids renaming churn, duplicate labels, and ambiguity when multiple Kanna instances or renamed machines are present.

### macOS bundle metadata is required

The packaged app must declare:

- `NSBonjourServices` including `_kanna-xfer._tcp`
- `NSLocalNetworkUsageDescription`

Without these keys, a signed macOS build may not discover peers reliably even if the Rust runtime is correct.

## Design

### Stable transfer identity storage

Add a small app-data-backed transfer identity record owned by the Tauri layer. This record should live in the app data directory so it is scoped to the current Kanna instance and survives restarts.

The stored fields should be:

- `peer_id`
- optional `nickname`

If no record exists yet, the app should generate a new opaque `peer_id`, persist it, and reuse it for all later sidecar launches.

### Display name resolution

When spawning the transfer sidecar, the app should resolve `display_name` as:

- stored nickname when present and non-empty
- otherwise the local machine/computer name
- otherwise a conservative fallback such as `Kanna`

This resolution should happen in the Tauri layer so the sidecar receives explicit, stable values instead of inventing its own defaults.

### Sidecar environment wiring

The Tauri transfer-sidecar wrapper should pass:

- `KANNA_TRANSFER_PEER_ID`
- `KANNA_TRANSFER_DISPLAY_NAME`

on every spawn.

This keeps the runtime deterministic and removes PID-based naming from normal app operation.

### Bonjour payload shape

Keep the current discovery payload shape:

- service type `_kanna-xfer._tcp.local.`
- service instance name based on `peer_id`
- TXT metadata containing `peer_id`, `display_name`, `public_key`, `protocol_version`, and `accepting_transfers`

No extra TXT fields are needed in this slice.

### macOS bundle metadata

Extend the checked-in `Info.plist` fragment so the packaged app declares:

- `NSBonjourServices`
  - array entry: `_kanna-xfer._tcp`
- `NSLocalNetworkUsageDescription`
  - short end-user explanation that Kanna uses the local network to discover nearby machines for task transfer

These keys should be shipped through the existing Tauri macOS `infoPlist` override path.

## File And Responsibility Changes

- `apps/desktop/src-tauri/src/transfer_sidecar.rs`
  - resolve persisted transfer identity and machine label before spawning the sidecar
  - pass stable `KANNA_TRANSFER_PEER_ID` and `KANNA_TRANSFER_DISPLAY_NAME`
- `apps/desktop/src-tauri/src/commands/fs.rs` or a small adjacent Tauri helper module
  - provide app-data-backed transfer identity persistence helpers if needed
- `apps/desktop/src-tauri/src/lib.rs`
  - own any transfer identity state wiring if shared app setup is cleaner there
- `apps/desktop/src-tauri/Info.plist`
  - add Bonjour/local-network usage metadata for packaged macOS builds

## Testing

### Rust / Tauri tests

- generating a transfer identity when no record exists
- reusing the same `peer_id` across subsequent launches
- display-name resolution order:
  - nickname
  - machine/computer name
  - fallback
- sidecar spawn receives explicit `KANNA_TRANSFER_PEER_ID` and `KANNA_TRANSFER_DISPLAY_NAME`

### Config assertions

- `Info.plist` includes `_kanna-xfer._tcp`
- `Info.plist` includes `NSLocalNetworkUsageDescription`

## Risks

- machine-name lookup can vary by environment or be unavailable in tests
- introducing identity persistence in the wrong location could couple transfer identity to transient cwd state instead of app data
- changing discovery labels without stable identity would make trust records harder to reason about

## Mitigation

- keep `peer_id` app-data-backed and explicit
- treat machine-name lookup as best effort with a simple fallback
- keep one human-facing `display_name` field and do not overload service identity with presentation concerns
