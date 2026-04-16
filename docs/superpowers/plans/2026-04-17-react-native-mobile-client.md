# React Native Mobile Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first iPhone-first React Native Kanna client, backed by a desktop-side Kanna API service that supports multi-desktop LAN and Remote connections from day one.

**Architecture:** Keep `crates/kanna-server` as the desktop-side contract boundary and evolve it into a real mobile-facing API host with both LAN and Remote entry points. Add explicit desktop identity, pairing, and presence to the service and relay, then build a new Expo-based React Native app that talks to one typed Kanna client interface across both transports.

**Tech Stack:** Rust (`tokio`, `axum`, `serde`, `rusqlite`), TypeScript (`ws`, Firebase Admin, Expo, React Native, React Navigation), pnpm workspaces, Turbo, Vitest/Jest, React Native Testing Library

**Spec:** `docs/superpowers/specs/2026-04-17-react-native-mobile-client-design.md`

---

## File Structure

### Desktop-Side Kanna API
- Modify: `crates/kanna-server/Cargo.toml` — add `axum`, `tower-http`, and any small supporting deps for the LAN API
- Modify: `crates/kanna-server/src/config.rs` — persist `desktop_id`, `desktop_name`, LAN bind info, and pairing storage paths
- Create: `crates/kanna-server/src/mobile_api.rs` — typed mobile-facing service layer over DB + daemon
- Create: `crates/kanna-server/src/http_api.rs` — LAN HTTP/WebSocket routes and request auth
- Create: `crates/kanna-server/src/pairing.rs` — pairing session issuance, trusted-device storage, and local auth helpers
- Modify: `crates/kanna-server/src/main.rs` — run LAN server and relay loop together
- Modify: `crates/kanna-server/src/commands.rs` — delegate relay invocations to `mobile_api`
- Modify: `crates/kanna-server/src/db.rs` — add recent/search/preview-oriented queries and desktop-aware result shapes
- Modify: `crates/kanna-server/src/register.rs` — include `desktop_id` and `desktop_name` in generated config

### Remote Relay
- Modify: `services/relay/src/auth.ts` — return structured desktop registrations instead of single-device assumptions
- Modify: `services/relay/src/router.ts` — track multiple server connections per user, keyed by `desktopId`
- Modify: `services/relay/src/index.ts` — new message/registration flow, desktop listing endpoint/event support
- Modify: `services/relay/test/integration.test.ts` — multi-desktop routing, presence, and offline behavior tests

### Desktop App Integration
- Modify: `apps/desktop/src-tauri/tauri.conf.json` — add `kanna-server` to `bundle.externalBin`
- Modify: `scripts/stage-sidecars.sh` — stage `kanna-server` with existing desktop sidecars
- Create: `apps/desktop/src-tauri/src/commands/mobile.rs` — desktop commands for server status, pairing session creation, and remote registration helpers
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs` — register the new mobile command module
- Modify: `apps/desktop/src-tauri/src/lib.rs` — start/supervise the sidecar and expose mobile commands
- Create: `apps/desktop/src/components/MobileAccessPanel.vue` — preferences-side UI for pairing and remote status
- Modify: `apps/desktop/src/components/PreferencesPanel.vue` — mount the mobile access panel
- Create: `apps/desktop/src/components/__tests__/MobileAccessPanel.test.ts` — UI coverage for pairing/desktop metadata display

### React Native App
- Create: `apps/mobile-native/package.json`
- Create: `apps/mobile-native/app.json`
- Create: `apps/mobile-native/babel.config.js`
- Create: `apps/mobile-native/metro.config.js`
- Create: `apps/mobile-native/tsconfig.json`
- Create: `apps/mobile-native/jest.config.js`
- Create: `apps/mobile-native/src/App.tsx`
- Create: `apps/mobile-native/src/navigation/RootNavigator.tsx`
- Create: `apps/mobile-native/src/lib/auth/authClient.ts`
- Create: `apps/mobile-native/src/lib/api/types.ts`
- Create: `apps/mobile-native/src/lib/api/client.ts`
- Create: `apps/mobile-native/src/lib/transports/lanTransport.ts`
- Create: `apps/mobile-native/src/lib/transports/remoteTransport.ts`
- Create: `apps/mobile-native/src/lib/storage/deviceStore.ts`
- Create: `apps/mobile-native/src/state/sessionStore.ts`
- Create: `apps/mobile-native/src/screens/ConnectionScreen.tsx`
- Create: `apps/mobile-native/src/screens/DesktopsScreen.tsx`
- Create: `apps/mobile-native/src/screens/TasksScreen.tsx`
- Create: `apps/mobile-native/src/screens/RecentScreen.tsx`
- Create: `apps/mobile-native/src/screens/SearchScreen.tsx`
- Create: `apps/mobile-native/src/screens/TaskScreen.tsx`
- Create: `apps/mobile-native/src/components/DesktopCard.tsx`
- Create: `apps/mobile-native/src/components/TaskList.tsx`
- Create: `apps/mobile-native/src/components/TaskRow.tsx`
- Create: `apps/mobile-native/src/components/TerminalPane.tsx`
- Create: `apps/mobile-native/src/test/setup.ts`
- Create: `apps/mobile-native/src/test/fixtures.ts`
- Create: `apps/mobile-native/src/state/sessionStore.test.ts`
- Create: `apps/mobile-native/src/lib/api/client.test.ts`
- Create: `apps/mobile-native/src/screens/ConnectionScreen.test.tsx`
- Create: `apps/mobile-native/src/screens/DesktopsScreen.test.tsx`
- Create: `apps/mobile-native/src/screens/TaskScreen.test.tsx`

### Workspace / Docs
- Modify: `package.json` — add convenient filtered scripts for the RN app
- Modify: `README.md` — document the RN app and desktop-side mobile access flow

---

## Task 1: Extract A Typed Mobile API From `kanna-server`

Create a real service layer in `kanna-server` so LAN and Remote stop depending on ad hoc relay commands and raw DB pass-through.

**Files:**
- Modify: `crates/kanna-server/Cargo.toml`
- Modify: `crates/kanna-server/src/config.rs`
- Modify: `crates/kanna-server/src/db.rs`
- Modify: `crates/kanna-server/src/commands.rs`
- Create: `crates/kanna-server/src/mobile_api.rs`

- [ ] **Step 1: Write failing service tests for desktop listing, recent tasks, and search**

In `crates/kanna-server/src/mobile_api.rs`, start with the test module and a minimal interface:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use crate::db::Db;

    #[test]
    fn list_desktops_returns_configured_descriptor() {
        let config = Config {
            relay_url: "wss://relay.example".to_string(),
            device_token: "device-token".to_string(),
            daemon_dir: "/tmp/kanna-daemon".to_string(),
            db_path: Db::test_db_path("desktop-list"),
            desktop_id: "desktop-1".to_string(),
            desktop_name: "Studio Mac".to_string(),
            lan_host: "0.0.0.0".to_string(),
            lan_port: 48120,
            pairing_store_path: "/tmp/kanna-pairings.json".to_string(),
        };

        let db = Db::open_for_tests(&config.db_path).unwrap();
        let api = MobileApi::new(config, db);
        let desktops = api.list_desktops().unwrap();

        assert_eq!(desktops.len(), 1);
        assert_eq!(desktops[0].id, "desktop-1");
        assert_eq!(desktops[0].name, "Studio Mac");
        assert_eq!(desktops[0].connection_mode, "local");
    }
}
```

- [ ] **Step 2: Run the service test to verify it fails**

Run: `cd crates/kanna-server && cargo test list_desktops_returns_configured_descriptor -- --nocapture`
Expected: FAIL with missing `desktop_id`, `desktop_name`, `test_db_path`, `open_for_tests`, or `MobileApi`

- [ ] **Step 3: Add config fields for desktop identity and LAN defaults**

Update `crates/kanna-server/src/config.rs`:

```rust
#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    pub relay_url: String,
    pub device_token: String,
    #[serde(default = "default_daemon_dir")]
    pub daemon_dir: String,
    #[serde(default = "default_db_path")]
    pub db_path: String,
    #[serde(default = "default_desktop_id")]
    pub desktop_id: String,
    #[serde(default = "default_desktop_name")]
    pub desktop_name: String,
    #[serde(default = "default_lan_host")]
    pub lan_host: String,
    #[serde(default = "default_lan_port")]
    pub lan_port: u16,
    #[serde(default = "default_pairing_store_path")]
    pub pairing_store_path: String,
}
```

Add simple helpers using hostname or a random hex ID for defaults rather than leaving them empty.

- [ ] **Step 4: Add mobile-facing result types and the `MobileApi` service**

Create `crates/kanna-server/src/mobile_api.rs`:

```rust
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DesktopDescriptor {
    pub id: String,
    pub name: String,
    pub connection_mode: String,
}

pub struct MobileApi {
    config: Config,
    db: Db,
}

impl MobileApi {
    pub fn new(config: Config, db: Db) -> Self {
        Self { config, db }
    }

    pub fn list_desktops(&self) -> Result<Vec<DesktopDescriptor>, String> {
        Ok(vec![DesktopDescriptor {
            id: self.config.desktop_id.clone(),
            name: self.config.desktop_name.clone(),
            connection_mode: "local".to_string(),
        }])
    }
}
```

- [ ] **Step 5: Add test-only DB helpers and recent/search queries**

In `crates/kanna-server/src/db.rs`, add:

```rust
impl Db {
    #[cfg(test)]
    pub fn test_db_path(suffix: &str) -> String {
        std::env::temp_dir()
            .join(format!("kanna-server-db-{suffix}.sqlite"))
            .to_string_lossy()
            .to_string()
    }

    #[cfg(test)]
    pub fn open_for_tests(path: &str) -> Result<Self, rusqlite::Error> {
        let db = Self::open(path)?;
        db.init_test_schema()?;
        Ok(db)
    }

    #[cfg(test)]
    fn init_test_schema(&self) -> Result<(), rusqlite::Error> {
        self.conn.execute_batch(include_str!("../../../packages/db/src/migrations/001_initial.sql"))?;
        Ok(())
    }
}
```

Then add focused query methods such as `list_recent_tasks` and `search_tasks` so the mobile surface stops depending on `db_select`.

- [ ] **Step 6: Route relay commands through `MobileApi` and remove `db_select` from the public mobile path**

Replace direct DB branching in `crates/kanna-server/src/commands.rs` with:

```rust
let api = MobileApi::new(
    config.clone(),
    Db::open(&config.db_path).map_err(|e| format!("db error: {}", e))?,
);

match command {
    "list_desktops" => serde_json::to_value(api.list_desktops()?)
        .map_err(|e| format!("serialize error: {}", e)),
    "list_recent_tasks" => serde_json::to_value(api.list_recent_tasks()?)
        .map_err(|e| format!("serialize error: {}", e)),
    "search_tasks" => {
        let query = args
            .get("query")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "missing required arg: query".to_string())?;
        serde_json::to_value(api.search_tasks(query)?)
            .map_err(|e| format!("serialize error: {}", e))
    }
    // existing session commands stay here
```

- [ ] **Step 7: Run kanna-server tests**

Run: `cd crates/kanna-server && cargo test mobile_api -- --nocapture`
Expected: PASS for the new service tests

- [ ] **Step 8: Commit**

```bash
git add crates/kanna-server/Cargo.toml crates/kanna-server/src/config.rs crates/kanna-server/src/db.rs crates/kanna-server/src/commands.rs crates/kanna-server/src/mobile_api.rs
git commit -m "feat(kanna-server): add typed mobile api service"
```

---

## Task 2: Add LAN HTTP/WebSocket API And Pairing To `kanna-server`

Turn `kanna-server` into an inbound LAN API host with trusted-device pairing and session streaming.

**Files:**
- Modify: `crates/kanna-server/Cargo.toml`
- Modify: `crates/kanna-server/src/main.rs`
- Create: `crates/kanna-server/src/http_api.rs`
- Create: `crates/kanna-server/src/pairing.rs`
- Modify: `crates/kanna-server/src/mobile_api.rs`

- [ ] **Step 1: Add failing pairing-store tests**

In `crates/kanna-server/src/pairing.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trusted_device_roundtrip_preserves_desktop_binding() {
        let mut store = PairingStore::default();
        store.add_trusted_device("desktop-1", "device-1", "Jeremy's iPhone");

        assert!(store.is_trusted("desktop-1", "device-1"));
        assert!(!store.is_trusted("desktop-2", "device-1"));
    }
}
```

- [ ] **Step 2: Run the pairing test to verify it fails**

Run: `cd crates/kanna-server && cargo test trusted_device_roundtrip_preserves_desktop_binding -- --nocapture`
Expected: FAIL with missing `PairingStore`

- [ ] **Step 3: Add Axum dependencies and a pairing store**

Update `crates/kanna-server/Cargo.toml`:

```toml
axum = { version = "0.8", features = ["ws", "macros"] }
tower-http = { version = "0.6", features = ["cors"] }
uuid = { version = "1", features = ["v4", "serde"] }
```

Create `crates/kanna-server/src/pairing.rs`:

```rust
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct PairingStore {
    pub trusted_devices: HashMap<String, Vec<TrustedDevice>>,
}

impl PairingStore {
    pub fn add_trusted_device(&mut self, desktop_id: &str, device_id: &str, name: &str) {
        self.trusted_devices
            .entry(desktop_id.to_string())
            .or_default()
            .push(TrustedDevice {
                device_id: device_id.to_string(),
                device_name: name.to_string(),
            });
    }
}
```

- [ ] **Step 4: Add LAN routes for desktops, repos, tasks, recent, search, pairing, and session WebSocket**

Create `crates/kanna-server/src/http_api.rs` with the route skeleton:

```rust
pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/v1/desktops", get(list_desktops))
        .route("/v1/repos", get(list_repos))
        .route("/v1/tasks/recent", get(list_recent_tasks))
        .route("/v1/tasks/search", get(search_tasks))
        .route("/v1/pairing/sessions", post(create_pairing_session))
        .route("/v1/sessions/:session_id/ws", get(stream_session))
        .with_state(state)
}
```

- [ ] **Step 5: Start the LAN server alongside the relay loop**

In `crates/kanna-server/src/main.rs`, run both loops under `tokio::select!` or joined tasks:

```rust
let lan_task = tokio::spawn(http_api::serve(config.clone(), shared_state.clone()));
let relay_task = tokio::spawn(run_relay_loop(config.clone(), shared_state.clone()));

let _ = tokio::try_join!(lan_task, relay_task)?;
```

Refactor the current relay-only body into `run_relay_loop(...)`.

- [ ] **Step 6: Add a session WebSocket smoke test**

Add to `crates/kanna-server/src/http_api.rs` tests:

```rust
#[tokio::test]
async fn list_desktops_route_returns_configured_desktop() {
    let app = test_router("desktop-1", "Studio Mac");
    let response = app
        .oneshot(Request::get("/v1/desktops").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}
```

- [ ] **Step 7: Run the LAN API tests**

Run: `cd crates/kanna-server && cargo test http_api -- --nocapture`
Expected: PASS for the route smoke tests and pairing tests

- [ ] **Step 8: Commit**

```bash
git add crates/kanna-server/Cargo.toml crates/kanna-server/src/main.rs crates/kanna-server/src/http_api.rs crates/kanna-server/src/pairing.rs crates/kanna-server/src/mobile_api.rs
git commit -m "feat(kanna-server): add lan api and trusted-device pairing"
```

---

## Task 3: Upgrade The Relay To Support Multiple Remote Desktops Per User

Replace the current one-phone/one-server-per-user router with explicit desktop registrations and desktop-targeted routing.

**Files:**
- Modify: `services/relay/src/auth.ts`
- Modify: `services/relay/src/router.ts`
- Modify: `services/relay/src/index.ts`
- Modify: `services/relay/test/integration.test.ts`
- Modify: `crates/kanna-server/src/relay_client.rs`
- Modify: `crates/kanna-server/src/main.rs`

- [ ] **Step 1: Add a failing relay integration test for multi-desktop listing**

In `services/relay/test/integration.test.ts` add:

```ts
it("lists multiple desktops for one signed-in user", async () => {
  const { ws: serverA } = await connectAndAuth({
    device_token: "desktop-a-token",
    desktop_id: "desktop-a",
    desktop_name: "Studio Mac",
  });
  const { ws: serverB } = await connectAndAuth({
    device_token: "desktop-b-token",
    desktop_id: "desktop-b",
    desktop_name: "Laptop",
  });
  const { ws: phone } = await connectAndAuth({ id_token: "multi-desktop-user" });

  phone.send(JSON.stringify({ type: "list_desktops", id: 99 }));
  const response = await waitForMessage(phone, (msg) => msg.type === "response" && msg.id === 99);

  expect(response.data).toHaveLength(2);

  await closeAndWait(phone);
  await closeAndWait(serverA);
  await closeAndWait(serverB);
});
```

- [ ] **Step 2: Run the relay integration test to verify it fails**

Run: `cd services/relay && pnpm test -- --runInBand integration.test.ts`
Expected: FAIL because the router only tracks one server connection per user

- [ ] **Step 3: Change relay auth to include desktop metadata**

In `crates/kanna-server/src/relay_client.rs`, change the auth frame:

```rust
#[serde(rename = "auth")]
Auth {
    device_token: String,
    desktop_id: String,
    desktop_name: String,
},
```

Send `desktop_id` and `desktop_name` from `main.rs` using `Config`.

- [ ] **Step 4: Replace `ConnectionPair` with a user + desktops router model**

In `services/relay/src/router.ts`:

```ts
interface DesktopConnection {
  desktopId: string;
  desktopName: string;
  ws: WebSocket;
}

interface UserConnections {
  phones: Set<WebSocket>;
  desktops: Map<string, DesktopConnection>;
}
```

Route invoke frames by `desktopId`, and return `"Desktop offline"` only for the selected desktop rather than the whole user.

- [ ] **Step 5: Add a desktop list response path**

In `services/relay/src/index.ts`, support a post-auth message:

```ts
if (parsed.type === "list_desktops") {
  const desktops = listDesktops(userId!);
  ws.send(JSON.stringify({
    type: "response",
    id: parsed.id,
    data: desktops,
  }));
  return;
}
```

- [ ] **Step 6: Emit desktop presence changes to phones**

When a desktop connects or disconnects, send:

```ts
broadcastToPhones(userId, {
  type: "event",
  name: "desktop_presence",
  payload: { desktopId, online: true, desktopName },
});
```

- [ ] **Step 7: Run relay tests**

Run: `cd services/relay && pnpm test`
Expected: PASS for existing auth/routing coverage and the new multi-desktop cases

- [ ] **Step 8: Commit**

```bash
git add services/relay/src/auth.ts services/relay/src/router.ts services/relay/src/index.ts services/relay/test/integration.test.ts crates/kanna-server/src/relay_client.rs crates/kanna-server/src/main.rs
git commit -m "feat(relay): support multiple desktops per user"
```

---

## Task 4: Integrate Mobile Access Into The Desktop App

Ship the desktop-side product affordances: supervise `kanna-server`, expose desktop identity, and let the user create LAN pairing QR sessions.

**Files:**
- Modify: `scripts/stage-sidecars.sh`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `apps/desktop/src-tauri/src/commands/mobile.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Create: `apps/desktop/src/components/MobileAccessPanel.vue`
- Create: `apps/desktop/src/components/__tests__/MobileAccessPanel.test.ts`
- Modify: `apps/desktop/src/components/PreferencesPanel.vue`

- [ ] **Step 1: Add a failing desktop component test for mobile access status**

Create `apps/desktop/src/components/__tests__/MobileAccessPanel.test.ts`:

```ts
it("shows the desktop name and a start pairing action", async () => {
  render(MobileAccessPanel, {
    props: {
      desktopName: "Studio Mac",
      serverStatus: "running",
      pairingCode: null,
    },
  });

  expect(screen.getByText("Studio Mac")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /start pairing/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the desktop component test to verify it fails**

Run: `cd apps/desktop && pnpm exec vitest run src/components/__tests__/MobileAccessPanel.test.ts`
Expected: FAIL because `MobileAccessPanel` does not exist

- [ ] **Step 3: Stage `kanna-server` as a desktop sidecar**

Update `scripts/stage-sidecars.sh` and `apps/desktop/src-tauri/tauri.conf.json` to include `kanna-server` alongside `kanna-daemon` and `kanna-cli`.

Use the same pattern already used for other sidecars:

```json
"externalBin": [
  "binaries/kanna-daemon",
  "binaries/kanna-cli",
  "binaries/kanna-terminal-recovery",
  "binaries/kanna-server"
]
```

and stage the built binary into `apps/desktop/src-tauri/binaries/`.

- [ ] **Step 4: Add Tauri mobile-service commands**

Create `apps/desktop/src-tauri/src/commands/mobile.rs`:

```rust
#[derive(serde::Serialize)]
pub struct MobileServerStatus {
    pub state: String,
    pub desktop_name: String,
}

#[tauri::command]
pub async fn mobile_server_status(app: tauri::AppHandle) -> Result<MobileServerStatus, String> {
    let manager = app.state::<MobileServerManager>();
    manager.status().await
}

#[tauri::command]
pub async fn create_mobile_pairing_session(
    app: tauri::AppHandle,
) -> Result<PairingSessionPayload, String> {
    let manager = app.state::<MobileServerManager>();
    manager.create_pairing_session().await
}
```

Register the commands in `commands/mod.rs` and `lib.rs`.

- [ ] **Step 5: Add the preferences-side panel**

Create `apps/desktop/src/components/MobileAccessPanel.vue`:

```vue
<script setup lang="ts">
defineProps<{
  desktopName: string;
  serverStatus: "running" | "stopped" | "error";
  pairingCode: string | null;
}>();
</script>

<template>
  <section class="mobile-access-panel">
    <h3>Mobile Access</h3>
    <p>{{ desktopName }}</p>
    <button type="button">Start Pairing</button>
    <code v-if="pairingCode">{{ pairingCode }}</code>
  </section>
</template>
```

- [ ] **Step 6: Mount the panel in preferences and wire it to invoke**

In `apps/desktop/src/components/PreferencesPanel.vue`, mount:

```vue
<MobileAccessPanel
  :desktop-name="mobileDesktopName"
  :server-status="mobileServerStatus"
  :pairing-code="pairingCode"
  @start-pairing="startPairing"
/>
```

Use the existing `invoke` helper rather than raw Tauri imports.

- [ ] **Step 7: Run desktop tests**

Run:

```bash
cd apps/desktop && pnpm exec vitest run src/components/__tests__/MobileAccessPanel.test.ts
cd apps/desktop && pnpm exec tsc --noEmit
```

Expected: PASS for the new panel test and no TypeScript errors

- [ ] **Step 8: Commit**

```bash
git add scripts/stage-sidecars.sh apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/src/commands/mobile.rs apps/desktop/src-tauri/src/commands/mod.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src/components/MobileAccessPanel.vue apps/desktop/src/components/__tests__/MobileAccessPanel.test.ts apps/desktop/src/components/PreferencesPanel.vue
git commit -m "feat(desktop): add mobile access controls"
```

---

## Task 5: Scaffold The New Expo-Based React Native App

Create a new RN app without disturbing the existing Tauri prototype.

**Files:**
- Create: `apps/mobile-native/package.json`
- Create: `apps/mobile-native/app.json`
- Create: `apps/mobile-native/babel.config.js`
- Create: `apps/mobile-native/metro.config.js`
- Create: `apps/mobile-native/tsconfig.json`
- Create: `apps/mobile-native/jest.config.js`
- Create: `apps/mobile-native/src/App.tsx`
- Create: `apps/mobile-native/src/navigation/RootNavigator.tsx`
- Create: `apps/mobile-native/src/test/setup.ts`

- [ ] **Step 1: Add a failing app smoke test**

Create `apps/mobile-native/src/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";
import App from "./App";

it("renders the desktops tab label", () => {
  render(<App />);
  expect(screen.getByText("Desktops")).toBeTruthy();
});
```

- [ ] **Step 2: Run the RN app test to verify it fails**

Run: `cd apps/mobile-native && pnpm test -- --runInBand App.test.tsx`
Expected: FAIL because the workspace and app files do not exist

- [ ] **Step 3: Create the Expo workspace manifest**

Create `apps/mobile-native/package.json`:

```json
{
  "name": "@kanna/mobile-native",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "dev": "expo start",
    "ios": "expo run:ios",
    "test": "jest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "expo": "~53.0.0",
    "react": "19.0.0",
    "react-native": "0.79.2",
    "@react-navigation/native": "^7.0.0",
    "@react-navigation/bottom-tabs": "^7.0.0"
  }
}
```

- [ ] **Step 4: Create the app entry and root navigator**

Create `apps/mobile-native/src/App.tsx`:

```tsx
import { NavigationContainer } from "@react-navigation/native";
import { RootNavigator } from "./navigation/RootNavigator";

export default function App() {
  return (
    <NavigationContainer>
      <RootNavigator />
    </NavigationContainer>
  );
}
```

Create `apps/mobile-native/src/navigation/RootNavigator.tsx` with a bottom tab navigator containing placeholder `Desktops`, `Tasks`, and `Recent` routes.

- [ ] **Step 5: Add Jest and Metro config**

Create:

```js
// apps/mobile-native/jest.config.js
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/src/test/setup.ts"],
};
```

```js
// apps/mobile-native/metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
module.exports = getDefaultConfig(__dirname);
```

- [ ] **Step 6: Run the RN smoke test and typecheck**

Run:

```bash
cd apps/mobile-native && pnpm test -- --runInBand App.test.tsx
cd apps/mobile-native && pnpm run typecheck
```

Expected: PASS for the smoke test and no TypeScript errors

- [ ] **Step 7: Commit**

```bash
git add apps/mobile-native/package.json apps/mobile-native/app.json apps/mobile-native/babel.config.js apps/mobile-native/metro.config.js apps/mobile-native/tsconfig.json apps/mobile-native/jest.config.js apps/mobile-native/src/App.tsx apps/mobile-native/src/navigation/RootNavigator.tsx apps/mobile-native/src/test/setup.ts apps/mobile-native/src/App.test.tsx
git commit -m "feat(mobile-native): scaffold expo react native app"
```

---

## Task 6: Build The Typed Client, Multi-Desktop State, And Core RN Screens

Implement the transport abstraction, desktop selection state, and the v1 surfaces: Desktops, Tasks, Recent, Search, and Task terminal.

**Files:**
- Create: `apps/mobile-native/src/lib/api/types.ts`
- Create: `apps/mobile-native/src/lib/api/client.ts`
- Create: `apps/mobile-native/src/lib/auth/authClient.ts`
- Create: `apps/mobile-native/src/lib/transports/lanTransport.ts`
- Create: `apps/mobile-native/src/lib/transports/remoteTransport.ts`
- Create: `apps/mobile-native/src/lib/storage/deviceStore.ts`
- Create: `apps/mobile-native/src/state/sessionStore.ts`
- Create: `apps/mobile-native/src/state/sessionStore.test.ts`
- Create: `apps/mobile-native/src/lib/api/client.test.ts`
- Create: `apps/mobile-native/src/screens/ConnectionScreen.tsx`
- Create: `apps/mobile-native/src/screens/DesktopsScreen.tsx`
- Create: `apps/mobile-native/src/screens/TasksScreen.tsx`
- Create: `apps/mobile-native/src/screens/RecentScreen.tsx`
- Create: `apps/mobile-native/src/screens/SearchScreen.tsx`
- Create: `apps/mobile-native/src/screens/TaskScreen.tsx`
- Create: `apps/mobile-native/src/components/DesktopCard.tsx`
- Create: `apps/mobile-native/src/components/TaskList.tsx`
- Create: `apps/mobile-native/src/components/TaskRow.tsx`
- Create: `apps/mobile-native/src/components/TerminalPane.tsx`
- Create: `apps/mobile-native/src/screens/ConnectionScreen.test.tsx`
- Create: `apps/mobile-native/src/screens/DesktopsScreen.test.tsx`
- Create: `apps/mobile-native/src/screens/TaskScreen.test.tsx`

- [ ] **Step 1: Write failing store tests for multi-desktop selection**

Create `apps/mobile-native/src/state/sessionStore.test.ts`:

```ts
import { createSessionStore } from "./sessionStore";

it("switches the selected desktop without dropping the desktop list", async () => {
  const store = createSessionStore();
  store.setDesktops([
    { id: "desktop-a", name: "Studio Mac", online: true, mode: "lan" },
    { id: "desktop-b", name: "Laptop", online: false, mode: "remote" },
  ]);

  store.selectDesktop("desktop-b");

  expect(store.getState().selectedDesktopId).toBe("desktop-b");
  expect(store.getState().desktops).toHaveLength(2);
});
```

- [ ] **Step 2: Run the store test to verify it fails**

Run: `cd apps/mobile-native && pnpm test -- --runInBand src/state/sessionStore.test.ts`
Expected: FAIL because `sessionStore` does not exist

- [ ] **Step 3: Add typed mobile API contracts and transports**

Create `apps/mobile-native/src/lib/api/types.ts`:

```ts
export interface DesktopSummary {
  id: string;
  name: string;
  online: boolean;
  mode: "lan" | "remote";
}

export interface TaskSummary {
  id: string;
  repoId: string;
  title: string;
  stage: string;
  lastOutputPreview: string;
}
```

Create `client.ts` around one transport interface:

```ts
export interface KannaTransport {
  listDesktops(): Promise<DesktopSummary[]>;
  listRepos(desktopId: string): Promise<RepoSummary[]>;
  listRecentTasks(desktopId: string): Promise<TaskSummary[]>;
  searchTasks(desktopId: string, query: string): Promise<TaskSummary[]>;
  subscribeSession(desktopId: string, sessionId: string, onData: (chunk: string) => void): Promise<() => void>;
  sendTerminalInput(desktopId: string, sessionId: string, input: string): Promise<void>;
}
```

Create `apps/mobile-native/src/lib/auth/authClient.ts`:

```ts
export interface AuthClient {
  getIdToken(): Promise<string | null>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}
```

Use that interface from the remote transport instead of baking Firebase calls straight into screens.

- [ ] **Step 4: Implement the session store and desktop persistence**

Create `apps/mobile-native/src/state/sessionStore.ts`:

```ts
export function createSessionStore() {
  let state: SessionState = {
    desktops: [],
    selectedDesktopId: null,
  };

  return {
    getState: () => state,
    setDesktops(desktops: DesktopSummary[]) {
      state = { ...state, desktops };
    },
    selectDesktop(desktopId: string) {
      state = { ...state, selectedDesktopId: desktopId };
    },
  };
}
```

- [ ] **Step 5: Build the desktops and task screens**

- [ ] **Step 5: Build the connection, desktops, and task screens**

Create `apps/mobile-native/src/screens/ConnectionScreen.tsx` with the two top-level entry points:

```tsx
export function ConnectionScreen() {
  const startLanPairing = () => {};
  const startRemoteSignIn = () => {};

  return (
    <View>
      <Button title="Connect on Local Network" onPress={startLanPairing} />
      <Button title="Sign In for Remote Access" onPress={startRemoteSignIn} />
    </View>
  );
}
```

Use the LAN path to accept a scanned or pasted pairing payload and persist the trusted desktop in `deviceStore`.
Use the remote path to call `authClient.signIn()`, then fetch the signed-in desktop list through `remoteTransport`.

Add `DesktopsScreen.tsx` with explicit desktop selection and mode badges:

```tsx
export function DesktopsScreen() {
  const { desktops, selectedDesktopId, selectDesktop } = useSessionStore();

  return (
    <FlatList
      data={desktops}
      renderItem={({ item }) => (
        <DesktopCard
          desktop={item}
          selected={item.id === selectedDesktopId}
          onPress={() => selectDesktop(item.id)}
        />
      )}
    />
  );
}
```

Add `TaskScreen.tsx` with a `TerminalPane` that subscribes through the typed client and exposes a simple input bar.

- [ ] **Step 6: Add screen tests for connection, selected-desktop, and terminal states**

Create `apps/mobile-native/src/screens/ConnectionScreen.test.tsx`:

```tsx
it("renders local and remote connection entry points", () => {
  render(<ConnectionScreen />);
  expect(screen.getByText("Connect on Local Network")).toBeTruthy();
  expect(screen.getByText("Sign In for Remote Access")).toBeTruthy();
});
```

Create `apps/mobile-native/src/screens/DesktopsScreen.test.tsx`:

```tsx
it("renders both paired desktops and highlights the selected one", () => {
  render(<DesktopsScreen />);
  expect(screen.getByText("Studio Mac")).toBeTruthy();
  expect(screen.getByText("Laptop")).toBeTruthy();
});
```

Create `apps/mobile-native/src/screens/TaskScreen.test.tsx` with a mocked transport that yields terminal data and verifies the input submit path.

- [ ] **Step 7: Run RN tests and typecheck**

Run:

```bash
cd apps/mobile-native && pnpm test -- --runInBand src/state/sessionStore.test.ts src/screens/ConnectionScreen.test.tsx src/screens/DesktopsScreen.test.tsx src/screens/TaskScreen.test.tsx
cd apps/mobile-native && pnpm run typecheck
```

Expected: PASS for state and screen tests, no TypeScript errors

- [ ] **Step 8: Commit**

```bash
git add apps/mobile-native/src/lib apps/mobile-native/src/state apps/mobile-native/src/screens apps/mobile-native/src/components
git commit -m "feat(mobile-native): add typed client and core multi-desktop screens"
```

---

## Task 7: Verification, Workspace Integration, And Documentation

Wire the new app into the workspace and make the verification path explicit.

**Files:**
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Add filtered root scripts for the RN app**

Update `package.json`:

```json
{
  "scripts": {
    "mobile-native:dev": "pnpm --filter @kanna/mobile-native dev",
    "mobile-native:test": "pnpm --filter @kanna/mobile-native test",
    "mobile-native:typecheck": "pnpm --filter @kanna/mobile-native typecheck"
  }
}
```

- [ ] **Step 2: Document the new mobile architecture**

In `README.md`, add a short section:

```md
## React Native Mobile Client

The production mobile direction lives in `apps/mobile-native/`.
It talks to the desktop-side `kanna-server` service over one typed Kanna API.
The older Tauri mobile app in `apps/mobile/` remains a prototype during migration.
```

- [ ] **Step 3: Run full milestone verification**

Run:

```bash
cd crates/kanna-server && cargo test
cd services/relay && pnpm test
cd apps/desktop && pnpm exec vitest run src/components/__tests__/MobileAccessPanel.test.ts
cd apps/desktop && pnpm exec tsc --noEmit
cd apps/mobile-native && pnpm test -- --runInBand
cd apps/mobile-native && pnpm run typecheck
```

Expected: PASS across the desktop-side service, relay, desktop integration, and RN client

- [ ] **Step 4: Commit**

```bash
git add package.json README.md
git commit -m "docs: wire react native mobile client into workspace"
```

---

## Self-Review

### Spec coverage
- Desktop-side service boundary: Tasks 1 and 2
- Multi-desktop support from day one: Tasks 1, 3, and 6
- LAN pairing without account: Tasks 2 and 4
- Remote paid path with outbound desktop connection: Task 3
- iPhone-first RN client: Tasks 5 and 6
- Mobile connection flows for LAN and Remote: Task 6
- First-release product scope (browse/search/terminal/light control): Task 6
- Desktop UI integration for pairing: Task 4

### Placeholder scan
- No `TBD` / `TODO`
- Every task names concrete files and commands
- Every verification step names the exact command to run

### Type consistency
- `desktopId` is used consistently for desktop routing and selection
- `KannaTransport` is the only mobile transport boundary
- `MobileApi` is the only desktop-side product boundary for LAN + Remote shaping
