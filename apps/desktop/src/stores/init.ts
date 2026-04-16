import { getSetting, getUnblockedItems, listRepos, type DbHandle, type PipelineItem } from "@kanna/db";
import { invoke } from "../invoke";
import { isTauri } from "../tauri-mock";
import { listen } from "../listen";
import { clearCachedTerminalState } from "../composables/terminalStateCache";
import {
  getTaskIdFromTeardownSessionId,
  isTeardownSessionId,
  reportCloseSessionError,
  reportPrewarmSessionError,
  shouldAutoCloseTaskAfterTeardownExit,
  shouldClearCachedTerminalStateOnSessionExit,
} from "./kannaCleanup";
import { formatAppWindowTitle, type AppBuildInfo } from "./windowTitle";
import { isTeardownStage } from "./taskStages";
import { requireService, type StoreContext } from "./state";

export interface InitApi {
  init: (db: DbHandle) => Promise<void>;
  loadPreferences: () => Promise<void>;
  savePreference: (key: string, value: string) => Promise<void>;
}

export function createInitApi(
  context: StoreContext,
  ports: import("./ports").PortsStore,
  tasks: Pick<import("./tasks").TasksApi, "checkUnblocked" | "handleAgentFinished" | "startBlockedTask">,
): InitApi {
  async function loadPreferences() {
    const suspendAfter = await getSetting(context.requireDb(), "suspendAfterMinutes");
    if (suspendAfter) context.state.suspendAfterMinutes.value = parseInt(suspendAfter, 10) || 30;
    const killAfter = await getSetting(context.requireDb(), "killAfterMinutes");
    if (killAfter) context.state.killAfterMinutes.value = parseInt(killAfter, 10) || 60;
    const ide = await getSetting(context.requireDb(), "ideCommand");
    if (ide) context.state.ideCommand.value = ide;
    const hideShortcuts = await getSetting(context.requireDb(), "hideShortcutsOnStartup");
    context.state.hideShortcutsOnStartup.value = hideShortcuts === "true";
    const linger = await getSetting(context.requireDb(), "dev.lingerTerminals");
    context.state.devLingerTerminals.value = linger === "true";
  }

  async function savePreference(key: string, value: string) {
    const { setSetting } = await import("@kanna/db");
    await setSetting(context.requireDb(), key, value);
    await loadPreferences();
  }

  async function init(db: DbHandle) {
    context.state.db.value = db;
    await loadPreferences();

    const { updatePipelineItemActivity, closePipelineItem } = await import("@kanna/db");

    const workingItems = await context.requireDb().select<PipelineItem>(
      "SELECT * FROM pipeline_item WHERE activity = 'working'",
    );
    for (const item of workingItems) {
      await updatePipelineItemActivity(context.requireDb(), item.id, "unread");
    }

    const eagerRepos = await listRepos(context.requireDb());
    const eagerItems: PipelineItem[] = [];
    const { listPipelineItems } = await import("@kanna/db");
    for (const repo of eagerRepos) {
      eagerItems.push(...await listPipelineItems(context.requireDb(), repo.id));
    }

    if (isTauri) {
      for (const item of eagerItems) {
        if (!item.branch || item.stage === "done") continue;
        const repo = eagerRepos.find((candidate) => candidate.id === item.repo_id);
        if (!repo) continue;
        const worktreePath = `${repo.path}/.kanna-worktrees/${item.branch}`;
        const exists = await invoke<boolean>("file_exists", { path: worktreePath });
        if (!exists) {
          console.warn(`[store] closing orphaned task ${item.id}: worktree missing at ${worktreePath}`);
          await ports.closeTaskAndReleasePorts(item.id, (id) => closePipelineItem(context.requireDb(), id));
          item.stage = "done";
        }
      }
    }

    const unblockedItems = await getUnblockedItems(context.requireDb());
    for (const item of unblockedItems) {
      console.debug(`[store] auto-starting previously blocked task: ${item.id}`);
      await tasks.startBlockedTask(item);
    }

    context.bump();

    const savedRepo = await getSetting(context.requireDb(), "selected_repo_id");
    const savedItem = await getSetting(context.requireDb(), "selected_item_id");
    if (savedRepo && eagerRepos.some((repo) => repo.id === savedRepo)) {
      context.state.selectedRepoId.value = savedRepo;
      if (savedItem && eagerItems.some((item) => item.id === savedItem && item.stage !== "done")) {
        requireService(context.services.restoreSelection, "restoreSelection")(savedItem);
      }
    } else if (eagerRepos.length === 1) {
      context.state.selectedRepoId.value = eagerRepos[0].id;
    }

    if (isTauri) {
      try {
        const [branch, commitHash, worktree, gitInfo] = await Promise.all([
          invoke<string>("read_env_var", { name: "KANNA_BUILD_BRANCH" }).catch(() => ""),
          invoke<string>("read_env_var", { name: "KANNA_BUILD_COMMIT" }).catch(() => ""),
          invoke<string>("read_env_var", { name: "KANNA_BUILD_WORKTREE" }).catch(() => ""),
          invoke<{ version: string }>("git_app_info").catch(() => ({ version: "" })),
        ]);
        const title = formatAppWindowTitle({
          branch,
          commitHash,
          worktree,
          version: gitInfo.version,
        } satisfies AppBuildInfo);
        if (title) {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().setTitle(title);
        }
      } catch (error) {
        console.error("[store] failed to set window title:", error);
      }
    }

    if (isTauri) {
      for (const item of eagerItems) {
        if (!item.branch || item.stage === "done") continue;
        const repo = eagerRepos.find((candidate) => candidate.id === item.repo_id);
        if (!repo) continue;
        const worktreePath = `${repo.path}/.kanna-worktrees/${item.branch}`;
        requireService(context.services.prewarmWorktreeShellSession, "prewarmWorktreeShellSession")(
          `shell-wt-${item.id}`,
          worktreePath,
          item.port_env,
          repo.path,
        ).catch((error) => reportPrewarmSessionError("[store] shell pre-warm failed:", error));
      }
      for (const repo of eagerRepos) {
        requireService(context.services.spawnShellSession, "spawnShellSession")(`shell-repo-${repo.id}`, repo.path, null, false)
          .catch((error) => reportPrewarmSessionError("[store] repo shell pre-warm failed:", error));
      }
    }

    listen("status_changed", async (event: unknown) => {
      const payload = (event as { payload?: { session_id?: string; status?: string } }).payload ?? (event as { session_id?: string; status?: string });
      const sessionId = payload.session_id;
      const status = payload.status;
      if (!sessionId || typeof status !== "string") return;

      const item = context.state.items.value.find((candidate) => candidate.id === sessionId);
      if (!item) return;
      await requireService(context.services.applyTaskRuntimeStatus as ((item: PipelineItem, status: string) => Promise<void>) | undefined, "applyTaskRuntimeStatus")(item, status);
    });

    listen("session_exit", async (event: unknown) => {
      const payload = (event as { payload?: { session_id?: string; code?: number } }).payload ?? (event as { session_id?: string; code?: number });
      const sessionId = payload.session_id;
      if (!sessionId) return;

      requireService(context.services.resolveSessionExitWaiters, "resolveSessionExitWaiters")(sessionId);

      if (typeof sessionId === "string" && isTeardownSessionId(sessionId)) {
        const itemId = getTaskIdFromTeardownSessionId(sessionId);
        const exitCode = typeof payload.code === "number" ? payload.code : null;
        if (!itemId || !shouldAutoCloseTaskAfterTeardownExit({
          exitCode,
          lingerEnabled: context.state.devLingerTerminals.value,
        })) {
          return;
        }

        const item = context.state.items.value.find((candidate) => candidate.id === itemId);
        if (!item || !isTeardownStage(item.stage)) {
          return;
        }

        await Promise.all([
          invoke("kill_session", { sessionId: item.id }).catch((error: unknown) =>
            reportCloseSessionError("[store] kill agent session failed:", error)),
          invoke("kill_session", { sessionId: `shell-wt-${item.id}` }).catch((error: unknown) =>
            reportCloseSessionError("[store] kill shell session failed:", error)),
        ]);
        await ports.closeTaskAndReleasePorts(item.id, (id) => closePipelineItem(context.requireDb(), id));
        await tasks.checkUnblocked(item.id);
        context.bump();
        return;
      }

      if (shouldClearCachedTerminalStateOnSessionExit(sessionId)) {
        clearCachedTerminalState(sessionId);
      }
      tasks.handleAgentFinished(sessionId);
    });

    listen("terminal_output", (event: unknown) => {
      const payload = (event as { payload?: { session_id?: string } }).payload ?? (event as { session_id?: string });
      const sessionId = payload.session_id;
      if (typeof sessionId !== "string") return;
      requireService(context.services.scheduleRuntimeStatusSync, "scheduleRuntimeStatusSync")(sessionId);
    });

    listen("daemon_ready", async () => {
      await requireService(context.services.syncTaskStatusesFromDaemon, "syncTaskStatusesFromDaemon")();
    });

    listen("pipeline_stage_complete", async (event: unknown) => {
      const payload = (event as { payload?: { task_id?: string } }).payload ?? (event as { task_id?: string });
      const taskId = payload.task_id;
      if (!taskId) return;

      const item = context.state.items.value.find((candidate) => candidate.id === taskId);
      if (!item) return;

      context.bump();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const freshItem = context.state.items.value.find((candidate) => candidate.id === taskId);
      if (!freshItem) return;

      const repo = context.state.repos.value.find((candidate) => candidate.id === freshItem.repo_id);
      if (!repo) return;

      try {
        const pipeline = await requireService(context.services.loadPipeline, "loadPipeline")(repo.path, freshItem.pipeline);
        const stage = pipeline.stages.find((candidate) => candidate.name === freshItem.stage);
        if (!stage) return;

        if (stage.transition === "auto" && freshItem.stage_result) {
          try {
            const result = JSON.parse(freshItem.stage_result) as { status?: string };
            if (result.status === "success") {
              await requireService(context.services.advanceStage, "advanceStage")(taskId);
            }
          } catch (error) {
            console.error("[store] failed to parse stage_result:", error);
          }
        }

        if (context.state.selectedItemId.value !== taskId) {
          await updatePipelineItemActivity(context.requireDb(), taskId, "unread");
          context.bump();
        }
      } catch (error) {
        console.error("[store] pipeline_stage_complete handler failed:", error);
      }
    });
  }

  return {
    init,
    loadPreferences,
    savePreference,
  };
}
