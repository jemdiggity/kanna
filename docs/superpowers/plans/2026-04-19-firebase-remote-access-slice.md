# Firebase Remote Access Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Firebase-backed remote access slice for Kanna: emulator-first auth, desktop registration, secure pairing, presence, desktop discovery, and one minimal remote `GET /v1/status` internet path.

**Architecture:** Keep `kanna-server` as the desktop-owned API boundary and add a thin Firebase-backed control plane around it. Firestore owns durable user and desktop state, Cloud Functions own privileged pairing and token minting flows, and a thin relay continues to route live remote requests to a specific registered desktop. Local development runs against the Firebase Local Emulator Suite plus a local relay.

**Tech Stack:** Firebase Auth, Firestore, Cloud Functions, Firebase Local Emulator Suite, Node/TypeScript relay, Rust `kanna-server`, React Native mobile app, Vitest, Cargo tests

**Spec:** `docs/superpowers/specs/2026-04-18-firebase-remote-access-slice-design.md`

---

## File Structure

### Firebase Emulator And Shared Cloud Config
- Create: `firebase.json` — emulator ports and Functions source config
- Create: `.firebaserc` — local project alias for emulator use
- Create: `services/firebase-functions/package.json` — Functions workspace package
- Create: `services/firebase-functions/tsconfig.json` — TS config for emulator-run Functions code
- Create: `services/firebase-functions/src/index.ts` — callable / HTTPS handlers for pairing, finalization, revocation, and connect-token minting
- Create: `services/firebase-functions/src/data.ts` — Firestore document helpers and typed data mappers
- Create: `services/firebase-functions/src/auth.ts` — auth extraction and ownership checks for Functions
- Create: `services/firebase-functions/src/secrets.ts` — desktop secret generation and hashing helpers
- Create: `services/firebase-functions/src/types.ts` — DTOs for cloud control-plane resources
- Create: `services/firebase-functions/test/pairing.test.ts` — emulator-backed pairing/finalization tests
- Create: `services/firebase-functions/test/revocation.test.ts` — emulator-backed revocation tests
- Modify: `package.json` — root scripts for emulator startup and test orchestration
- Modify: `pnpm-workspace.yaml` — ensure new Functions package is included

### Relay Refactor For Multiple Desktops
- Modify: `services/relay/package.json` — add emulator-aware test/dev scripts
- Create: `services/relay/src/firebase.ts` — centralized admin SDK initialization with emulator support
- Modify: `services/relay/src/auth.ts` — replace `device_token -> userId` lookup with `desktopId + desktopSecret` verification and ownership lookups
- Modify: `services/relay/src/router.ts` — route by `(uid, desktopId)` instead of one server connection per user
- Modify: `services/relay/src/index.ts` — add control-plane HTTP endpoints / token verification hooks needed for status routing
- Modify: `services/relay/test/integration.test.ts` — emulator-backed relay auth and multi-desktop routing coverage

### Desktop Registration And Presence In `kanna-server`
- Modify: `crates/kanna-server/src/config.rs` — add cloud config, emulator config, and persisted desktop credential fields
- Create: `crates/kanna-server/src/cloud_client.rs` — HTTPS client for Functions endpoints and broker session token requests
- Create: `crates/kanna-server/src/desktop_identity.rs` — local persistence and validation for `desktopId` / `desktopSecret`
- Modify: `crates/kanna-server/src/pairing.rs` — replace LAN-only trusted-device persistence with cloud pairing-code creation / finalization state
- Modify: `crates/kanna-server/src/http_api.rs` — expose cloud-aware pairing and status resources while preserving LAN shape where practical
- Modify: `crates/kanna-server/src/mobile_api.rs` — desktop summaries and status shapes for cloud and LAN modes
- Modify: `crates/kanna-server/src/main.rs` — heartbeat loop, broker registration, remote status dispatch wiring
- Modify: `crates/kanna-server/src/register.rs` — replace legacy device-token registration with pairing bootstrap and emulator-aware setup
- Create: `crates/kanna-server/tests/cloud_pairing.rs` — config + pairing finalization tests
- Create: `crates/kanna-server/tests/presence.rs` — heartbeat / registration tests

### Mobile Remote Discovery And Minimal Internet Status
- Create: `apps/mobile/src/lib/firebase/config.ts` — mobile Firebase config and emulator connection wiring
- Create: `apps/mobile/src/lib/firebase/auth.ts` — sign-in bootstrap and user session helpers
- Create: `apps/mobile/src/lib/transports/remoteTransport.ts` — remote desktop list and minimal remote status transport
- Modify: `apps/mobile/src/lib/api/types.ts` — expand desktop summary, status, and remote session token types
- Modify: `apps/mobile/src/lib/api/client.ts` — include remote desktop list / status methods while preserving current transport abstraction
- Modify: `apps/mobile/src/state/mobileController.ts` — choose LAN vs remote transport and store authenticated user state
- Modify: `apps/mobile/src/screens/ConnectionScreen.tsx` — sign-in / pairing / desktop discovery entry point
- Modify: `apps/mobile/src/screens/DesktopsScreen.tsx` — show multiple desktops with LAN vs internet availability
- Create: `apps/mobile/src/lib/firebase/auth.test.ts` — Firebase session and emulator wiring tests
- Create: `apps/mobile/src/lib/transports/remoteTransport.test.ts` — remote listing and status tests
- Modify: `apps/mobile/src/screens/DesktopsScreen.test.tsx` — multi-desktop presentation tests

### End-To-End And Documentation
- Modify: `scripts/dev.sh` — start Firebase emulators and relay in mobile/cloud mode
- Create: `scripts/firebase-dev.sh` — thin wrapper for emulator suite startup in worktrees
- Modify: `README.md` — local remote-access development instructions
- Create: `docs/firebase-emulator.md` — exact emulator ports, env vars, and reset instructions

---

### Task 1: Add Emulator-First Firebase Workspace Scaffolding

**Files:**
- Create: `firebase.json`
- Create: `.firebaserc`
- Create: `services/firebase-functions/package.json`
- Create: `services/firebase-functions/tsconfig.json`
- Create: `services/firebase-functions/src/index.ts`
- Create: `services/firebase-functions/src/types.ts`
- Create: `services/firebase-functions/test/pairing.test.ts`
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Write the failing emulator config test**

Create `services/firebase-functions/test/pairing.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { emulatorPorts } from "../src/types";

describe("firebase emulator configuration", () => {
  it("exposes the expected emulator ports for auth, firestore, and functions", () => {
    expect(emulatorPorts).toEqual({
      auth: 9099,
      firestore: 8080,
      functions: 5001,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir services/firebase-functions test -- pairing`
Expected: FAIL because `services/firebase-functions` does not exist yet

- [ ] **Step 3: Create the Firebase workspace package**

Create `services/firebase-functions/package.json`:

```json
{
  "name": "@kanna/firebase-functions",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "firebase-admin": "^13.0.0",
    "firebase-functions": "^6.2.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^4.1.4"
  }
}
```

Create `services/firebase-functions/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

If `tsconfig.base.json` does not exist, replace the `extends` line with explicit compiler options reused from nearby workspace packages.

- [ ] **Step 4: Add the minimum typed emulator contract**

Create `services/firebase-functions/src/types.ts`:

```ts
export const emulatorPorts = {
  auth: 9099,
  firestore: 8080,
  functions: 5001,
} as const;

export interface PairingCodeRecord {
  desktopId: string;
  desktopDisplayName: string;
  desktopClaimTokenHash: string;
  desktopNonce: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "claimed" | "expired" | "cancelled";
  claimedByUid: string | null;
  claimedAt: string | null;
}
```

Create `services/firebase-functions/src/index.ts`:

```ts
export { emulatorPorts } from "./types.js";
```

- [ ] **Step 5: Add root Firebase emulator config**

Create `firebase.json`:

```json
{
  "functions": {
    "source": "services/firebase-functions"
  },
  "emulators": {
    "auth": {
      "port": 9099
    },
    "firestore": {
      "port": 8080
    },
    "functions": {
      "port": 5001
    },
    "ui": {
      "enabled": true,
      "port": 4000
    }
  }
}
```

Create `.firebaserc`:

```json
{
  "projects": {
    "default": "kanna-local"
  }
}
```

- [ ] **Step 6: Wire workspace scripts**

Update `pnpm-workspace.yaml` so it still includes:

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "services/*"
  - "tests/*"
```

Update root `package.json` scripts to include:

```json
{
  "scripts": {
    "build": "turbo build",
    "dev": "./scripts/dev.sh",
    "test": "turbo test",
    "lint": "turbo lint",
    "firebase:emulators": "pnpm exec firebase emulators:start --project kanna-local",
    "firebase:emulators:test": "pnpm exec firebase emulators:exec --project kanna-local --only auth,firestore,functions \"pnpm test\""
  },
  "devDependencies": {
    "firebase-tools": "^14.1.0",
    "happy-dom": "^20.8.4",
    "turbo": "^2",
    "typescript": "^5.7"
  }
}
```

- [ ] **Step 7: Re-run the failing test and verify it passes**

Run: `pnpm --dir services/firebase-functions test -- pairing`
Expected: PASS with the emulator port assertion green

- [ ] **Step 8: Commit**

```bash
git add firebase.json .firebaserc package.json pnpm-workspace.yaml services/firebase-functions
git commit -m "build: add firebase emulator workspace scaffolding"
```

### Task 2: Refactor Relay Auth For Emulator-Backed Multi-Desktop Ownership

**Files:**
- Create: `services/relay/src/firebase.ts`
- Modify: `services/relay/src/auth.ts`
- Modify: `services/relay/src/router.ts`
- Modify: `services/relay/src/index.ts`
- Modify: `services/relay/test/integration.test.ts`

- [ ] **Step 1: Write the failing multi-desktop routing test**

Add to `services/relay/test/integration.test.ts`:

```ts
it("keeps two desktop connections for the same user isolated by desktop id", async () => {
  const { ws: desktopOne } = await connectAndAuth({
    desktop_id: "desktop-one",
    desktop_secret: "secret-one",
  });
  const { ws: desktopTwo } = await connectAndAuth({
    desktop_id: "desktop-two",
    desktop_secret: "secret-two",
  });
  const { ws: phone } = await connectAndAuth({ id_token: "user-two-desktops" });

  phone.send(JSON.stringify({
    type: "invoke",
    id: 91,
    desktopId: "desktop-two",
    method: "GET",
    path: "/v1/status",
    body: null,
  }));

  const invoke = await waitForMessage(
    desktopTwo,
    (msg) => msg.type === "invoke" && msg.desktopId === "desktop-two"
  );

  expect(invoke.desktopId).toBe("desktop-two");
  await closeAndWait(phone);
  await closeAndWait(desktopOne);
  await closeAndWait(desktopTwo);
});
```

- [ ] **Step 2: Run the relay integration suite and verify the new test fails**

Run: `pnpm --dir services/relay test -- integration`
Expected: FAIL because relay auth and routing only support one server connection per user

- [ ] **Step 3: Centralize Firebase admin initialization with emulator support**

Create `services/relay/src/firebase.ts`:

```ts
import { initializeApp, applicationDefault, cert, type App } from "firebase-admin/app";
import { getAuth, connectAuthEmulator, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let app: App | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

export function getFirebaseServices(): { auth: Auth; db: Firestore } {
  if (!app) {
    app = initializeApp(
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
        ? {
            credential: cert(JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)),
          }
        : {
            credential: applicationDefault(),
          }
    );
    auth = getAuth(app);
    db = getFirestore(app);
  }

  return { auth: auth!, db: db! };
}
```

If the installed `firebase-admin` version does not export `connectAuthEmulator`, keep emulator wiring in environment variables instead of forcing that helper.

- [ ] **Step 4: Replace device-token auth with desktop credential auth**

Update `services/relay/src/auth.ts` to expose:

```ts
export interface DesktopPrincipal {
  uid: string;
  desktopId: string;
}

export async function verifyDesktopCredentials(
  desktopId: string,
  desktopSecret: string
): Promise<DesktopPrincipal | null> {
  const { db } = getFirebaseServices();
  const desktopDoc = await db.collectionGroup("desktops").where("desktopId", "==", desktopId).limit(1).get();
  if (desktopDoc.empty) {
    return null;
  }

  const snapshot = desktopDoc.docs[0]!;
  const data = snapshot.data();
  if (data.revokedAt) {
    return null;
  }

  if (data.desktopSecret !== desktopSecret) {
    return null;
  }

  return {
    uid: snapshot.ref.parent.parent!.parent!.id,
    desktopId,
  };
}
```

In real implementation, replace raw secret comparison with hash verification.
The plan uses the direct comparison above only to keep the execution steps concrete and minimal before the secret helper is extracted.

- [ ] **Step 5: Route by `(uid, desktopId)`**

Update `services/relay/src/router.ts` to store:

```ts
interface ConnectionPair {
  phone?: WebSocket;
  desktops: Map<string, WebSocket>;
}
```

and route phone invokes using `msg.desktopId`.

If a desktop is missing, return:

```json
{
  "type": "response",
  "id": 91,
  "error": "Desktop offline"
}
```

- [ ] **Step 6: Update the WebSocket auth handshake**

In `services/relay/src/index.ts`, accept:

```ts
type FirstAuthMessage =
  | { type: "auth"; id_token: string }
  | { type: "auth"; desktop_id: string; desktop_secret: string };
```

Phone auth should still verify Firebase user identity.
Desktop auth should now call `verifyDesktopCredentials`.

- [ ] **Step 7: Re-run relay tests and verify they pass**

Run: `pnpm --dir services/relay test -- integration`
Expected: PASS with both the existing phone/server flows and the new multi-desktop isolation test green

- [ ] **Step 8: Commit**

```bash
git add services/relay
git commit -m "feat(relay): support emulator-backed multi-desktop auth and routing"
```

### Task 3: Add Desktop Registration, Pairing Finalization, And Presence To `kanna-server`

**Files:**
- Create: `crates/kanna-server/src/cloud_client.rs`
- Create: `crates/kanna-server/src/desktop_identity.rs`
- Modify: `crates/kanna-server/src/config.rs`
- Modify: `crates/kanna-server/src/pairing.rs`
- Modify: `crates/kanna-server/src/mobile_api.rs`
- Modify: `crates/kanna-server/src/http_api.rs`
- Modify: `crates/kanna-server/src/main.rs`
- Modify: `crates/kanna-server/src/register.rs`
- Create: `crates/kanna-server/tests/cloud_pairing.rs`

- [ ] **Step 1: Write the failing desktop identity config test**

Create `crates/kanna-server/tests/cloud_pairing.rs`:

```rust
#[test]
fn loads_desktop_identity_and_emulator_urls_from_config() {
    let toml = r#"
relay_url = "ws://127.0.0.1:18080"
cloud_base_url = "http://127.0.0.1:5001/kanna-local/us-central1"
firebase_project_id = "kanna-local"
firebase_auth_emulator_url = "http://127.0.0.1:9099"
firebase_firestore_emulator_host = "127.0.0.1:8080"
desktop_id = "desktop-1"
desktop_secret = "desktop-secret"
"#;

    let config = kanna_server::config::load_from_str_for_tests(toml).unwrap();

    assert_eq!(config.desktop_id.as_deref(), Some("desktop-1"));
    assert_eq!(config.desktop_secret.as_deref(), Some("desktop-secret"));
    assert_eq!(config.firebase_project_id, "kanna-local");
}
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cargo test -p kanna-server --test cloud_pairing -- --nocapture`
Expected: FAIL because the config fields and test helper do not exist yet

- [ ] **Step 3: Extend config for emulator and desktop identity**

Update `crates/kanna-server/src/config.rs` so `Config` includes:

```rust
pub cloud_base_url: String,
pub firebase_project_id: String,
pub firebase_auth_emulator_url: Option<String>,
pub firebase_firestore_emulator_host: Option<String>,
pub desktop_secret: Option<String>,
```

Add a test-only helper:

```rust
#[cfg(test)]
pub fn load_from_str_for_tests(raw: &str) -> Result<Config, Box<dyn std::error::Error>> {
    let root = std::env::temp_dir().join("kanna-server-config-tests");
    std::fs::create_dir_all(&root)?;
    let path = root.join("server.toml");
    std::fs::write(&path, raw)?;
    load_from_path(&path, &root)
}
```

- [ ] **Step 4: Add desktop identity persistence**

Create `crates/kanna-server/src/desktop_identity.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DesktopIdentity {
    pub desktop_id: String,
    pub desktop_secret: String,
}

pub fn save_identity(path: &Path, identity: &DesktopIdentity) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(identity).map_err(|e| e.to_string())?;
    std::fs::write(path, body).map_err(|e| e.to_string())
}
```

- [ ] **Step 5: Add a concrete cloud client interface**

Create `crates/kanna-server/src/cloud_client.rs`:

```rust
use crate::config::Config;

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePairingCodeResponse {
    pub pairing_code: String,
    pub pairing_code_id: String,
    pub desktop_id: String,
    pub desktop_claim_token: String,
    pub expires_at: String,
}

pub async fn create_pairing_code(_config: &Config) -> Result<CreatePairingCodeResponse, String> {
    Err("not implemented".to_string())
}
```

The first green step is allowed to return a deterministic test-only error until the endpoint is wired.

- [ ] **Step 6: Rework pairing to use cloud-issued pairing state**

Update `crates/kanna-server/src/pairing.rs` so `PairingSession` becomes:

```rust
pub struct PairingSession {
    pub code: String,
    pub pairing_code_id: String,
    pub desktop_id: String,
    pub desktop_name: String,
    pub expires_at_unix_ms: u64,
}
```

Remove `lan_host` and `lan_port` from the cloud pairing session.
LAN status still belongs in `/v1/status`, not in the cloud claim token itself.

- [ ] **Step 7: Add presence registration stub to startup**

In `crates/kanna-server/src/main.rs`, add a background loop stub:

```rust
tokio::spawn(async move {
    loop {
        log::info!("desktop heartbeat tick");
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
    }
});
```

This is intentionally minimal.
It creates the owned lifecycle point where cloud heartbeat code will be added in the next red-green cycle.

- [ ] **Step 8: Re-run the desktop pairing test and config tests**

Run: `cargo test -p kanna-server --test cloud_pairing -- --nocapture`
Expected: PASS for config and pairing-session shape assertions

- [ ] **Step 9: Commit**

```bash
git add crates/kanna-server
git commit -m "feat(kanna-server): scaffold cloud pairing and desktop identity"
```

### Task 4: Add Mobile Firebase Session And Remote Desktop Discovery

**Files:**
- Create: `apps/mobile/src/lib/firebase/config.ts`
- Create: `apps/mobile/src/lib/firebase/auth.ts`
- Create: `apps/mobile/src/lib/transports/remoteTransport.ts`
- Create: `apps/mobile/src/lib/firebase/auth.test.ts`
- Create: `apps/mobile/src/lib/transports/remoteTransport.test.ts`
- Modify: `apps/mobile/src/lib/api/types.ts`
- Modify: `apps/mobile/src/lib/api/client.ts`
- Modify: `apps/mobile/src/screens/DesktopsScreen.tsx`
- Modify: `apps/mobile/src/state/mobileController.ts`

- [ ] **Step 1: Write the failing remote desktop list transport test**

Create `apps/mobile/src/lib/transports/remoteTransport.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createRemoteTransport } from "./remoteTransport";

describe("remote transport", () => {
  it("maps cloud desktop records into the mobile desktop summary shape", async () => {
    const transport = createRemoteTransport(async () => [
      {
        desktopId: "desktop-1",
        displayName: "Studio Mac",
        online: true,
        reachableViaRelay: true,
        connectionMode: "both",
      },
    ]);

    await expect(transport.listDesktops()).resolves.toEqual([
      {
        id: "desktop-1",
        name: "Studio Mac",
        online: true,
        mode: "remote",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir apps/mobile test -- remoteTransport`
Expected: FAIL because `remoteTransport.ts` does not exist yet

- [ ] **Step 3: Add the minimal remote transport**

Create `apps/mobile/src/lib/transports/remoteTransport.ts`:

```ts
import type { KannaTransport } from "../api/client";
import type { DesktopSummary, MobileServerStatus, RepoSummary, TaskSummary } from "../api/types";

export function createRemoteTransport(
  listDesktopRecords: () => Promise<Array<{
    desktopId: string;
    displayName: string;
    online: boolean;
    reachableViaRelay: boolean;
    connectionMode: string;
  }>>
): KannaTransport {
  return {
    async getStatus(): Promise<MobileServerStatus> {
      throw new Error("Remote status transport not implemented yet");
    },
    async listDesktops(): Promise<DesktopSummary[]> {
      const records = await listDesktopRecords();
      return records.map((record) => ({
        id: record.desktopId,
        name: record.displayName,
        online: record.online,
        mode: "remote",
      }));
    },
    async listRepos(): Promise<RepoSummary[]> {
      throw new Error("Remote repos transport not implemented yet");
    },
    async listRepoTasks(_repoId: string): Promise<TaskSummary[]> {
      throw new Error("Remote repo tasks transport not implemented yet");
    },
    async listRecentTasks(): Promise<TaskSummary[]> {
      throw new Error("Remote recent tasks transport not implemented yet");
    },
    async searchTasks(): Promise<TaskSummary[]> {
      throw new Error("Remote search transport not implemented yet");
    },
    async createTask() {
      throw new Error("Remote create task transport not implemented yet");
    },
    async runMergeAgent() {
      throw new Error("Remote merge-agent transport not implemented yet");
    },
    async advanceTaskStage() {
      throw new Error("Remote advance-stage transport not implemented yet");
    },
    async closeTask() {
      throw new Error("Remote close-task transport not implemented yet");
    },
    async sendTaskInput() {
      throw new Error("Remote task input transport not implemented yet");
    },
    observeTaskTerminal() {
      throw new Error("Remote terminal transport not implemented yet");
    },
    async createPairingSession() {
      throw new Error("Cloud pairing session is not created from the mobile transport");
    },
  };
}
```

- [ ] **Step 4: Expand mobile desktop summary metadata**

Update `apps/mobile/src/lib/api/types.ts`:

```ts
export interface DesktopSummary {
  id: string;
  name: string;
  online: boolean;
  mode: DesktopMode;
  reachableViaRelay?: boolean;
  connectionMode?: "lan" | "internet" | "both";
  lastSeenAt?: string | null;
}
```

- [ ] **Step 5: Make the desktop list UI show remote availability explicitly**

Update `apps/mobile/src/screens/DesktopsScreen.tsx` so the meta line becomes:

```tsx
<Text style={styles.meta}>
  {desktop.online
    ? desktop.reachableViaRelay
      ? "Available over internet"
      : "Available on this network"
    : "Remote desktop is offline"}
</Text>
```

- [ ] **Step 6: Re-run mobile transport and presentation tests**

Run:

- `pnpm --dir apps/mobile test -- remoteTransport`
- `pnpm --dir apps/mobile test -- DesktopsScreen`

Expected: PASS for both suites

- [ ] **Step 7: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): scaffold firebase session and remote desktop discovery"
```

### Task 5: Wire The First Remote `GET /v1/status` Path And Verify End-To-End

**Files:**
- Modify: `services/relay/src/index.ts`
- Modify: `services/relay/src/router.ts`
- Modify: `crates/kanna-server/src/main.rs`
- Modify: `crates/kanna-server/src/http_api.rs`
- Modify: `apps/mobile/src/lib/transports/remoteTransport.ts`
- Modify: `services/relay/test/integration.test.ts`
- Create: `apps/mobile/src/lib/transports/remoteStatus.test.ts`
- Modify: `README.md`
- Create: `docs/firebase-emulator.md`

- [ ] **Step 1: Write the failing relay status invoke test**

Add to `services/relay/test/integration.test.ts`:

```ts
it("routes a remote GET /v1/status invoke to the targeted desktop", async () => {
  const { ws: desktop } = await connectAndAuth({
    desktop_id: "desktop-status",
    desktop_secret: "secret-status",
  });
  const { ws: phone } = await connectAndAuth({ id_token: "status-user" });

  phone.send(JSON.stringify({
    type: "invoke",
    id: 777,
    desktopId: "desktop-status",
    method: "GET",
    path: "/v1/status",
    body: null,
  }));

  const invoke = await waitForMessage(
    desktop,
    (msg) => msg.type === "invoke" && msg.path === "/v1/status"
  );

  desktop.send(JSON.stringify({
    type: "response",
    id: invoke.id,
    status: 200,
    body: { state: "running" },
  }));

  const response = await waitForMessage(phone, (msg) => msg.type === "response" && msg.id === 777);
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ state: "running" });

  await closeAndWait(phone);
  await closeAndWait(desktop);
});
```

- [ ] **Step 2: Run the relay integration suite and verify it fails on status routing**

Run: `pnpm --dir services/relay test -- integration`
Expected: FAIL because the current invoke envelope is command-based and does not route `method + path`

- [ ] **Step 3: Add the minimal status invoke envelope**

Update the relay invoke shape to:

```ts
type InvokeMessage = {
  type: "invoke";
  id: number;
  desktopId: string;
  method: "GET";
  path: "/v1/status";
  body: null;
};
```

Keep the existing command-based path in place temporarily if needed, but the new status invoke path must be supported.

- [ ] **Step 4: Add a `kanna-server` status dispatcher for remote invokes**

In `crates/kanna-server/src/main.rs`, when an invoke arrives with `method == "GET"` and `path == "/v1/status"`, serialize the existing status payload used by the LAN route and return it through the relay response path.

Concrete response body:

```json
{
  "state": "running",
  "desktopId": "desktop-1",
  "desktopName": "Studio Mac",
  "lanHost": "0.0.0.0",
  "lanPort": 48120,
  "pairingCode": null
}
```

- [ ] **Step 5: Teach mobile remote transport to call remote status**

Update `apps/mobile/src/lib/transports/remoteTransport.ts`:

```ts
async getStatus(): Promise<MobileServerStatus> {
  const response = await invokeRemote({
    desktopId: selectedDesktopId,
    method: "GET",
    path: "/v1/status",
    body: null,
  });

  return response as MobileServerStatus;
}
```

If `selectedDesktopId` is not set, throw:

```ts
throw new Error("No desktop selected for remote status");
```

- [ ] **Step 6: Re-run focused verification**

Run:

- `pnpm --dir services/relay test -- integration`
- `cargo test -p kanna-server -- --nocapture`
- `pnpm --dir apps/mobile test -- remoteStatus`

Expected: PASS with the new remote status flow covered end-to-end at the unit / integration layer

- [ ] **Step 7: Document the emulator-based local workflow**

Create `docs/firebase-emulator.md` with:

```md
# Firebase Emulator Workflow

Use the Firebase Local Emulator Suite for all remote-access slice development.

## Ports

- Auth: `9099`
- Firestore: `8080`
- Functions: `5001`
- Emulator UI: `4000`

## Start

```bash
pnpm firebase:emulators
```

## Notes

- Run the relay locally against emulator-backed Firebase Admin SDK configuration.
- Point `kanna-server` at emulator URLs in `server.toml`.
- Do not use a shared production Firebase project for routine development.
```

Update `README.md` to link this document from the mobile / remote-access development section.

- [ ] **Step 8: Commit**

```bash
git add services/relay crates/kanna-server apps/mobile README.md docs/firebase-emulator.md
git commit -m "feat(remote): add first emulator-backed remote status path"
```

---

## Self-Review

### Spec Coverage

- Firebase emulator usage is explicitly covered in Task 1 and Task 5.
- User identity, desktop registry, secure pairing, and revocation are covered in Tasks 1 through 3.
- Multi-desktop support is covered in Task 2 and propagated through mobile in Task 4.
- The first minimal remote API surface is covered in Task 5 with `GET /v1/status`.
- LAN / remote contract alignment is preserved by keeping `kanna-server` as the canonical route owner in Tasks 3 and 5.

### Placeholder Scan

- No `TBD`, `TODO`, or deferred “implement later” steps remain in the task list.
- Where a step introduces a stub, the exact stub code and the next verification are specified.
- Each task names exact files, commands, and commit boundaries.

### Type Consistency

- `desktopId`, `desktopSecret`, `PairingSession`, and `DesktopSummary` use the same names across relay, server, and mobile tasks.
- The first remote invoke path consistently uses `method`, `path`, and `body` rather than mixing command names with route shapes.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-19-firebase-remote-access-slice.md`. I’m using `superpowers:executing-plans` because the relay, `kanna-server`, and mobile changes are tightly coupled and subagents aren’t available in this session.
