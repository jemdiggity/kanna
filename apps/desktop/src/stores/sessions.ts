import type { AgentProvider } from "@kanna/db";
import { getRepo, updateClaudeSessionId, updatePipelineItemActivity } from "@kanna/db";
import { invoke } from "../invoke";
import { isTauri } from "../tauri-mock";
import { buildTaskShellCommand, getTaskTerminalEnv } from "../composables/terminalSessionRecovery";
import { resolveDbName } from "./db";
import { buildKannaCliEnv } from "./kannaCliEnv";
import { getAgentPermissionFlags } from "./agent-permissions";
import {
  requireResolvedAgentProvider,
  type AgentProviderAvailability,
} from "./agent-provider";
import { resolveActivityForRuntimeStatus, shouldIgnoreRuntimeStatusDuringSetup } from "./taskRuntimeStatus";
import { isTeardownSessionId } from "./kannaCleanup";
import { isReadableDirectory, resolveShellSpawnCwd } from "../utils/shellCwd";
import { readRepoConfig, type PreparedPtySession, type PtySpawnOptions, type StoreContext } from "./state";

interface DaemonSessionInfo {
  session_id?: string;
  status?: string;
}

export interface SessionsApi {
  applyTaskRuntimeStatus: (item: import("@kanna/db").PipelineItem, status: string) => Promise<void>;
  syncTaskStatusesFromDaemon: () => Promise<void>;
  scheduleRuntimeStatusSync: (sessionId: string) => void;
  isAgentProviderAvailable: (provider: AgentProvider) => Promise<boolean>;
  getAgentProviderAvailability: () => Promise<AgentProviderAvailability>;
  waitForSessionExit: (sessionId: string) => Promise<void>;
  resolveSessionExitWaiters: (sessionId: string) => void;
  spawnShellSession: (
    sessionId: string,
    cwd: string,
    portEnv?: string | null,
    isWorktree?: boolean,
    fallbackCwd?: string | null,
  ) => Promise<void>;
  prewarmWorktreeShellSession: (
    sessionId: string,
    worktreePath: string,
    portEnv?: string | null,
    fallbackCwd?: string | null,
  ) => Promise<void>;
  preparePtySession: (
    sessionId: string,
    prompt: string,
    options?: PtySpawnOptions,
  ) => Promise<PreparedPtySession>;
  spawnPtySession: (
    sessionId: string,
    cwd: string,
    prompt: string,
    cols?: number,
    rows?: number,
    options?: PtySpawnOptions,
  ) => Promise<void>;
}

export function createSessionsApi(context: StoreContext): SessionsApi {
  const sessionExitWaiters = new Map<string, Array<() => void>>();
  const runtimeStatusSyncDelayMs = 250;

  async function applyTaskRuntimeStatus(item: import("@kanna/db").PipelineItem, status: string) {
    if (shouldIgnoreRuntimeStatusDuringSetup(status, context.state.pendingSetupIds.value.includes(item.id))) {
      return;
    }

    if (status === "busy" || status === "idle" || status === "waiting") {
      const nextActivity = resolveActivityForRuntimeStatus(
        item.activity,
        status,
        context.state.selectedItemId.value === item.id,
      );
      if (nextActivity == null) return;

      await updatePipelineItemActivity(context.requireDb(), item.id, nextActivity);
      context.bump();
    }
  }

  async function syncTaskStatusesFromDaemon() {
    if (!isTauri) return;

    try {
      const sessions = await invoke<DaemonSessionInfo[]>("list_sessions");
      for (const session of sessions) {
        const sessionId = session.session_id;
        const status = session.status;
        if (!sessionId || !status) continue;
        const item = context.state.items.value.find((candidate) => candidate.id === sessionId);
        if (!item) continue;
        await applyTaskRuntimeStatus(item, status);
      }
    } catch (error) {
      console.error("[store] failed to sync task statuses from daemon:", error);
    }
  }

  function scheduleRuntimeStatusSync(sessionId: string) {
    if (!isTauri) return;
    if (sessionId.startsWith("shell-") || isTeardownSessionId(sessionId)) {
      return;
    }

    if (context.state.runtimeStatusSyncTimer.value != null) {
      clearTimeout(context.state.runtimeStatusSyncTimer.value);
    }

    context.state.runtimeStatusSyncTimer.value = setTimeout(() => {
      context.state.runtimeStatusSyncTimer.value = null;
      void syncTaskStatusesFromDaemon().catch((error) => {
        console.error("[store] failed scheduled runtime status sync:", error);
      });
    }, runtimeStatusSyncDelayMs);
  }

  async function isAgentProviderAvailable(provider: AgentProvider): Promise<boolean> {
    try {
      const path = await invoke<string | null>("which_binary", { name: provider });
      return Boolean(path);
    } catch (error) {
      console.debug(`[store] which_binary failed for ${provider}:`, error);
      return false;
    }
  }

  async function getAgentProviderAvailability(): Promise<AgentProviderAvailability> {
    const [claude, copilot, codex] = await Promise.all([
      isAgentProviderAvailable("claude"),
      isAgentProviderAvailable("copilot"),
      isAgentProviderAvailable("codex"),
    ]);

    return { claude, copilot, codex };
  }

  async function waitForSessionExit(sessionId: string): Promise<void> {
    return new Promise((resolve) => {
      const existing = sessionExitWaiters.get(sessionId) ?? [];
      existing.push(resolve);
      sessionExitWaiters.set(sessionId, existing);
    });
  }

  function resolveSessionExitWaiters(sessionId: string): void {
    const waiters = sessionExitWaiters.get(sessionId);
    if (!waiters) return;
    sessionExitWaiters.delete(sessionId);
    for (const resolve of waiters) resolve();
  }

  async function spawnShellSession(
    sessionId: string,
    cwd: string,
    portEnv?: string | null,
    isWorktree = true,
    fallbackCwd?: string | null,
  ): Promise<void> {
    const env: Record<string, string> = { TERM: "xterm-256color" };
    if (isWorktree) env.KANNA_WORKTREE = "1";
    if (portEnv) {
      try {
        Object.assign(env, JSON.parse(portEnv));
      } catch (error) {
        console.error("[store] failed to parse portEnv:", error);
      }
    }
    try {
      env.ZDOTDIR = await invoke<string>("ensure_term_init");
    } catch (error) {
      console.error("[store] failed to set up term init:", error);
    }
    const resolvedCwd = await resolveShellSpawnCwd(cwd, fallbackCwd);
    if (resolvedCwd.fellBack) {
      console.warn("[store] shell cwd unreadable, falling back:", {
        sessionId,
        from: cwd,
        to: resolvedCwd.cwd,
      });
    }
    await invoke("spawn_session", {
      sessionId,
      cwd: resolvedCwd.cwd,
      executable: "/bin/zsh",
      args: ["--login"],
      env,
      cols: 80,
      rows: 24,
    });
  }

  async function prewarmWorktreeShellSession(
    sessionId: string,
    worktreePath: string,
    portEnv?: string | null,
    fallbackCwd?: string | null,
  ): Promise<void> {
    if (!await isReadableDirectory(worktreePath)) {
      console.warn("[store] skipping shell pre-warm for unreadable worktree:", worktreePath);
      return;
    }
    await spawnShellSession(sessionId, worktreePath, portEnv, true, fallbackCwd);
  }

  async function preparePtySession(
    sessionId: string,
    prompt: string,
    options?: PtySpawnOptions,
  ): Promise<PreparedPtySession> {
    const provider = requireResolvedAgentProvider(options?.agentProvider);
    const env: Record<string, string> = { ...getTaskTerminalEnv(provider) };
    let kannaCliPath: string | undefined;
    let setupCmds: string[] = options?.setupCmds || [];

    if (options?.portEnv) {
      Object.assign(env, options.portEnv);
    } else {
      const item = context.state.items.value.find((candidate) => candidate.id === sessionId);
      if (item) {
        if (item.port_env) {
          try {
            Object.assign(env, JSON.parse(item.port_env));
          } catch (error) {
            console.error("[store] failed to parse port_env:", error);
          }
        }
        if (setupCmds.length === 0) {
          try {
            const repo = await getRepo(context.requireDb(), item.repo_id);
            if (repo && item.branch) {
              const worktreePath = `${repo.path}/.kanna-worktrees/${item.branch}`;
              const repoConfig = await readRepoConfig(worktreePath);
              if (repoConfig.setup?.length) setupCmds = repoConfig.setup;
            }
          } catch (error) {
            console.error("[store] failed to read setup config:", error);
          }
        }
      }
    }

    env.KANNA_WORKTREE = "1";

    try {
      kannaCliPath = await invoke<string>("which_binary", { name: "kanna-cli" });
      env.KANNA_CLI_PATH = kannaCliPath;
    } catch (error) {
      console.error("[store] failed to resolve kanna-cli path:", error);
    }

    try {
      const [appDataDir, dbName, socketPath] = await Promise.all([
        invoke<string>("get_app_data_dir"),
        resolveDbName(),
        invoke<string>("get_pipeline_socket_path"),
      ]);
      Object.assign(env, buildKannaCliEnv({
        taskId: sessionId,
        dbName,
        appDataDir,
        socketPath,
      }));
    } catch (error) {
      console.error("[store] failed to resolve kanna-cli env:", error);
    }

    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    let agentCmd: string;
    const permissionFlags = getAgentPermissionFlags(provider, options?.permissionMode);

    if (provider === "copilot") {
      const copilotFlags: string[] = [...permissionFlags];
      if (options?.model) copilotFlags.push(`--model=${options.model}`);
      if (options?.allowedTools?.length) {
        for (const tool of options.allowedTools) copilotFlags.push(`--allow-tool=${tool}`);
      }
      if (options?.disallowedTools?.length) {
        for (const tool of options.disallowedTools) copilotFlags.push(`--deny-tool=${tool}`);
      }

      const copilotSessionId = options?.resumeSessionId || crypto.randomUUID();
      if (!options?.resumeSessionId) {
        await updateClaudeSessionId(context.requireDb(), sessionId, copilotSessionId);
      }
      copilotFlags.push(`--resume=${copilotSessionId}`);

      agentCmd = options?.resumeSessionId
        ? `copilot ${copilotFlags.join(" ")}`
        : `copilot ${copilotFlags.join(" ")} -i '${escapedPrompt}'`;
    } else if (provider === "codex") {
      const codexFlags: string[] = [...permissionFlags];
      if (options?.model) codexFlags.push(`-m ${options.model}`);

      agentCmd = escapedPrompt
        ? `codex ${codexFlags.join(" ")} '${escapedPrompt}'`
        : `codex ${codexFlags.join(" ")}`;
    } else {
      const flags: string[] = [...permissionFlags];
      if (options?.model) flags.push(`--model ${options.model}`);
      if (options?.maxTurns != null) flags.push(`--max-turns ${options.maxTurns}`);
      if (options?.maxBudgetUsd != null) flags.push(`--max-budget-usd ${options.maxBudgetUsd}`);
      if (options?.allowedTools?.length) {
        flags.push(`--allowedTools ${options.allowedTools.join(",")}`);
      }
      if (options?.disallowedTools?.length) {
        flags.push(`--disallowedTools ${options.disallowedTools.join(",")}`);
      }

      const claudeSessionId = options?.resumeSessionId || crypto.randomUUID();
      if (!options?.resumeSessionId) {
        await updateClaudeSessionId(context.requireDb(), sessionId, claudeSessionId);
      }

      if (options?.resumeSessionId) {
        flags.push(`--resume ${claudeSessionId}`);
      } else {
        flags.push(`--session-id ${claudeSessionId}`);
      }

      if (options?.resumeSessionId || !escapedPrompt) {
        agentCmd = `claude ${flags.join(" ")}`;
      } else {
        agentCmd = `claude ${flags.join(" ")} '${escapedPrompt}'`;
      }
    }

    return {
      env,
      setupCmds: [...setupCmds, ...(options?.setupCmdsOverride || [])],
      agentCmd,
      kannaCliPath,
    };
  }

  async function spawnPtySession(
    sessionId: string,
    cwd: string,
    prompt: string,
    cols = 80,
    rows = 24,
    options?: PtySpawnOptions,
  ) {
    const { env, setupCmds, agentCmd, kannaCliPath } = await preparePtySession(sessionId, prompt, options);
    const fullCmd = buildTaskShellCommand(agentCmd, setupCmds, { kannaCliPath });

    await invoke("spawn_session", {
      sessionId,
      cwd,
      executable: "/bin/zsh",
      args: ["--login", "-i", "-c", fullCmd],
      env,
      cols,
      rows,
      agentProvider: options?.agentProvider ?? null,
    });
    await syncTaskStatusesFromDaemon();
  }

  return {
    applyTaskRuntimeStatus,
    syncTaskStatusesFromDaemon,
    scheduleRuntimeStatusSync,
    isAgentProviderAvailable,
    getAgentProviderAvailability,
    waitForSessionExit,
    resolveSessionExitWaiters,
    spawnShellSession,
    prewarmWorktreeShellSession,
    preparePtySession,
    spawnPtySession,
  };
}
