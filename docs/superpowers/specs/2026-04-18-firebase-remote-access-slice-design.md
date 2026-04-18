# Firebase Remote Access Slice Design

Date: 2026-04-18
Status: Proposed
Scope: First cloud slice for secure user-linked remote access to desktop-owned `kanna-server` instances using Firebase

## Summary

Kanna should add a thin cloud control plane without changing the core ownership model:
the desktop-side daemon and `kanna-server` remain the systems that own task execution, terminal sessions, and local state.
Mobile does not execute agent work.
Cloud exists to authenticate users, register desktops, pair a desktop to a user account, expose a user-scoped desktop list, and provide the minimum remote-control foundation required for later internet access.

The recommended architecture is:

`mobile / kanna-cli -> cloud control plane -> desktop-side kanna-server -> daemon / DB`

The first slice must stay intentionally small.
It should prove that:

- a user can authenticate
- multiple desktops can be registered under one user
- a desktop can be securely paired and revoked
- mobile can discover the user’s desktops
- a remote request can be routed to a specific registered desktop through a minimal broker envelope

It should not try to ship full remote task execution parity, terminal streaming parity, billing, teams, or cloud-hosted agent execution.

## Goals

- Add user identity for remote access using Firebase Auth.
- Add a durable desktop registry that supports multiple desktops per user from day one.
- Define a secure pairing flow that links a desktop to the authenticated user who claims it.
- Keep the desktop-side `kanna-server` as the API boundary that mobile and future `kanna-cli` consumers talk to logically.
- Add a minimal internet-mode command path that can later proxy remote commands to a registered desktop.
- Preserve LAN access as a direct, free path that does not depend on cloud availability.
- Keep the implementation thin, understandable, and incremental.

## Non-Goals

- Full billing, subscriptions, entitlements, or metering.
- Full task-control parity over the internet.
- Terminal streaming, PTY multiplexing, or interactive remote shell parity in this slice.
- Teams, orgs, shared workspaces, or cross-user desktop sharing.
- Generalized backend platform abstractions.
- Cloud-hosted agent execution.
- Replacing `kanna-server` with a cloud-native API.

## Product Boundary

### Core Principle

The desktop remains the thing being remotely manipulated.
Cloud does not become the execution environment for this slice.
Cloud is a control plane and a thin routing layer.

### User Experience Boundary

Users should be able to:

- sign into mobile
- pair one or more desktops to their account
- see a list of their desktops
- see whether a desktop is online / reachable
- issue at least one minimal remote request against a specific desktop through the cloud path

Users should not yet expect:

- full remote task lifecycle control
- full terminal session access
- a cloud-only workflow with no desktop online

## Recommended Firebase Architecture

### Firebase Services

- **Firebase Auth** for user identity
- **Cloud Firestore** for durable user, desktop, pairing, revocation, and last-known presence state
- **Cloud Functions for Firebase** for pairing-code creation, pairing-code claim, desktop registration finalization, revocation, and short-lived remote session token minting

### Development Environment

This slice should be developed against the **Firebase Local Emulator Suite** by default.

That means local development and automated testing should target:

- the Auth emulator
- the Firestore emulator
- the Functions emulator

Production Firebase projects should not be required for routine development of pairing, registry, revocation, or presence flows.
The emulator-first requirement keeps the cloud slice cheap to iterate on, deterministic in worktrees, and safe to test without touching shared remote state.

### Non-Firebase Component

Firebase should not be forced to serve as the real-time desktop transport.
This slice should add a **thin remote broker** alongside Firebase.

That broker is responsible for:

- accepting outbound authenticated connections from registered desktops
- accepting authenticated remote requests from mobile
- routing minimal request/response envelopes to a specific desktop
- reporting last-known connection state back into Firestore

The broker should stay intentionally narrow.
It is not a general backend, business-logic layer, or API replacement for `kanna-server`.

### Why Not Firestore Polling

Firestore is appropriate for durable ownership state and last-known status.
It is not the right primary transport for remote control because:

- polling is slow and expensive
- request/response semantics are awkward
- future terminal streaming would be a poor fit
- command acknowledgement and backpressure become unclear

If a Firestore-backed command queue ever exists, it should be a fallback or deferred command path, not the primary transport.

### Local Development Shape

The intended local development shape is:

`mobile / local cli / desktop kanna-server -> Firebase emulators + local broker`

The broker should also run locally in development.
The important boundary is that Firebase-backed flows should be exercised against emulated Auth, Firestore, and Functions services rather than mocked away inside each client.

## Authentication Model

### User Identity

Use Firebase Auth for human identity.

Recommended providers:

- **Sign in with Apple** as the iPhone-first primary provider
- **Email link** as a fallback

The authenticated principal for product access is the Firebase `uid`.

### Desktop Identity

Do not model the desktop as a second human account.
Model it as a registered device owned by exactly one user.

The desktop should authenticate to the cloud using:

- `desktopId`
- a server-issued opaque `desktopSecret`

The secret should be stored locally by `kanna-server` and only a hash should be stored server-side.

This is simpler and more appropriate for a device credential than trying to fit the desktop into Firebase Auth as if it were a user.

## Data Model

### `users/{uid}`

Purpose: thin user shell.

Fields:

- `createdAt`
- `lastSeenAt`
- `primaryEmail`
- `authProviders`

This document should remain intentionally small.

### `users/{uid}/desktops/{desktopId}`

Purpose: authoritative desktop registry.

Fields:

- `desktopId`
- `displayName`
- `platform`
- `appVersion`
- `protocolVersion`
- `registeredAt`
- `lastSeenAt`
- `lastHeartbeatAt`
- `connectionMode` with values such as `"lan"`, `"internet"`, or `"both"`
- `lanHint` optional object:
  - `host`
  - `port`
  - `updatedAt`
- `presence` snapshot object:
  - `online`
  - `reachableViaRelay`
  - `lastRelaySeenAt`
- `revokedAt` nullable
- `revocationReason` nullable

This collection is the source of truth for “which desktops belong to this user?”

### `pairingCodes/{pairingCodeId}`

Purpose: short-lived claim records used during pairing.

Fields:

- `desktopId`
- `desktopDisplayName`
- `desktopClaimTokenHash`
- `desktopNonce`
- `createdAt`
- `expiresAt`
- `status` with values `"pending"`, `"claimed"`, `"expired"`, `"cancelled"`
- `claimedByUid` nullable
- `claimedAt` nullable

This collection is ephemeral and single-use.
Documents should expire quickly and never become the long-term trust record.

### `desktopPresence/{desktopId}`

Purpose: last-known presence and broker connectivity snapshot.

Fields:

- `uid`
- `online`
- `reachableViaRelay`
- `lastSeenAt`
- `brokerConnectionId`

This may remain separate from the desktop registry so write-heavy presence updates do not constantly rewrite the durable desktop document.
The desktop registry can still embed a last-known presence summary for simple reads.

### Optional: `users/{uid}/desktops/{desktopId}/auditEvents/{eventId}`

Purpose: trust and revocation history.

Fields:

- `type`
- `createdAt`
- `actor`
- `metadata`

This is useful but not required for the first mergeable slice.

## What Goes In Firestore Vs What Stays Ephemeral

### Store In Firestore

- user ownership
- desktop registry
- pairing-code records
- revocation state
- last-known LAN hints
- last-known presence snapshots
- short trust / audit records if desired

### Keep Ephemeral

- active broker connection state
- live command/response transit
- live terminal output
- in-flight terminal input
- long-lived stream fanout

The boundary is simple:
Firestore is for durable ownership and lookup state.
The broker is for live routing.

## Pairing Model

### Pairing Goals

The pairing flow must:

- prove that the person claiming the desktop is an authenticated user
- prove that the desktop being claimed is the one showing the short-lived code
- produce a durable desktop credential that can later authenticate to the broker
- support multiple desktops per user without ambiguity

### Pairing Flow

#### 1. Desktop Requests A Pairing Session

The desktop-side `kanna-server` calls a privileged cloud endpoint:

- `POST /v1/auth/pairing-codes`

The response contains:

- `pairingCode`
- `pairingCodeId`
- `desktopId`
- `desktopClaimToken`
- `expiresAt`

The desktop shows the short pairing code locally.

#### 2. Mobile Claims The Pairing Code

The mobile app is already authenticated with Firebase.
It calls:

- `POST /v1/auth/pairing-codes/claim`

with:

- `pairingCode`

The backend validates:

- the code exists
- it is unexpired
- it has not already been claimed

It then marks the pairing code as claimed by `uid`, but pairing is not complete until the desktop finalizes.

#### 3. Desktop Finalizes Registration

The desktop calls:

- `POST /v1/desktops/finalize-registration`

with:

- `desktopId`
- `pairingCodeId`
- `desktopClaimToken`
- proposed desktop metadata

The backend verifies the token hash stored with the pairing code, confirms the claim belongs to the expected `uid`, creates the desktop registry document, issues a `desktopSecret`, stores only a secret hash server-side, and returns the new credential to the desktop.

#### 4. Desktop Begins Presence And Broker Connectivity

The desktop stores:

- `desktopId`
- `desktopSecret`

It then heartbeats to cloud and opens its outbound broker connection.

### Why Finalization Is Separate

Claiming the short code from mobile should not itself be enough to mint a desktop credential.
That would let anyone who guessed or intercepted a code complete registration without desktop proof.
The desktop must prove possession of the cloud-issued `desktopClaimToken`.

## Desktop Discovery

Mobile discovers desktops by reading the authenticated user’s desktop registry:

- `GET /v1/desktops`

The returned shape should be user-oriented:

- `desktopId`
- `displayName`
- `platform`
- `online`
- `reachableViaRelay`
- `lanHint`
- `lastSeenAt`
- `connectionMode`

The desktop list must support multiple desktops from the start.
There should be no “the user’s desktop” singular model in the API or data layer.

## Trust And Revocation

### Trust Model

The durable trust record is:

- a desktop registry document under `users/{uid}/desktops/{desktopId}`
- an active, non-revoked desktop credential

The short pairing code is not a trust record.
It is only a temporary handoff step.

### Revocation Flow

Mobile calls:

- `POST /v1/desktops/{desktopId}/revoke`

The backend:

- verifies desktop ownership
- sets `revokedAt`
- records `revocationReason`
- rotates or invalidates the `desktopSecret`
- invalidates any outstanding remote session tokens
- tells the broker to drop the active desktop connection if one exists

After revocation, the desktop must be re-paired from scratch.

### Local Forget Vs Real Revocation

The mobile app may offer a local “forget” affordance later, but the real security boundary is server-side revocation.
If trust is broken, the credential must be invalidated in cloud state.

## Remote API Direction

### Canonical Boundary

`kanna-server` remains the canonical desktop API boundary.
The cloud path should preserve its resource and action vocabulary where practical.

That means remote consumers should still think in terms of:

- desktops
- repos
- tasks
- actions
- terminal/session resources later

### LAN Mode

LAN mode remains:

`mobile -> desktop kanna-server`

No cloud dependency is required for free local access.

### Internet Mode

Internet mode becomes:

`mobile -> cloud broker envelope -> desktop kanna-server`

The broker is not the product API.
It is a transport wrapper carrying requests to the actual desktop-side API owner.

## Minimal API Contract For This Slice

### Cloud Control Plane Endpoints

- `POST /v1/auth/pairing-codes`
- `POST /v1/auth/pairing-codes/claim`
- `POST /v1/desktops/finalize-registration`
- `GET /v1/desktops`
- `GET /v1/desktops/{desktopId}`
- `POST /v1/desktops/{desktopId}/revoke`
- `POST /v1/desktops/{desktopId}/connect-token`

### Minimal Broker Envelope

The broker should speak a thin request/response envelope that mirrors `kanna-server` semantics instead of inventing a second product model.

Request:

```json
{
  "type": "invoke",
  "id": "req_123",
  "desktopId": "desktop_abc",
  "method": "GET",
  "path": "/v1/status",
  "body": null
}
```

Response:

```json
{
  "type": "response",
  "id": "req_123",
  "status": 200,
  "body": {
    "state": "running"
  }
}
```

Reserved for later:

```json
{
  "type": "event",
  "name": "terminal_output",
  "payload": {}
}
```

### Minimum Remote Request Surface

This slice should only require one true remote request to prove the foundation:

- `GET /v1/status`

If that works cleanly, the next safe additions are:

- `GET /v1/repos`
- `GET /v1/tasks/recent`

These are read-heavy and low-risk.
They validate routing and ownership without prematurely opening task mutation or terminal transport.

### Parity Gaps That Are Acceptable

The following parity gaps are acceptable and intentional in this slice:

- cloud pairing internals do not have to match LAN pairing routes exactly
- desktop discovery in internet mode comes from cloud registry state, not from a local desktop scan
- terminal routes are deferred
- mutation-heavy task actions are deferred

Those differences are acceptable because they keep the transport and trust model correct.

## Security Rules And Access Control

### Firestore Rules Direction

Client SDK access should be limited to user-owned documents.

Allow authenticated users to read:

- `users/{uid}`
- `users/{uid}/desktops/{desktopId}`

only when `request.auth.uid == uid`.

Do not let clients directly create or mutate:

- pairing code documents
- desktop registration documents during pairing
- presence documents
- desktop credential state

Those writes should go through privileged Functions / endpoints so ownership checks, token validation, and secret issuance happen atomically.

Firestore rules must be exercised in emulator-backed tests, not treated as documentation-only intent.

### Broker Access Control

Mobile must present:

- Firebase-authenticated identity
- a short-lived remote session token minted for a specific `desktopId`

Desktop must present:

- `desktopId`
- valid `desktopSecret`

The broker should verify both sides and only connect requests where:

- the user owns the desktop
- the desktop is not revoked
- the short-lived session token is valid

### Attack Surface Constraints

Keep the public surface narrow:

- no public desktop registration without a valid pairing session
- no desktop access by only `desktopId`
- no direct client writes to ownership documents
- no remote terminal or mutation APIs in the first slice
- rate-limit pairing creation and claim

## Desktop-Side Changes Required Later

To participate in this model, the desktop-side `kanna-server` will need to add:

- local persistence for `desktopId` and `desktopSecret`
- pairing-code request flow
- pairing finalization flow
- heartbeat / presence updates
- outbound authenticated broker connection
- a minimal request dispatcher that can serve a broker envelope by routing to the existing `kanna-server` handlers or equivalent internal command paths

The important architectural constraint is that these additions extend `kanna-server`.
They should not create a parallel remote-control subsystem with different product semantics.

## Staged Implementation Plan

### Stage 1: Identity, Pairing, Registry, Presence

Deliver:

- Firebase Auth in mobile
- Firebase emulator wiring for local development and tests
- pairing-code issuance and claim
- desktop registration finalization
- user-scoped desktop registry
- desktop revocation
- desktop presence / heartbeat
- mobile desktop list from Firestore

Do not deliver:

- remote task APIs
- terminal transport

### Stage 2: Minimal Remote Query Path

Deliver:

- thin broker
- local broker wiring that works alongside the Firebase emulator suite
- desktop outbound authenticated connection
- mobile short-lived connect token
- remote `GET /v1/status`

Optional additions if Stage 2 is stable:

- `GET /v1/repos`
- `GET /v1/tasks/recent`

### Stage 3: Low-Risk Read Surfaces

Deliver:

- repo task lists
- task search
- additional desktop status metadata

Still defer:

- terminal streaming
- interactive input
- mutation-heavy task actions

### Stage 4: Rich Remote Control

Deliver later:

- terminal stream routing
- task input forwarding
- broader API parity
- `kanna-cli` reuse of the same remote envelope

## Risks And Unknowns

- Firebase is a strong fit for identity and durable state, but not for the live desktop transport by itself.
- Desktop credential storage and rotation must be done carefully on the local machine.
- Firestore presence writes may need tuning if heartbeat frequency becomes high.
- Emulator parity is good enough for this slice, but auth-provider edge cases such as Sign in with Apple token exchange may still need a small amount of production-project verification before release.
- The current relay prototype assumes one server connection per user; that model must be replaced with one user, many desktops.
- Remote session-token minting and broker authorization need careful expiry and replay protection.
- LAN and internet discovery will not be identical internally even if the product-level desktop model remains aligned.

## Recommendation

Ship only the first sub-project in this spec:

- Firebase Auth
- desktop registry
- secure pairing
- revocation
- presence
- one minimal remote `GET /v1/status` query path

That is the thinnest useful cloud foundation.
It proves the ownership model, the multi-desktop model, and the future routing model without overcommitting Kanna to a premature backend platform.
