# App Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add packaged macOS app update detection, user-driven install flow, and release-published updater artifacts for Kanna.

**Architecture:** Keep update logic in the desktop app shell, not the task store. A dedicated frontend controller will schedule background checks, own the prompt state machine, and call Tauri's updater and process plugins. Release automation in `scripts/ship.sh` will build architecture-specific updater bundles from Bazel's signed `.app` outputs, sign them with the Tauri updater key, and publish a static `latest.json` manifest alongside the DMGs.

**Tech Stack:** Vue 3, Vitest, Tauri v2 updater/process plugins, Rust, Bazel release outputs, shell scripting, GitHub Releases

---

## File Map

- `apps/desktop/src/composables/useAppUpdate.ts`
  Responsibility: own packaged-build gating, startup delay, periodic checks, dismiss suppression, install state, and restart action.
- `apps/desktop/src/composables/useAppUpdate.test.ts`
  Responsibility: cover the controller's timer behavior, duplicate suppression, install flow, and restart flow.
- `apps/desktop/src/components/AppUpdatePrompt.vue`
  Responsibility: render the global update prompt for available, downloading, ready-to-restart, and error states.
- `apps/desktop/src/components/__tests__/AppUpdatePrompt.test.ts`
  Responsibility: verify the prompt's buttons, release-notes rendering, progress UI, and retry/restart states.
- `apps/desktop/src/App.vue`
  Responsibility: initialize the updater controller and mount the global update prompt.
- `apps/desktop/src/App.test.ts`
  Responsibility: keep the app shell test stable by mocking the updater controller and verifying the prompt mount path.
- `apps/desktop/src/i18n/locales/en.json`
  Responsibility: English updater labels and messages.
- `apps/desktop/src/i18n/locales/ja.json`
  Responsibility: Japanese updater labels and messages.
- `apps/desktop/src/i18n/locales/ko.json`
  Responsibility: Korean updater labels and messages.
- `apps/desktop/src/updater.test.ts`
  Responsibility: static config coverage for updater dependencies, Tauri config, capability permissions, build-script pubkey wiring, and Rust plugin registration.
- `apps/desktop/package.json`
  Responsibility: frontend dependencies on `@tauri-apps/plugin-updater` and `@tauri-apps/plugin-process`.
- `pnpm-lock.yaml`
  Responsibility: lock the new desktop JavaScript dependencies.
- `apps/desktop/src-tauri/Cargo.toml`
  Responsibility: switch from the placeholder updater crate to the official Tauri updater/process crates.
- `apps/desktop/src-tauri/Cargo.lock`
  Responsibility: lock the new Rust dependencies.
- `apps/desktop/src-tauri/build.rs`
  Responsibility: inject `KANNA_UPDATER_PUBKEY` into compile-time env wiring.
- `apps/desktop/src-tauri/src/lib.rs`
  Responsibility: register the official updater/process plugins and configure the updater endpoint/pubkey at runtime.
- `apps/desktop/src-tauri/tauri.conf.json`
  Responsibility: enable updater artifact generation for packaged builds.
- `apps/desktop/src-tauri/capabilities/default.json`
  Responsibility: grant updater and restart permissions to the desktop window.
- `apps/desktop/src-tauri/BUILD.bazel`
  Responsibility: remove the explicit placeholder updater crate dependency from Bazel's desktop Rust targets.
- `apps/desktop/src/ship.test.ts`
  Responsibility: static release-script coverage for updater artifact naming, signing requirements, and manifest publication.
- `scripts/ship.sh`
  Responsibility: create `.app.tar.gz` updater bundles from Bazel app outputs, sign them, write `latest.json`, and upload all release assets.

### Task 1: Add the app-shell updater controller with timer and install tests

**Files:**
- Create: `apps/desktop/src/composables/useAppUpdate.ts`
- Create: `apps/desktop/src/composables/useAppUpdate.test.ts`

- [ ] **Step 1: Write the failing controller tests**

```ts
// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

const checkMock = vi.fn();
const relaunchMock = vi.fn();
const invokeMock = vi.fn();
const downloadAndInstallMock = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => checkMock(...args),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: (...args: unknown[]) => relaunchMock(...args),
}));

vi.mock("../invoke", () => ({
  invoke: (command: string, args?: Record<string, unknown>) => invokeMock(command, args),
}));

import { useAppUpdate } from "./useAppUpdate";

function makeUpdate(version: string) {
  return {
    version,
    currentVersion: "0.0.38",
    body: `Notes for ${version}`,
    date: "2026-04-15T00:00:00Z",
    downloadAndInstall: downloadAndInstallMock,
  };
}

async function flush() {
  await Promise.resolve();
  await nextTick();
}

describe("useAppUpdate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    checkMock.mockReset();
    relaunchMock.mockReset();
    invokeMock.mockReset();
    downloadAndInstallMock.mockReset();
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "read_env_var" && args?.name === "KANNA_WORKTREE") return "";
      throw new Error(`unexpected invoke: ${command}`);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for the startup delay, then checks again every 6 hours", async () => {
    checkMock.mockResolvedValue(null);
    const updater = useAppUpdate();
    updater.start();

    expect(checkMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15000);
    await flush();
    expect(checkMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    await flush();
    expect(checkMock).toHaveBeenCalledTimes(2);
  });

  it("suppresses a dismissed version for the rest of the session but surfaces a newer one", async () => {
    checkMock
      .mockResolvedValueOnce(makeUpdate("0.0.39"))
      .mockResolvedValueOnce(makeUpdate("0.0.39"))
      .mockResolvedValueOnce(makeUpdate("0.0.40"));

    const updater = useAppUpdate();
    updater.start();

    await vi.advanceTimersByTimeAsync(15000);
    await flush();
    expect(updater.status.value).toBe("available");
    expect(updater.updateVersion.value).toBe("0.0.39");

    updater.dismiss();
    expect(updater.dismissedVersion.value).toBe("0.0.39");
    expect(updater.status.value).toBe("idle");

    await updater.checkNow();
    expect(updater.status.value).toBe("idle");

    await updater.checkNow();
    expect(updater.status.value).toBe("available");
    expect(updater.updateVersion.value).toBe("0.0.40");
  });

  it("downloads the selected update and becomes restart-ready", async () => {
    downloadAndInstallMock.mockImplementation(async (onEvent?: (event: { event: string; data: { chunkLength?: number; contentLength?: number } }) => void) => {
      onEvent?.({ event: "Started", data: { contentLength: 42 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 10 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 32 } });
      onEvent?.({ event: "Finished", data: {} });
    });
    checkMock.mockResolvedValue(makeUpdate("0.0.39"));

    const updater = useAppUpdate();
    await updater.checkNow();
    await updater.install();

    expect(updater.status.value).toBe("readyToRestart");
    expect(updater.downloadedBytes.value).toBe(42);
  });

  it("relaunches only after a successful install", async () => {
    downloadAndInstallMock.mockResolvedValue(undefined);
    checkMock.mockResolvedValue(makeUpdate("0.0.39"));

    const updater = useAppUpdate();
    await updater.checkNow();
    await updater.install();
    await updater.restartNow();

    expect(relaunchMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the controller tests to verify they fail**

Run: `cd apps/desktop && pnpm test -- src/composables/useAppUpdate.test.ts`
Expected: `FAIL` because `useAppUpdate.ts` does not exist yet.

- [ ] **Step 3: Implement the controller with explicit session state and timers**

```ts
import { computed, onBeforeUnmount, ref } from "vue";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { invoke } from "../invoke";
import { isTauri } from "../tauri-mock";

const STARTUP_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function useAppUpdate() {
  const status = ref<"idle" | "checking" | "available" | "downloading" | "readyToRestart" | "error">("idle");
  const updateRef = ref<Update | null>(null);
  const updateVersion = ref<string | null>(null);
  const releaseNotes = ref<string | null>(null);
  const publishedAt = ref<string | null>(null);
  const dismissedVersion = ref<string | null>(null);
  const downloadedBytes = ref(0);
  const contentLength = ref<number | null>(null);
  const errorMessage = ref<string | null>(null);
  const visible = computed(() => status.value === "available" || status.value === "downloading" || status.value === "readyToRestart" || status.value === "error");

  let started = false;
  let checkInFlight: Promise<void> | null = null;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;

  async function isEnabled(): Promise<boolean> {
    if (!isTauri()) return false;
    if (import.meta.env.DEV) return false;
    const worktree = await invoke<string>("read_env_var", { name: "KANNA_WORKTREE" }).catch(() => "");
    return worktree !== "1";
  }

  async function runCheck(): Promise<void> {
    if (checkInFlight) return checkInFlight;
    checkInFlight = (async () => {
      if (!(await isEnabled())) return;
      status.value = status.value === "downloading" || status.value === "readyToRestart" ? status.value : "checking";
      const update = await check();
      if (!update) {
        if (status.value === "checking") status.value = "idle";
        return;
      }
      if (dismissedVersion.value === update.version) {
        if (status.value === "checking") status.value = "idle";
        return;
      }
      updateRef.value = update;
      updateVersion.value = update.version;
      releaseNotes.value = update.body ?? "";
      publishedAt.value = update.date ?? null;
      downloadedBytes.value = 0;
      contentLength.value = null;
      errorMessage.value = null;
      status.value = "available";
    })().finally(() => {
      checkInFlight = null;
    });

    return checkInFlight;
  }

  function start() {
    if (started) return;
    started = true;
    startupTimer = setTimeout(() => {
      void runCheck();
      intervalTimer = setInterval(() => {
        void runCheck();
      }, CHECK_INTERVAL_MS);
    }, STARTUP_DELAY_MS);
  }

  function dismiss() {
    if (updateVersion.value) dismissedVersion.value = updateVersion.value;
    updateRef.value = null;
    status.value = "idle";
  }

  async function install() {
    if (!updateRef.value) return;
    status.value = "downloading";
    downloadedBytes.value = 0;
    contentLength.value = null;
    errorMessage.value = null;
    try {
      await updateRef.value.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength.value = event.data.contentLength ?? null;
            break;
          case "Progress":
            downloadedBytes.value += event.data.chunkLength ?? 0;
            break;
          case "Finished":
            break;
        }
      });
      status.value = "readyToRestart";
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
      status.value = "error";
    }
  }

  async function restartNow() {
    if (status.value !== "readyToRestart") return;
    await relaunch();
  }

  function dispose() {
    if (startupTimer) clearTimeout(startupTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    started = false;
  }

  onBeforeUnmount(dispose);

  return {
    status,
    updateVersion,
    releaseNotes,
    publishedAt,
    dismissedVersion,
    downloadedBytes,
    contentLength,
    errorMessage,
    visible,
    start,
    checkNow: runCheck,
    dismiss,
    install,
    restartNow,
    dispose,
  };
}
```

- [ ] **Step 4: Re-run the controller tests**

Run: `cd apps/desktop && pnpm test -- src/composables/useAppUpdate.test.ts`
Expected: `PASS`

- [ ] **Step 5: Commit the controller**

```bash
git add apps/desktop/src/composables/useAppUpdate.ts apps/desktop/src/composables/useAppUpdate.test.ts
git commit -m "feat: add app update controller"
```

### Task 2: Add the update prompt UI, app wiring, and i18n strings

**Files:**
- Create: `apps/desktop/src/components/AppUpdatePrompt.vue`
- Create: `apps/desktop/src/components/__tests__/AppUpdatePrompt.test.ts`
- Modify: `apps/desktop/src/App.vue`
- Modify: `apps/desktop/src/App.test.ts`
- Modify: `apps/desktop/src/i18n/locales/en.json`
- Modify: `apps/desktop/src/i18n/locales/ja.json`
- Modify: `apps/desktop/src/i18n/locales/ko.json`

- [ ] **Step 1: Write the failing prompt and app-shell tests**

```ts
// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import AppUpdatePrompt from "../AppUpdatePrompt.vue";

describe("AppUpdatePrompt", () => {
  it("renders release notes and update actions in the available state", () => {
    const wrapper = mount(AppUpdatePrompt, {
      props: {
        status: "available",
        version: "0.0.39",
        releaseNotes: "Bug fixes",
        downloadedBytes: 0,
        contentLength: null,
        errorMessage: null,
      },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    expect(wrapper.text()).toContain("0.0.39");
    expect(wrapper.text()).toContain("Bug fixes");
    expect(wrapper.text()).toContain("updates.update");
    expect(wrapper.text()).toContain("actions.dismiss");
  });

  it("shows restart actions after the install completes", () => {
    const wrapper = mount(AppUpdatePrompt, {
      props: {
        status: "readyToRestart",
        version: "0.0.39",
        releaseNotes: "",
        downloadedBytes: 42,
        contentLength: 42,
        errorMessage: null,
      },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    expect(wrapper.text()).toContain("updates.restartNow");
    expect(wrapper.text()).toContain("updates.later");
  });
});
```

```ts
it("renders the update prompt when the app updater exposes a visible state", async () => {
  vi.doMock("./composables/useAppUpdate", () => ({
    useAppUpdate: () => ({
      status: { value: "available" },
      updateVersion: { value: "0.0.39" },
      releaseNotes: { value: "Bug fixes" },
      downloadedBytes: { value: 0 },
      contentLength: { value: null },
      errorMessage: { value: null },
      visible: { value: true },
      start: vi.fn(),
      dismiss: vi.fn(),
      install: vi.fn(),
      restartNow: vi.fn(),
    }),
  }));

  const wrapper = await mountApp(SidebarWithRepoStub);
  await flushPromises();

  expect(wrapper.findComponent({ name: "AppUpdatePrompt" }).exists()).toBe(true);
});
```

- [ ] **Step 2: Run the UI tests to verify they fail**

Run: `cd apps/desktop && pnpm test -- src/components/__tests__/AppUpdatePrompt.test.ts src/App.test.ts`
Expected: `FAIL` because `AppUpdatePrompt.vue` does not exist and `App.vue` does not import it.

- [ ] **Step 3: Implement the prompt component, app wiring, and locale strings**

```vue
<!-- apps/desktop/src/components/AppUpdatePrompt.vue -->
<script setup lang="ts">
const props = defineProps<{
  status: "available" | "downloading" | "readyToRestart" | "error"
  version: string
  releaseNotes: string
  downloadedBytes: number
  contentLength: number | null
  errorMessage: string | null
}>()

const emit = defineEmits<{
  dismiss: []
  install: []
  restart: []
  retry: []
  later: []
}>()
</script>

<template>
  <section class="update-prompt" role="dialog" aria-live="polite">
    <header class="update-header">
      <h2>{{ $t("updates.title") }}</h2>
      <div class="version">{{ $t("updates.versionLabel", { version }) }}</div>
    </header>

    <p v-if="releaseNotes" class="notes">{{ releaseNotes }}</p>
    <p v-if="status === 'downloading'" class="progress">
      {{ $t("updates.downloading", { downloaded: downloadedBytes, total: contentLength ?? "?" }) }}
    </p>
    <p v-if="status === 'error' && errorMessage" class="error">{{ errorMessage }}</p>

    <footer class="actions">
      <button v-if="status === 'available'" @click="emit('dismiss')">{{ $t("actions.dismiss") }}</button>
      <button v-if="status === 'available'" class="primary" @click="emit('install')">{{ $t("updates.update") }}</button>
      <button v-if="status === 'readyToRestart'" @click="emit('later')">{{ $t("updates.later") }}</button>
      <button v-if="status === 'readyToRestart'" class="primary" @click="emit('restart')">{{ $t("updates.restartNow") }}</button>
      <button v-if="status === 'error'" @click="emit('dismiss')">{{ $t("actions.dismiss") }}</button>
      <button v-if="status === 'error'" class="primary" @click="emit('retry')">{{ $t("updates.retry") }}</button>
    </footer>
  </section>
</template>
```

```ts
// apps/desktop/src/App.vue
import AppUpdatePrompt from "./components/AppUpdatePrompt.vue";
import { useAppUpdate } from "./composables/useAppUpdate";

const appUpdate = useAppUpdate();

onMounted(async () => {
  await store.init(db);
  appUpdate.start();
  // existing init continues...
});
```

```vue
<AppUpdatePrompt
  v-if="appUpdate.visible.value"
  :status="appUpdate.status.value"
  :version="appUpdate.updateVersion.value || ''"
  :release-notes="appUpdate.releaseNotes.value || ''"
  :downloaded-bytes="appUpdate.downloadedBytes.value"
  :content-length="appUpdate.contentLength.value"
  :error-message="appUpdate.errorMessage.value"
  @dismiss="appUpdate.dismiss()"
  @install="appUpdate.install()"
  @retry="appUpdate.install()"
  @restart="appUpdate.restartNow()"
  @later="appUpdate.dismiss()"
/>
```

```json
"updates": {
  "title": "Update available",
  "versionLabel": "Kanna {version} is available",
  "update": "Update",
  "downloading": "Downloading {downloaded} / {total}",
  "restartNow": "Restart Now",
  "later": "Later",
  "retry": "Retry"
}
```

- [ ] **Step 4: Re-run the UI tests**

Run: `cd apps/desktop && pnpm test -- src/components/__tests__/AppUpdatePrompt.test.ts src/App.test.ts`
Expected: `PASS`

- [ ] **Step 5: Commit the UI wiring**

```bash
git add apps/desktop/src/components/AppUpdatePrompt.vue apps/desktop/src/components/__tests__/AppUpdatePrompt.test.ts apps/desktop/src/App.vue apps/desktop/src/App.test.ts apps/desktop/src/i18n/locales/en.json apps/desktop/src/i18n/locales/ja.json apps/desktop/src/i18n/locales/ko.json
git commit -m "feat: add app update prompt"
```

### Task 3: Switch the desktop runtime to the official Tauri updater/process plugins

**Files:**
- Create: `apps/desktop/src/updater.test.ts`
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/Cargo.lock`
- Modify: `apps/desktop/src-tauri/build.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `apps/desktop/src-tauri/capabilities/default.json`
- Modify: `apps/desktop/src-tauri/BUILD.bazel`

- [ ] **Step 1: Write the failing static updater-runtime tests**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import desktopPkg from "../package.json";
import tauriConf from "../src-tauri/tauri.conf.json";

const repoRoot = resolve(process.cwd(), "../..");

describe("desktop updater runtime", () => {
  it("adds the official updater and process JavaScript plugins", () => {
    expect(desktopPkg.dependencies?.["@tauri-apps/plugin-updater"]).toBeDefined();
    expect(desktopPkg.dependencies?.["@tauri-apps/plugin-process"]).toBeDefined();
  });

  it("enables updater artifact generation in tauri config", () => {
    expect(tauriConf.bundle.createUpdaterArtifacts).toBe(true);
  });

  it("grants updater and restart permissions to the main capability", () => {
    const capability = readFileSync(
      resolve(repoRoot, "apps/desktop/src-tauri/capabilities/default.json"),
      "utf8",
    );
    expect(capability).toContain('"updater:default"');
    expect(capability).toContain('"process:allow-relaunch"');
  });

  it("injects the updater pubkey through the build script and registers the official plugins in Rust", () => {
    const buildScript = readFileSync(
      resolve(repoRoot, "apps/desktop/src-tauri/build.rs"),
      "utf8",
    );
    const desktopLib = readFileSync(
      resolve(repoRoot, "apps/desktop/src-tauri/src/lib.rs"),
      "utf8",
    );
    const desktopBuild = readFileSync(
      resolve(repoRoot, "apps/desktop/src-tauri/BUILD.bazel"),
      "utf8",
    );

    expect(buildScript).toContain("cargo:rustc-env=KANNA_UPDATER_PUBKEY=");
    expect(buildScript).toContain("cargo:rerun-if-env-changed=KANNA_UPDATER_PUBKEY");
    expect(desktopLib).toContain('pub(crate) const KANNA_UPDATER_PUBKEY: &str = env!("KANNA_UPDATER_PUBKEY");');
    expect(desktopLib).toContain("tauri_plugin_updater::Builder::new()");
    expect(desktopLib).toContain("tauri_plugin_process::init()");
    expect(desktopLib).not.toContain("tauri_plugin_delta_updater::init()");
    expect(desktopBuild).not.toContain("//crates/tauri-plugin-delta-updater:tauri_plugin_delta_updater");
  });
});
```

- [ ] **Step 2: Run the static updater-runtime tests to verify they fail**

Run: `cd apps/desktop && pnpm test -- src/updater.test.ts`
Expected: `FAIL` because the project still references the placeholder updater crate and has no official updater runtime configuration.

- [ ] **Step 3: Add the official dependencies, permissions, and Rust plugin registration**

```json
// apps/desktop/package.json
"dependencies": {
  "@tauri-apps/plugin-process": "^2",
  "@tauri-apps/plugin-updater": "^2",
  "@tauri-apps/plugin-dialog": "^2.6.0",
  "@tauri-apps/plugin-opener": "^2",
  "@tauri-apps/plugin-shell": "^2",
  "@tauri-apps/plugin-sql": "^2.3.2"
}
```

```toml
# apps/desktop/src-tauri/Cargo.toml
tauri-plugin-process = "2"
tauri-plugin-updater = "2"

# remove
tauri-plugin-delta-updater = { path = "../../../crates/tauri-plugin-delta-updater" }
```

```rust
// apps/desktop/src-tauri/build.rs
let updater_pubkey = std::env::var("KANNA_UPDATER_PUBKEY")
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
    .unwrap_or_default();
println!("cargo:rustc-env=KANNA_UPDATER_PUBKEY={updater_pubkey}");
println!("cargo:rerun-if-env-changed=KANNA_UPDATER_PUBKEY");
```

```rust
// apps/desktop/src-tauri/src/lib.rs
pub(crate) const KANNA_UPDATER_PUBKEY: &str = env!("KANNA_UPDATER_PUBKEY");
const KANNA_UPDATE_ENDPOINT: &str =
    "https://github.com/jemdiggity/kanna/releases/latest/download/latest.json";

pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(KANNA_UPDATER_PUBKEY.trim())
                .endpoints(vec![KANNA_UPDATE_ENDPOINT.to_string()])
                .build(),
        );
```

```json
// apps/desktop/src-tauri/tauri.conf.json
"bundle": {
  "active": true,
  "targets": "all",
  "createUpdaterArtifacts": true,
  "macOS": {
    "infoPlist": "Info.plist"
  }
}
```

```json
// apps/desktop/src-tauri/capabilities/default.json
"permissions": [
  "core:default",
  "core:window:allow-create",
  "core:window:allow-set-title",
  "core:webview:allow-create-webview-window",
  "opener:default",
  "shell:allow-open",
  "shell:allow-execute",
  "sql:default",
  "sql:allow-load",
  "sql:allow-execute",
  "sql:allow-select",
  "sql:allow-close",
  "dialog:default",
  "updater:default",
  "process:allow-relaunch"
]
```

```python
# apps/desktop/src-tauri/BUILD.bazel
deps = all_crate_deps(
    normal = True,
    package_name = "apps/desktop/src-tauri",
) + [
    ":desktop_build_script",
    "//crates/claude-agent-sdk:claude_agent_sdk",
]
```

Run immediately after editing dependencies:

```bash
pnpm install --lockfile-only
cd apps/desktop/src-tauri && cargo check
```

- [ ] **Step 4: Re-run the static updater-runtime tests and Rust compile check**

Run: `cd apps/desktop && pnpm test -- src/updater.test.ts src/sidecars.test.ts`
Expected: `PASS`

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: `Finished dev profile` with no unresolved plugin symbols

- [ ] **Step 5: Commit the runtime switch**

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/updater.test.ts apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock apps/desktop/src-tauri/build.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/capabilities/default.json apps/desktop/src-tauri/BUILD.bazel
git commit -m "feat: use official tauri updater runtime"
```

### Task 4: Extend `ship.sh` to publish updater bundles, signatures, and `latest.json`

**Files:**
- Modify: `apps/desktop/src/ship.test.ts`
- Modify: `scripts/ship.sh`

- [ ] **Step 1: Write the failing release-script assertions**

```ts
describe("updater release assets", () => {
  it("requires updater signing inputs before publishing a release", () => {
    const shipScript = readFileSync(
      resolve(repoRoot, "scripts/ship.sh"),
      "utf8",
    );

    expect(shipScript).toContain("KANNA_UPDATER_PUBKEY");
    expect(shipScript).toContain("TAURI_PRIVATE_KEY_PATH");
    expect(shipScript).toContain("TAURI_PRIVATE_KEY_PASSWORD");
  });

  it("creates architecture-specific updater tarballs and signatures", () => {
    const shipScript = readFileSync(
      resolve(repoRoot, "scripts/ship.sh"),
      "utf8",
    );

    expect(shipScript).toContain('echo "Kanna_${VERSION}_${suffix}.app.tar.gz"');
    expect(shipScript).toContain("tauri signer sign");
    expect(shipScript).toContain(".app.tar.gz.sig");
  });

  it("publishes a latest.json manifest alongside the release assets", () => {
    const shipScript = readFileSync(
      resolve(repoRoot, "scripts/ship.sh"),
      "utf8",
    );

    expect(shipScript).toContain("latest.json");
    expect(shipScript).toContain("darwin-aarch64");
    expect(shipScript).toContain("darwin-x86_64");
    expect(shipScript).toContain("gh release upload");
  });
});
```

- [ ] **Step 2: Run the release-script tests to verify they fail**

Run: `cd apps/desktop && pnpm test -- src/ship.test.ts`
Expected: `FAIL` because `ship.sh` only builds and uploads DMGs today.

- [ ] **Step 3: Implement updater asset creation, signing, and manifest publishing in `ship.sh`**

```bash
updater_asset_name() {
    local label="$1"
    local suffix
    suffix="$(installer_arch_suffix "$label")"
    echo "Kanna_${VERSION}_${suffix}.app.tar.gz"
}

updater_signature_name() {
    echo "$(updater_asset_name "$1").sig"
}

updater_platform_key() {
    case "$1" in
        arm64) echo "darwin-aarch64" ;;
        x86_64) echo "darwin-x86_64" ;;
        *) echo "unknown updater platform for $1" >&2; exit 1 ;;
    esac
}

signed_app_target_for_label() {
    case "$1" in
        arm64) echo "//:kanna_signed_app_release_arm64" ;;
        x86_64) echo "//:kanna_signed_app_release_x86_64" ;;
        *) echo "unknown app target for $1" >&2; exit 1 ;;
    esac
}

create_updater_bundle() {
    local app_source="$1"
    local bundle_dest="$2"
    local app_dir
    app_dir="$(dirname "$app_source")"
    tar -C "$app_dir" -czf "$bundle_dest" "$(basename "$app_source")"
}

sign_updater_bundle() {
    local bundle_path="$1"
    TAURI_PRIVATE_KEY_PATH="$TAURI_PRIVATE_KEY_PATH" \
    TAURI_PRIVATE_KEY_PASSWORD="${TAURI_PRIVATE_KEY_PASSWORD:-}" \
      pnpm --dir "$ROOT/apps/desktop" exec tauri signer sign "$bundle_path" > "${bundle_path}.sig"
}
```

```bash
if [[ "$RELEASE" = true ]]; then
    [[ -n "${KANNA_UPDATER_PUBKEY:-}" ]] || { echo "Error: Missing KANNA_UPDATER_PUBKEY"; exit 1; }
    [[ -n "${TAURI_PRIVATE_KEY_PATH:-}" ]] || { echo "Error: Missing TAURI_PRIVATE_KEY_PATH"; exit 1; }
    if [[ "${#ARCH_LABELS[@]}" -ne 2 ]]; then
        echo "Error: updater releases must include both arm64 and x86_64 artifacts"
        exit 1
    fi
    RELEASE_NOTES="$(
        gh api "repos/jemdiggity/kanna/releases/generate-notes" \
            -X POST \
            -f tag_name="v$VERSION" \
            -f target_commitish="main" \
            --jq '.body'
    )"
else
    RELEASE_NOTES="Dry-run updater manifest for v$VERSION"
fi

UPDATER_PATHS=()
declare -A UPDATER_URLS
declare -A UPDATER_SIGNATURES

for LABEL in "${ARCH_LABELS[@]}"; do
    APP_SOURCE="$(resolve_bazel_output "$(signed_app_target_for_label "$LABEL")")"
    BUNDLE_NAME="$(updater_asset_name "$LABEL")"
    BUNDLE_PATH="$RELEASE_DIR/$BUNDLE_NAME"
    create_updater_bundle "$APP_SOURCE" "$BUNDLE_PATH"
    sign_updater_bundle "$BUNDLE_PATH"
    SIG_PATH="${BUNDLE_PATH}.sig"
    UPDATER_PATHS+=("$BUNDLE_PATH" "$SIG_PATH")
    PLATFORM_KEY="$(updater_platform_key "$LABEL")"
    UPDATER_URLS["$PLATFORM_KEY"]="https://github.com/jemdiggity/kanna/releases/download/v$VERSION/$BUNDLE_NAME"
    UPDATER_SIGNATURES["$PLATFORM_KEY"]="$(tr -d '\n' < "$SIG_PATH")"
done

UPDATER_PLATFORMS_JSON="$(
    URL_DARWIN_AARCH64="${UPDATER_URLS[darwin-aarch64]}" \
    SIG_DARWIN_AARCH64="${UPDATER_SIGNATURES[darwin-aarch64]}" \
    URL_DARWIN_X86_64="${UPDATER_URLS[darwin-x86_64]}" \
    SIG_DARWIN_X86_64="${UPDATER_SIGNATURES[darwin-x86_64]}" \
    node <<'EOF'
const candidates = [
  ["darwin-aarch64", process.env.URL_DARWIN_AARCH64, process.env.SIG_DARWIN_AARCH64],
  ["darwin-x86_64", process.env.URL_DARWIN_X86_64, process.env.SIG_DARWIN_X86_64],
];
const platforms = Object.fromEntries(
  candidates
    .filter(([, url, signature]) => url && signature)
    .map(([key, url, signature]) => [key, { signature, url }]),
);
process.stdout.write(JSON.stringify(platforms));
EOF
)"
```

```bash
LATEST_JSON="$RELEASE_DIR/latest.json"
RELEASE_NOTES="$RELEASE_NOTES" \
UPDATER_PLATFORMS_JSON="$UPDATER_PLATFORMS_JSON" \
VERSION="$VERSION" \
node <<'EOF' > "$LATEST_JSON"
const fs = require("node:fs");
const version = process.env.VERSION;
const notes = process.env.RELEASE_NOTES;
const pubDate = new Date().toISOString();
const platforms = JSON.parse(process.env.UPDATER_PLATFORMS_JSON);
process.stdout.write(JSON.stringify({
  version,
  notes,
  pub_date: pubDate,
  platforms,
}, null, 2));
EOF
```

```bash
if [[ "$RELEASE_EXISTS" = true ]]; then
    gh release upload "v$VERSION" "${DMG_PATHS[@]}" "${UPDATER_PATHS[@]}" "$LATEST_JSON" --clobber
else
    gh release create "v$VERSION" "${DMG_PATHS[@]}" "${UPDATER_PATHS[@]}" "$LATEST_JSON" \
        --title "Kanna v$VERSION" \
        --generate-notes
fi
```

- [ ] **Step 4: Re-run the release-script tests**

Run: `cd apps/desktop && pnpm test -- src/ship.test.ts`
Expected: `PASS`

- [ ] **Step 5: Commit the release automation**

```bash
git add apps/desktop/src/ship.test.ts scripts/ship.sh
git commit -m "feat: publish updater artifacts in ship"
```

### Task 5: Run the full verification set and land the feature as one coherent branch

**Files:**
- Modify: `pnpm-lock.yaml`
- Modify: `apps/desktop/src-tauri/Cargo.lock`
- Modify: any files adjusted during test fixes from Tasks 1-4

- [ ] **Step 1: Run the focused frontend test suite**

Run: `cd apps/desktop && pnpm test -- src/composables/useAppUpdate.test.ts src/components/__tests__/AppUpdatePrompt.test.ts src/App.test.ts src/updater.test.ts src/ship.test.ts src/sidecars.test.ts`
Expected: `PASS`

- [ ] **Step 2: Run TypeScript verification**

Run: `cd apps/desktop && pnpm exec tsc --noEmit`
Expected: no output other than a successful exit

- [ ] **Step 3: Run Rust formatting and lint verification**

Run: `cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: `Finished` output with no clippy warnings

- [ ] **Step 4: Dry-run the release artifact path**

Run: `KANNA_UPDATER_PUBKEY='test-pubkey' TAURI_PRIVATE_KEY_PATH="$HOME/.tauri/kanna.key" TAURI_PRIVATE_KEY_PASSWORD='' ./scripts/ship.sh --dry-run --arm64`
Expected: `.build/release/` contains one arm64 DMG, one arm64 `.app.tar.gz`, one arm64 `.app.tar.gz.sig`, and `latest.json`

- [ ] **Step 5: Commit the verified feature branch**

```bash
git add apps/desktop apps/desktop/src-tauri scripts/ship.sh pnpm-lock.yaml
git commit -m "feat: add packaged app updater"
```
