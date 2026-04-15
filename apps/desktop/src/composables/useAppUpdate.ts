import { computed, getCurrentInstance, onBeforeUnmount, ref } from "vue";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { invoke } from "../invoke";
import { isTauri } from "../tauri-mock";

const STARTUP_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "readyToRestart" | "error";

interface UpdateHandle {
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
  downloadAndInstall(onEvent?: (progress: DownloadEvent) => void): Promise<void>;
  close(): Promise<void>;
}

export function useAppUpdate() {
  const status = ref<UpdateStatus>("idle");
  const updateRef = ref<UpdateHandle | null>(null);
  const updateVersion = ref<string | null>(null);
  const releaseNotes = ref<string | null>(null);
  const publishedAt = ref<string | null>(null);
  const dismissedVersion = ref<string | null>(null);
  const downloadedBytes = ref(0);
  const contentLength = ref<number | null>(null);
  const errorMessage = ref<string | null>(null);
  const visible = computed(
    () =>
      status.value === "available" ||
      status.value === "downloading" ||
      status.value === "readyToRestart" ||
      status.value === "error",
  );

  let started = false;
  let disposed = false;
  let checkInFlight: Promise<void> | null = null;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  let enabledPromise: Promise<boolean> | null = null;
  let updaterEnabled: boolean | null = null;

  async function ensureEnabled(): Promise<boolean> {
    if (updaterEnabled !== null) return updaterEnabled;
    if (enabledPromise) return enabledPromise;

    enabledPromise = (async () => {
      if (!isTauri) return false;
      if (import.meta.env.MODE === "development") return false;

      const worktree = await invoke<string>("read_env_var", { name: "KANNA_WORKTREE" }).catch(() => "");
      return worktree !== "1";
    })().then((enabled) => {
      updaterEnabled = enabled;
      return enabled;
    });

    return enabledPromise;
  }

  async function closeUpdateHandle(update: UpdateHandle | null): Promise<void> {
    if (!update) return;
    try {
      await update.close();
    } catch (error) {
      console.error("[updater] failed to close update handle", error);
    }
  }

  function resetAvailableState() {
    updateRef.value = null;
    updateVersion.value = null;
    releaseNotes.value = null;
    publishedAt.value = null;
    downloadedBytes.value = 0;
    contentLength.value = null;
    errorMessage.value = null;
  }

  async function runCheck(): Promise<void> {
    if (checkInFlight) return checkInFlight;

    checkInFlight = (async () => {
      if (!(await ensureEnabled())) return;
      if (status.value !== "downloading" && status.value !== "readyToRestart") {
        status.value = "checking";
      }

      let update: UpdateHandle | null;
      try {
        update = (await check()) as UpdateHandle | null;
      } catch (error) {
        if (status.value === "checking") {
          status.value = "idle";
        }
        console.error("[updater] check failed", error);
        return;
      }

      if (!update) {
        if (status.value === "checking") {
          status.value = "idle";
        }
        return;
      }

      if (dismissedVersion.value === update.version) {
        await closeUpdateHandle(update);
        if (status.value === "checking") {
          status.value = "idle";
        }
        return;
      }

      const previousUpdate = updateRef.value;
      if (previousUpdate) {
        await closeUpdateHandle(previousUpdate);
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
    void (async () => {
      if (disposed) return;
      if (!(await ensureEnabled())) return;
      if (disposed) return;

      startupTimer = setTimeout(() => {
        void runCheck();
        intervalTimer = setInterval(() => {
          void runCheck();
        }, CHECK_INTERVAL_MS);
      }, STARTUP_DELAY_MS);
    })();
  }

  function dismiss() {
    void closeUpdateHandle(updateRef.value);
    if (updateVersion.value) {
      dismissedVersion.value = updateVersion.value;
    }
    resetAvailableState();
    status.value = "idle";
  }

  async function install() {
    if (!updateRef.value) return;

    status.value = "downloading";
    downloadedBytes.value = 0;
    contentLength.value = null;
    errorMessage.value = null;

    try {
      await updateRef.value.downloadAndInstall((event: DownloadEvent) => {
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
    disposed = true;
    started = false;
    void closeUpdateHandle(updateRef.value);
    if (startupTimer) clearTimeout(startupTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    startupTimer = null;
    intervalTimer = null;
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(dispose);
  }

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
