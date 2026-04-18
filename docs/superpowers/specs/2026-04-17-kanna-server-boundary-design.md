# Kanna Server Boundary Design

Date: 2026-04-17
Status: Proposed
Scope: Stabilize `kanna-server` as the mergeable desktop-side service boundary for mobile and future CLI consumers

## Summary

`kanna-server` should be treated as the desktop-side service boundary for non-desktop consumers.
It sits between consumers such as the React Native mobile app and the internal desktop subsystems that own PTY sessions, task state, and persistence.

The immediate goal is not to finish every consumer or every UX flow.
The goal is to make `kanna-server` reasonable, stable, documented, and mergeable so downstream work such as `kanna-cli` can target it with confidence.

The architecture remains:

`consumer -> kanna-server -> daemon / DB`

This design keeps the merge target intentionally narrow:

- stabilize the current HTTP and WebSocket surface
- make bootstrap and local LAN development deterministic
- document the service boundary
- keep consumer-side changes limited to what is required to exercise that boundary

## Goals

- Make `kanna-server` the explicit desktop-side service boundary for non-desktop consumers.
- Preserve a clean split between consumer-facing API behavior and internal daemon/DB implementation details.
- Ship a mergeable PR with stable route behavior, config loading, and local bootstrap.
- Ensure the current React Native app proves the boundary without becoming the architectural center of the PR.
- Leave `kanna-server` in a state that a future `kanna-cli` consumer can target without redesigning the service.

## Non-Goals

- Extracting the TypeScript mobile client into a shared package in this PR.
- Shipping the first `kanna-cli` consumer in this PR.
- Finishing all remote/cloud behavior or account-linked routing.
- Solving mobile UI polish, shell layout, or interaction details beyond what is needed to validate the server boundary.
- Replacing the daemon protocol with a public client protocol.

## Current State

`kanna-server` already exists and already performs the essential role this design wants to stabilize.

It currently owns:

- LAN HTTP status and task routes
- a WebSocket terminal stream route
- task actions that combine daemon and DB work
- pairing session creation
- relay-side handling for remote invocation

The desktop app already auto-starts `kanna-server`.
The React Native app already consumes its LAN API for current mobile flows.
Recent work has expanded the route surface to include:

- recent tasks
- repo-scoped task lists
- search
- create task
- send task input
- close task
- advance stage
- run merge agent
- terminal streaming

The remaining work is not inventing the server boundary.
It is tightening that boundary enough that it can be merged as an intentional service layer rather than as incidental mobile plumbing.

## Architecture

### Boundary

`kanna-server` is the only desktop-side service boundary that mobile and future CLI consumers should talk to.
Consumers must not talk directly to:

- the raw daemon protocol
- desktop Pinia/Vue state
- Tauri UI commands that bypass the service boundary

The service owns translation from internal data and daemon behavior into product-facing resources and actions.

### Responsibilities

`kanna-server` should own:

- config loading and process bootstrap
- HTTP and WebSocket transport
- route-level validation and request shaping
- DB-backed resource listing and search
- daemon-backed session actions
- task lifecycle actions that need both daemon and DB operations
- pairing and LAN availability state

The daemon remains an internal PTY/session subsystem.
The DB remains the persistence layer.
Neither should become the public contract boundary for non-desktop consumers.

### Consumer Model

The service should support multiple consumers over time:

- the React Native mobile app
- future `kanna-cli` commands
- any later internal tooling that needs the same task-control boundary

That does not require a generated multi-language contract in this PR.
It does require that the current route surface, request/response shapes, and startup behavior are explicit and stable.

## API Surface

The merge target is the current product-facing route set that already exists in `kanna-server`.
This design treats that set as the v1 server boundary for downstream consumers.

### Core Routes

- `GET /v1/status`
- `GET /v1/desktops`
- `GET /v1/repos`
- `GET /v1/repos/{repo_id}/tasks`
- `GET /v1/tasks/recent`
- `GET /v1/tasks/search`
- `POST /v1/tasks`
- `GET /v1/tasks/{task_id}/terminal` (WebSocket)
- `POST /v1/tasks/{task_id}/input`
- `POST /v1/tasks/{task_id}/actions/close`
- `POST /v1/tasks/{task_id}/actions/advance-stage`
- `POST /v1/tasks/{task_id}/actions/run-merge-agent`
- `POST /v1/pairing/sessions`

### Resource Model

The API should stay product-oriented rather than daemon-oriented.
Consumers should think in terms of:

- desktops
- repos
- tasks
- terminal streams
- task actions
- pairing state

The API should not expose daemon-specific details as the primary model.

### Error Handling

Route handlers should return clear failures at the correct layer:

- DB failures should surface as server errors with DB context.
- Daemon failures should surface as server errors with daemon context.
- Missing required inputs should fail at the route boundary, not deeper in daemon code.
- Unexpected daemon replies should be treated as server errors, not silently tolerated.

The current pattern in `http_api.rs` is acceptable as long as it remains consistent and fully covered by tests.

## Bootstrap And Configuration

### Server Startup

The desktop app remains responsible for starting `kanna-server`.
This PR should keep that path simple:

- desktop app writes or resolves the config
- desktop app starts `kanna-server`
- `kanna-server` exposes LAN status and routes

No new startup indirection should be introduced.

### Config Loading

`kanna-server` configuration should remain explicit and deterministic.
The required outcome is:

- stable config-file loading
- stable DB path normalization
- stable LAN host and LAN port defaults
- stable pairing-store path behavior

The current `Config::load()` shape is acceptable if it remains clearly documented and well-tested.

### Local Development

Local development needs a deterministic path for launching the mobile app against the server.
That means:

- `dev.sh --mobile` should start the Expo dev server
- the Expo process should receive the server URL through environment configuration
- the default mobile port should come from `.kanna/config.json`
- the default server URL should be derivable for local development, with explicit override support

This bootstrap work belongs in the PR because it is part of making the server boundary usable in practice.

## Testing

This PR should bias toward server-facing verification rather than UI-facing verification.

### Required Server Verification

- `cargo test -p kanna-server -- --nocapture`
- `cargo clippy -p kanna-server --all-targets -- -D warnings`

### Route Coverage Expectations

Each currently supported route should have direct route-level or API-level coverage for its expected success path.
Test-only hooks in `http_api.rs` are acceptable for this PR because they keep route behavior directly testable without requiring full daemon integration in every test.

### Consumer/Bootstrap Verification

The mobile app and scripts should only be verified to the extent they prove the boundary is usable:

- `pnpm --dir apps/mobile run typecheck`
- `pnpm --dir apps/mobile test -- --runInBand ...focused suite...`
- `bash scripts/dev.sh.test.sh`

These checks are not the primary deliverable, but they must stay green because they validate the current consumer path.

## Documentation

This PR should add a short server-boundary document describing:

- what `kanna-server` is responsible for
- where it sits relative to the daemon and DB
- the current LAN route surface
- how local consumers are expected to reach it
- that future consumers such as `kanna-cli` are expected to target this same boundary

The doc should be concise.
It does not need to become a full OpenAPI-style contract document in this PR.

## PR Shape

### In Scope

- `crates/kanna-server`
- minimal desktop bootstrap/config changes needed by `kanna-server`
- minimal React Native bootstrap/config changes needed to hit the server cleanly
- short service-boundary documentation

### Out Of Scope

- shared TypeScript client extraction
- `kanna-cli` integration
- mobile screen polish
- remote/cloud product completion
- large daemon refactors unrelated to the service boundary

## Acceptance Criteria

The PR is ready to merge when:

- the current `kanna-server` route set is stable and tested
- local bootstrap for the mobile consumer is deterministic
- the server is clearly documented as the desktop-side consumer boundary
- server verification passes cleanly
- consumer/bootstrap verification remains green
- no known currently exposed route is left broken

## Follow-On Work

After this PR lands, the next likely follow-on changes are:

- extract the current TypeScript client and transport into a shared package
- adopt the same server boundary from `kanna-cli`
- expand the contract/documentation story if multiple consumers start diverging
- continue remote/cloud hardening separately from the mergeable LAN/server-boundary work
