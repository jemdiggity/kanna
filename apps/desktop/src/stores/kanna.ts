import { ref, computed, watch, nextTick } from "vue";
import { defineStore } from "pinia";
import { computedAsync, watchDebounced } from "@vueuse/core";
import { invoke } from "../invoke";
import { useToast } from '../composables/useToast';
import { isTauri } from "../tauri-mock";
import { listen } from "../listen";
import { parseRepoConfig, parseAgentMd, DEFAULT_STAGE_ORDER } from "@kanna/core";
import { parseAgentDefinition } from "../../../../packages/core/src/pipeline/agent-loader";
import { parsePipelineJson } from "../../../../packages/core/src/pipeline/pipeline-loader";
import { buildStagePrompt } from "../../../../packages/core/src/pipeline/prompt-builder";
import { getNextStage } from "../../../../packages/core/src/pipeline/types";
import type { PipelineDefinition, AgentDefinition, StageCompleteResult } from "../../../../packages/core/src/pipeline/pipeline-types";
import { createNavigationHistory } from "../composables/useNavigationHistory";
import { buildTaskShellCommand, getTaskTerminalEnv } from "../composables/terminalSessionRecovery";
import { loadSessionRecoveryState, type SessionRecoveryState } from "../composables/sessionRecoveryState";
import { clearCachedTerminalState } from "../composables/terminalStateCache";
import {
  closePipelineItemAndClearCachedTerminalState,
  getTaskIdFromTeardownSessionId,
  isTeardownSessionId,
  reportCloseSessionError,
  reportPrewarmSessionError,
  shouldAutoCloseTaskAfterTeardownExit,
  shouldClearCachedTerminalStateOnSessionExit,
} from "./kannaCleanup";
import { isTeardownStage, TEARDOWN_STAGE } from "./taskStages";
import { formatAppWindowTitle, type AppBuildInfo } from "./windowTitle";
import type { RepoConfig, CustomTaskConfig } from "@kanna/core";
import type { AgentProvider, DbHandle, PipelineItem, Repo } from "@kanna/db";
import { buildTaskBootstrapCommand } from "../utils/taskBootstrap";
import { isReadableDirectory, resolveShellSpawnCwd } from "../utils/shellCwd";
import {
  buildOutgoingTransferPayload,
  parseFinalizedOutgoingTransferResult,
  parseOutgoingTransferPreflightResult,
  parsePersistedOutgoingTransferPayload,
  resolveIncomingTransferBaseBranch,
  type FinalizedOutgoingTransferResult,
  type IncomingTransferRequest,
  type OutgoingTransferCommittedEvent,
  type TransferArtifactPayload,
  type OutgoingTransferPayload,
} from "../utils/taskTransfer";
import {
  getPreferredAgentProviders,
  requireResolvedAgentProvider,
  resolveAgentProvider,
  type AgentProviderAvailability,
} from "./agent-provider";
import { buildPendingTaskPlaceholder } from "./taskCreationPlaceholder";
import {
  resolveActivityForRuntimeStatus,
  shouldIgnoreRuntimeStatusDuringSetup,
} from "./taskRuntimeStatus";
import {
  formatTaskPortAllocationLog,
  type PortAllocationLogEntry,
} from "./portAllocationLog";
import { getTaskCloseBehavior } from "./taskCloseBehavior";
import { shouldSelectNextOnCloseTransition } from "./taskCloseSelection";
import { shouldPrewarmTaskShellOnCreate } from "./taskShellPrewarm";
import {
  getAgentPermissionFlags,
} from "./agent-permissions";
import {
  getCreateWorktreeStartPoint,
  resolveInitialBaseRef,
} from "./taskBaseBranch";
import i18n from '../i18n';
import { resolveDbName } from "./db";
import { buildKannaCliEnv } from "./kannaCliEnv";
import {
  listRepos, insertRepo, findRepoByPath,
  hideRepo as hideRepoQuery, unhideRepo as unhideRepoQuery,
  listPipelineItems, insertPipelineItem,
  updatePipelineItemActivity, updatePipelineItemStage,
  pinPipelineItem, unpinPipelineItem,
  reorderPinnedItems, updatePipelineItemDisplayName,
  clearPipelineItemStageResult,
  closePipelineItem, reopenPipelineItem,
  getRepo, getSetting, setSetting,
  insertTaskBlocker, removeTaskBlocker, removeAllBlockersForItem,
  listBlockersForItem, listBlockedByItem, getUnblockedItems,
  hasCircularDependency, insertOperatorEvent, updateAgentSessionId,
  insertTaskTransfer, listTaskPorts, listTaskPortsForItem, deleteTaskPortsForItem,
  getTaskTransfer, markTaskTransferCompleted, markTaskTransferRejected,
  insertTaskTransferProvenance,
} from "@kanna/db";

/** Generate an 8-char hex ID (32 bits of randomness). */
function generateId(): string {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Internal tag helpers (not exported — tags column is legacy) ──────────
function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; }
  catch { return []; }
}

function hasTag(item: { tags: string }, tag: string): boolean {
  return parseTags(item.tags).includes(tag);
}

function isDuplicateTaskTransferError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed: task_transfer.id");
}



export interface PtySpawnOptions {
  agentProvider?: AgentProvider;
  model?: string;
  permissionMode?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  maxTurns?: number;
  maxBudgetUsd?: number;
  setupCmdsOverride?: string[];
  portEnv?: Record<string, string>;
  setupCmds?: string[];
  resumeSessionId?: string;
}

interface CreateItemOptions {
  baseBranch?: string;
  tags?: string[];
  pipelineName?: string;
  stage?: string;
  customTask?: CustomTaskConfig;
  agentProvider?: AgentProvider;
  model?: string;
  permissionMode?: string;
  allowedTools?: string[];
  displayName?: string | null;
  resumeSessionId?: string | null;
  recoverySnapshot?: SessionRecoveryState | null;
}

interface PreparedPtySession {
  env: Record<string, string>;
  setupCmds: string[];
  agentCmd: string;
  kannaCliPath?: string;
}

interface WorktreeBootstrapResult {
  visibleBootstrapSteps: string[];
}
// Module-level DB handle — set once by init(), never null after that.
let _db: DbHandle;
let portAllocationChain: Promise<void> = Promise.resolve();
const sessionExitWaiters = new Map<string, Array<() => void>>();
const RUNTIME_STATUS_SYNC_DELAY_MS = 250;
const TRANSFER_SOURCE_FINALIZATION_WAIT_MS = 1500;

async function withPortAllocationLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = portAllocationChain.then(fn, fn);
  portAllocationChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

interface AllocatedPorts {
  portEnv: Record<string, string>;
  firstPort: number | null;
}

function toPortAssignmentMap(taskPorts: Array<{ env_name: string; port: number }>): Map<string, number> {
  const map = new Map<string, number>();
  for (const taskPort of taskPorts) {
    map.set(taskPort.env_name, taskPort.port);
  }
  return map;
}

async function tryClaimPort(
  itemId: string,
  envName: string,
  candidate: number,
  occupiedPorts: Set<number>,
): Promise<boolean> {
  if (!Number.isInteger(candidate) || candidate <= 0) return false;
  if (occupiedPorts.has(candidate)) return false;

  await _db.execute(
    "INSERT OR IGNORE INTO task_port (port, pipeline_item_id, env_name) VALUES (?, ?, ?)",
    [candidate, itemId, envName],
  );
  const owner = await _db.select<{ pipeline_item_id: string }>(
    "SELECT pipeline_item_id FROM task_port WHERE port = ?",
    [candidate],
  );
  if (owner[0]?.pipeline_item_id !== itemId) return false;

  occupiedPorts.add(candidate);
  return true;
}

async function claimClosestPort(
  itemId: string,
  envName: string,
  preferredPort: number,
  occupiedPorts: Set<number>,
): Promise<number> {
  const existing = await listTaskPortsForItem(_db, itemId);
  const existingPort = existing.find((taskPort) => taskPort.env_name === envName)?.port;
  if (existingPort != null) {
    occupiedPorts.add(existingPort);
    return existingPort;
  }

  for (let candidate = preferredPort + 1; candidate <= 65535; candidate++) {
    if (await tryClaimPort(itemId, envName, candidate, occupiedPorts)) {
      return candidate;
    }
  }

  throw new Error(`No free port available near ${preferredPort} for ${envName}`);
}

async function claimTaskPorts(
  itemId: string,
  repoConfig: RepoConfig,
): Promise<AllocatedPorts> {
  const portEnv: Record<string, string> = {};
  let firstPort: number | null = null;
  const claimedPorts: number[] = [];
  const logEntries: PortAllocationLogEntry[] = [];

  try {
    const activeTaskPorts = await listTaskPorts(_db);
    const occupiedPorts = new Set<number>(activeTaskPorts.map((taskPort) => taskPort.port));

    if (!repoConfig.ports) return { portEnv, firstPort };

    const existingTaskPorts = await listTaskPortsForItem(_db, itemId);
    const existingAssignments = toPortAssignmentMap(existingTaskPorts);

    for (const [envName, preferredPort] of Object.entries(repoConfig.ports)) {
      const existingPort = existingAssignments.get(envName);
      if (existingPort != null) {
        occupiedPorts.add(existingPort);
        portEnv[envName] = String(existingPort);
        if (firstPort === null) firstPort = existingPort;
        logEntries.push({
          envName,
          requestedPort: preferredPort,
          assignedPort: existingPort,
          reusedExisting: true,
        });
        continue;
      }

      const assignedPort = await claimClosestPort(itemId, envName, preferredPort, occupiedPorts);
      claimedPorts.push(assignedPort);
      portEnv[envName] = String(assignedPort);
      if (firstPort === null) firstPort = assignedPort;
      logEntries.push({
        envName,
        requestedPort: preferredPort,
        assignedPort,
        reusedExisting: false,
      });
    }

    if (logEntries.length > 0) {
      console.log(formatTaskPortAllocationLog(itemId, logEntries));
    }

    return { portEnv, firstPort };
  } catch (e) {
    if (claimedPorts.length > 0) {
      await deleteTaskPortsForItem(_db, itemId).catch((cleanupErr) =>
        console.error("[store] failed to clean up partial port claims:", cleanupErr)
      );
    }
    throw e;
  }
}

async function releaseTaskPorts(itemId: string): Promise<void> {
  await deleteTaskPortsForItem(_db, itemId);
}

async function closeTaskAndReleasePorts(
  itemId: string,
  closeFn: (id: string) => Promise<void>,
): Promise<void> {
  await closePipelineItemAndClearCachedTerminalState(itemId, closeFn);
  await releaseTaskPorts(itemId);
}

const INSTANCE_SCOPED_WORKTREE_ENV_KEYS = [
  "KANNA_TMUX_SESSION",
  "KANNA_DB_NAME",
  "KANNA_DB_PATH",
  "KANNA_DAEMON_DIR",
  "KANNA_TRANSFER_ROOT",
  "KANNA_WEBDRIVER_PORT",
  "KANNA_E2E_TARGET_WEBDRIVER_PORT",
  "KANNA_TRANSFER_PORT",
  "KANNA_TRANSFER_DISPLAY_NAME",
  "KANNA_TRANSFER_PEER_ID",
  "KANNA_TRANSFER_REGISTRY_DIR",
] as const;

function applyWorktreeProcessIsolation(env: Record<string, string>): Record<string, string> {
  for (const key of INSTANCE_SCOPED_WORKTREE_ENV_KEYS) {
    env[key] = "";
  }
  return env;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function sanitizeTransferRepoName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "repo";
  const sanitized = trimmed.replace(/[\\/]/g, "-");
  return sanitized.length > 0 ? sanitized : "repo";
}

function buildTransferBundlePath(transferId: string): string {
  return `/tmp/kanna-transfer-${transferId}.bundle`;
}

function buildTransferBundleArtifactId(transferId: string): string {
  return `${transferId}-repo-bundle`;
}

function buildCodexRolloutArtifactId(transferId: string): string {
  return `${transferId}-codex-rollout`;
}

function buildClaudeSessionArtifactId(transferId: string): string {
  return `${transferId}-claude-session`;
}

function buildCopilotSessionArtifactId(transferId: string): string {
  return `${transferId}-copilot-session`;
}

function buildTransferArchivePath(transferId: string, suffix: string): string {
  return `/tmp/kanna-transfer-${transferId}-${suffix}.tar.gz`;
}

function normalizeTransferRefName(ref: string | null | undefined): string | null {
  if (!ref) return null;
  if (ref.startsWith("refs/")) return ref;
  return `refs/heads/${ref}`;
}

function buildTransferBundleRefs(item: PipelineItem): string[] {
  const taskRef = normalizeTransferRefName(item.branch);
  if (taskRef) {
    return [taskRef];
  }

  const baseRef = normalizeTransferRefName(item.base_ref);
  return baseRef ? [baseRef] : [];
}

function parentDirectory(path: string): string {
  const index = path.lastIndexOf("/");
  if (index <= 0) return "/";
  return path.slice(0, index);
}

function baseName(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(index + 1) : path;
}

function joinHomeRelativePath(home: string, relativePath: string): string {
  return `${home.replace(/\/+$/, "")}/${relativePath.replace(/^\/+/, "")}`;
}

async function listDirectoryNames(path: string): Promise<string[]> {
  return invoke<string[]>("list_dir", { path }).catch(() => []);
}

function resolveTransferArtifactMaterialization(
  artifact: Pick<TransferArtifactPayload, "kind" | "materialization">,
): TransferArtifactPayload["materialization"] {
  if (artifact.materialization === "copy-file" || artifact.materialization === "extract-tar-gz") {
    return artifact.materialization;
  }
  return artifact.kind === "session-archive" ? "extract-tar-gz" : "copy-file";
}

interface LocatedTransferArtifact {
  absolutePath: string;
  homeRelPath: string;
  filename: string;
}

async function findCodexRolloutArtifact(sessionId: string): Promise<LocatedTransferArtifact | null> {
  try {
    const home = await invoke<string>("read_env_var", { name: "HOME" });
    const sessionsRoot = `${home}/.codex/sessions`;
    const rootExists = await invoke<boolean>("file_exists", { path: sessionsRoot }).catch(() => false);
    if (!rootExists) {
      return null;
    }

    const years = await listDirectoryNames(sessionsRoot);
    for (const year of years) {
      const yearPath = `${sessionsRoot}/${year}`;
      const months = await listDirectoryNames(yearPath);
      for (const month of months) {
        const monthPath = `${yearPath}/${month}`;
        const days = await listDirectoryNames(monthPath);
        for (const day of days) {
          const dayPath = `${monthPath}/${day}`;
          const entries = await listDirectoryNames(dayPath);
          const fileName = entries.find((entry) => entry.endsWith(`${sessionId}.jsonl`));
          if (!fileName) {
            continue;
          }
          const homeRelPath = `.codex/sessions/${year}/${month}/${day}/${fileName}`;
          return {
            absolutePath: `${dayPath}/${fileName}`,
            homeRelPath,
            filename: fileName,
          };
        }
      }
    }
  } catch (error) {
    console.error("[store] failed to locate codex rollout artifact:", error);
  }

  return null;
}

async function stageTransferredSessionArtifacts(
  transferId: string,
  item: PipelineItem,
  repoPath: string,
): Promise<TransferArtifactPayload[]> {
  if (!item.agent_session_id || !item.agent_provider) {
    return [];
  }

  try {
    if (item.agent_provider === "codex") {
      const rollout = await findCodexRolloutArtifact(item.agent_session_id);
      if (!rollout) {
        return [];
      }
      const artifactId = buildCodexRolloutArtifactId(transferId);
      await invoke("stage_transfer_artifact", {
        transferId,
        artifactId,
        path: rollout.absolutePath,
      });
      return [{
        artifact_id: artifactId,
        filename: rollout.filename,
        provider: "codex",
        kind: "session-rollout",
        materialization: "copy-file",
        home_rel_path: rollout.homeRelPath,
      }];
    }

    const home = await invoke<string>("read_env_var", { name: "HOME" });
    if (item.agent_provider === "claude") {
      const sourceDir = `${home}/.claude/tasks/${item.agent_session_id}`;
      const exists = await invoke<boolean>("file_exists", { path: sourceDir }).catch(() => false);
      if (!exists) {
        return [];
      }
      const archivePath = buildTransferArchivePath(transferId, "claude-session");
      await invoke("run_script", {
        script: `tar -C ${shellQuote(`${home}/.claude/tasks`)} -czf ${shellQuote(archivePath)} ${shellQuote(item.agent_session_id)}`,
        cwd: repoPath,
        env: applyWorktreeProcessIsolation({ KANNA_WORKTREE: "1" }),
      });
      const artifactId = buildClaudeSessionArtifactId(transferId);
      await invoke("stage_transfer_artifact", {
        transferId,
        artifactId,
        path: archivePath,
      });
      return [{
        artifact_id: artifactId,
        filename: "claude-session.tar.gz",
        provider: "claude",
        kind: "session-archive",
        materialization: "extract-tar-gz",
        home_rel_path: `.claude/tasks/${item.agent_session_id}`,
      }];
    }

    if (item.agent_provider === "copilot") {
      const sourceDir = `${home}/.copilot/session-state/${item.agent_session_id}`;
      const exists = await invoke<boolean>("file_exists", { path: sourceDir }).catch(() => false);
      if (!exists) {
        return [];
      }
      const archivePath = buildTransferArchivePath(transferId, "copilot-session");
      await invoke("run_script", {
        script: `tar -C ${shellQuote(`${home}/.copilot/session-state`)} -czf ${shellQuote(archivePath)} ${shellQuote(item.agent_session_id)}`,
        cwd: repoPath,
        env: applyWorktreeProcessIsolation({ KANNA_WORKTREE: "1" }),
      });
      const artifactId = buildCopilotSessionArtifactId(transferId);
      await invoke("stage_transfer_artifact", {
        transferId,
        artifactId,
        path: archivePath,
      });
      return [{
        artifact_id: artifactId,
        filename: "copilot-session.tar.gz",
        provider: "copilot",
        kind: "session-archive",
        materialization: "extract-tar-gz",
        home_rel_path: `.copilot/session-state/${item.agent_session_id}`,
      }];
    }
  } catch (error) {
    console.error("[store] failed to stage provider session artifacts:", error);
  }

  return [];
}

async function importTransferredResumeState(
  transferId: string,
  payload: OutgoingTransferPayload,
  repoPath: string,
): Promise<string | null> {
  const resumeSessionId = payload.task.resume_session_id ?? null;
  const provider = payload.task.agent_provider;
  if (!provider || !resumeSessionId) {
    return resumeSessionId;
  }

  const artifact = payload.artifacts?.find((candidate) => candidate.provider === provider) ?? null;
  if (!artifact) {
    return null;
  }

  try {
    const home = await invoke<string>("read_env_var", { name: "HOME" });
    const destinationPath = joinHomeRelativePath(home, artifact.home_rel_path);
    const destinationParent = parentDirectory(destinationPath);
    const materialization = resolveTransferArtifactMaterialization(artifact);
    const destinationExists = await invoke<boolean>("file_exists", { path: destinationPath }).catch(() => false);
    if (destinationExists) {
      console.warn("[store] skipping transferred session import because destination already exists:", destinationPath);
      return null;
    }
    const fetched = await invoke<{ path: string }>("fetch_transfer_artifact", {
      transferId,
      artifactId: artifact.artifact_id,
    });
    await invoke("ensure_directory", { path: destinationParent });
    if (materialization === "copy-file") {
      await invoke("copy_file", {
        src: fetched.path,
        dst: destinationPath,
      });
      return resumeSessionId;
    }
    if (materialization === "extract-tar-gz") {
      const extractedName = baseName(destinationPath);
      const tempPattern = `${destinationParent}/.kanna-transfer-${transferId}-${extractedName}-XXXXXX`;
      await invoke("run_script", {
        script: [
          `tmp_dir="$(mktemp -d ${shellQuote(tempPattern)})"`,
          'cleanup() { rm -rf "$tmp_dir"; }',
          'trap cleanup EXIT',
          `tar -xzf ${shellQuote(fetched.path)} -C "$tmp_dir"`,
          `test -e "$tmp_dir/${extractedName}"`,
          `mv "$tmp_dir/${extractedName}" ${shellQuote(destinationPath)}`,
        ].join("\n"),
        cwd: repoPath,
        env: applyWorktreeProcessIsolation({ KANNA_WORKTREE: "1" }),
      });
      return resumeSessionId;
    }
    return resumeSessionId;
  } catch (error) {
    console.error("[store] failed to import transferred session artifact:", error);
    return null;
  }
}

async function waitForSessionExit(sessionId: string): Promise<void> {
  return new Promise((resolve) => {
    const existing = sessionExitWaiters.get(sessionId) ?? [];
    existing.push(resolve);
    sessionExitWaiters.set(sessionId, existing);
  });
}

function removeSessionExitWaiter(sessionId: string, waiter: () => void): void {
  const existing = sessionExitWaiters.get(sessionId);
  if (!existing) return;
  const remaining = existing.filter((candidate) => candidate !== waiter);
  if (remaining.length === 0) {
    sessionExitWaiters.delete(sessionId);
    return;
  }
  sessionExitWaiters.set(sessionId, remaining);
}

async function waitForSessionExitWithin(sessionId: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const waiter = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      removeSessionExitWaiter(sessionId, waiter);
      resolve(false);
    }, timeoutMs);
    const existing = sessionExitWaiters.get(sessionId) ?? [];
    existing.push(waiter);
    sessionExitWaiters.set(sessionId, existing);
  });
}

async function persistExitedSessionResumeId(
  sessionId: string,
  resumeSessionId?: string | null,
): Promise<void> {
  if (!resumeSessionId) return;
  const rows = await _db.select<Pick<PipelineItem, "agent_provider">>(
    "SELECT agent_provider FROM pipeline_item WHERE id = ? LIMIT 1",
    [sessionId],
  );
  if (rows[0]?.agent_provider !== "codex") return;
  await updateAgentSessionId(_db, sessionId, resumeSessionId);
}

function tt(key: string): string { return i18n.global.t(key); }

export async function readRepoConfig(basePath: string): Promise<RepoConfig> {
  try {
    const content = await invoke<string>("read_text_file", {
      path: `${basePath}/.kanna/config.json`,
    });
    return content ? parseRepoConfig(content) : {};
  } catch (e) {
    console.debug("[store] no .kanna/config.json:", e);
    return {};
  }
}

export async function collectTeardownCommands(item: PipelineItem, repo: Repo): Promise<string[]> {
  const cmds: string[] = [];
  if (item.display_name) {
    try {
      const tasksDir = `${repo.path}/.kanna/tasks`;
      const entries = await invoke<string[]>("list_dir", { path: tasksDir }).catch(() => [] as string[]);
      for (const entry of entries) {
        const agentMdPath = `${tasksDir}/${entry}/agent.md`;
        let content: string;
        try {
          content = await invoke<string>("read_text_file", { path: agentMdPath });
        } catch {
          continue;
        }
        const config = parseAgentMd(content, entry);
        if (config && config.name === item.display_name && config.teardown?.length) {
          cmds.push(...config.teardown);
          break;
        }
      }
    } catch (e) { console.error("[store] custom task teardown lookup failed:", e); }
  }

  const worktreePath = `${repo.path}/.kanna-worktrees/${item.branch}`;
  const repoConfig = await readRepoConfig(worktreePath);
  if (repoConfig.teardown?.length) {
    cmds.push(...repoConfig.teardown);
  }
  return cmds;
}
export const useKannaStore = defineStore("kanna", () => {
  const toast = useToast();

  // ── Refresh trigger ──────────────────────────────────────────────
  const refreshKey = ref(0);
  function bump() { refreshKey.value++; }

  const pendingCreateVisibility = new Map<string, { bumpAt: number }>();
  let runtimeStatusSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshRunId = 0;

  interface DaemonSessionInfo {
    session_id?: string;
    status?: string;
  }

  function emitTaskSelected(itemId: string) {
    const item = items.value.find((i) => i.id === itemId);
    insertOperatorEvent(_db, "task_selected", itemId, item?.repo_id ?? null).catch((e) =>
      console.error("[store] operator event failed:", e)
    );
  }

  // ── Reactive DB reads ────────────────────────────────────────────
  const repos = computedAsync<Repo[]>(async () => {
    refreshKey.value; // subscribe to trigger
    if (!_db) return [];
    return await listRepos(_db);
  }, []);

  const items = computedAsync<PipelineItem[]>(async () => {
    refreshKey.value;
    if (!_db || repos.value.length === 0) return [];
    const runId = ++refreshRunId;
    const refreshStart = performance.now();
    console.log(`[perf:items] refresh start #${runId}: repos=${repos.value.length}`);
    const loaded: PipelineItem[] = [];
    for (const repo of repos.value) {
      const repoStart = performance.now();
      loaded.push(...await listPipelineItems(_db, repo.id));
      console.log(`[perf:items] refresh repo #${runId} ${repo.id}: ${(performance.now() - repoStart).toFixed(1)}ms`);
      // Populate stage_order cache from repo config
      if (!stageOrderCache.has(repo.path)) {
        try {
          const config = await readRepoConfig(repo.path);
          if (config.stage_order) {
            stageOrderCache.set(repo.path, config.stage_order);
          }
        } catch { /* no config — no custom order */ }
      }
    }
    console.log(
      `[perf:items] refresh done #${runId}: ${(performance.now() - refreshStart).toFixed(1)}ms total, items=${loaded.length}`
    );
    for (const item of loaded) {
      const pending = pendingCreateVisibility.get(item.id);
      if (!pending) continue;
      console.log(`[perf:createItem] items refresh -> visible: ${(performance.now() - pending.bumpAt).toFixed(1)}ms (id=${item.id})`);
      pendingCreateVisibility.delete(item.id);
    }
    return loaded;
  }, []);

  watch(items, async (loaded) => {
    if (!loaded.length) return;
    const visibleIds = loaded
      .map((item) => item.id)
      .filter((id) => pendingCreateVisibility.has(id));
    if (!visibleIds.length) return;
    await nextTick();
    for (const id of visibleIds) {
      const pending = pendingCreateVisibility.get(id);
      if (!pending) continue;
      console.log(`[perf:createItem] nextTick after visible: ${(performance.now() - pending.bumpAt).toFixed(1)}ms (id=${id})`);
    }
  });

  async function applyTaskRuntimeStatus(item: PipelineItem, status: string) {
    if (shouldIgnoreRuntimeStatusDuringSetup(status, pendingSetupIds.value.includes(item.id))) {
      return;
    }

    if (status === "busy" || status === "idle" || status === "waiting") {
      const nextActivity = resolveActivityForRuntimeStatus(
        item.activity,
        status,
        selectedItemId.value === item.id,
      );
      if (nextActivity == null) {
        return;
      }
      await updatePipelineItemActivity(_db, item.id, nextActivity);
      bump();
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
        const item = items.value.find((candidate) => candidate.id === sessionId);
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

    if (runtimeStatusSyncTimer != null) {
      clearTimeout(runtimeStatusSyncTimer);
    }
    runtimeStatusSyncTimer = setTimeout(() => {
      runtimeStatusSyncTimer = null;
      syncTaskStatusesFromDaemon().catch((error) => {
        console.error("[store] failed scheduled runtime status sync:", error);
      });
    }, RUNTIME_STATUS_SYNC_DELAY_MS);
  }

  // ── Selection & navigation history ──────────────────────────────
  const selectedRepoId = ref<string | null>(null);
  const selectedItemId = ref<string | null>(null);
  const lastSelectedItemByRepo = ref<Record<string, string>>({});
  const nav = createNavigationHistory();
  const canGoBack = nav.canGoBack;
  const canGoForward = nav.canGoForward;

  // ── Preferences ──────────────────────────────────────────────────
  const suspendAfterMinutes = ref(30);
  const killAfterMinutes = ref(60);
  const ideCommand = ref("code");
  const hideShortcutsOnStartup = ref(false);
  const devLingerTerminals = ref(false);

  // ── Undo state ───────────────────────────────────────────────────
  const lastHiddenRepoId = ref<string | null>(null);

  // Items whose worktree + agent spawn is still in progress.
  // Excluded from the currentItem auto-select fallback to prevent
  // the terminal from mounting (and racing to spawn) before the
  // session actually exists in the daemon.
  const pendingSetupIds = ref<string[]>([]);

  // ── Pipeline cache ────────────────────────────────────────────────
  const pipelineCache = new Map<string, PipelineDefinition>();
  const agentCache = new Map<string, AgentDefinition>();
  const stageOrderCache = new Map<string, string[]>(); // repo path -> stage_order from config

  function getStageOrder(repoId: string): readonly string[] {
    const repoPath = repos.value.find(r => r.id === repoId)?.path ?? "";
    return stageOrderCache.get(repoPath) ?? DEFAULT_STAGE_ORDER;
  }

  async function loadPipeline(repoPath: string, pipelineName: string): Promise<PipelineDefinition> {
    const cacheKey = `${repoPath}::${pipelineName}`;
    const cached = pipelineCache.get(cacheKey);
    if (cached) return cached;

    // Try repo file first, fall back to bundled resource
    let pipeline: PipelineDefinition;
    try {
      const path = `${repoPath}/.kanna/pipelines/${pipelineName}.json`;
      const content = await invoke<string>("read_text_file", { path });
      pipeline = parsePipelineJson(content);
    } catch {
      try {
        const content = await invoke<string>("read_builtin_resource", {
          relativePath: `.kanna/pipelines/${pipelineName}.json`,
        });
        pipeline = parsePipelineJson(content);
      } catch (resourceErr) {
        throw new Error(`Pipeline "${pipelineName}" not found: ${resourceErr instanceof Error ? resourceErr.message : JSON.stringify(resourceErr)}`);
      }
    }
    pipelineCache.set(cacheKey, pipeline);
    return pipeline;
  }

  async function loadAgent(repoPath: string, agentName: string): Promise<AgentDefinition> {
    const cacheKey = `${repoPath}::${agentName}`;
    const cached = agentCache.get(cacheKey);
    if (cached) return cached;

    // Try repo file first, fall back to bundled resource
    let agent: AgentDefinition;
    try {
      const path = `${repoPath}/.kanna/agents/${agentName}/AGENT.md`;
      const content = await invoke<string>("read_text_file", { path });
      agent = parseAgentDefinition(content);
    } catch {
      try {
        const content = await invoke<string>("read_builtin_resource", {
          relativePath: `.kanna/agents/${agentName}/AGENT.md`,
        });
        agent = parseAgentDefinition(content);
      } catch (resourceErr) {
        throw new Error(`Agent "${agentName}" not found on disk or in bundled resources: ${resourceErr instanceof Error ? resourceErr.message : JSON.stringify(resourceErr)}`);
      }
    }
    agentCache.set(cacheKey, agent);
    return agent;
  }

  /** Check if an item has unresolved blockers (blockers whose closed_at is null). */
  async function hasUnresolvedBlockers(itemId: string): Promise<boolean> {
    const blockers = await listBlockersForItem(_db, itemId);
    return blockers.some(b => b.closed_at === null);
  }

  // ── Computed getters ─────────────────────────────────────────────
  const selectedRepo = computed(() =>
    repos.value.find((r) => r.id === selectedRepoId.value) ?? null
  );

  /** An item is hidden when its stage is 'done'. closed_at is informational only. */
  function isItemHidden(item: PipelineItem): boolean {
    return item.stage === "done";
  }

  const currentItem = computed(() => {
    if (selectedItemId.value) {
      const item = items.value.find((i) => i.id === selectedItemId.value);
      if (item && !isItemHidden(item) && item.repo_id === selectedRepoId.value) return item;
    }
    // Auto-select first task in current repo if nothing valid is selected.
    // Skip items whose worktree/agent setup is still in progress — their
    // terminal would race to spawn before the daemon session is ready.
    return sortedItemsForCurrentRepo.value
      .find(i => !pendingSetupIds.value.includes(i.id)) ?? null;
  });

  /**
   * Sort items for a repo by pipeline stage order.
   * Order: pinned -> stages in pipeline order -> blocked (items with unresolved blockers).
   * Within each group, sorted by created_at DESC.
   */
  function sortItemsForRepo(repoId: string): PipelineItem[] {
    const repoItems = items.value.filter(
      (item) => item.repo_id === repoId && !isItemHidden(item)
    );
    const pinned = repoItems
      .filter((i) => i.pinned)
      .sort((a, b) => (a.pin_order ?? 0) - (b.pin_order ?? 0));
    const sortByCreatedAt = (arr: typeof repoItems) =>
      arr.sort((a, b) => b.created_at.localeCompare(a.created_at));

    // Separate blocked items (those with "blocked" tag — kept for backward compat
    // until blocker system fully migrated) from stage-sorted items
    const blocked = sortByCreatedAt(repoItems.filter((i) => hasTag(i, "blocked") && !i.pinned));
    const blockedIds = new Set(blocked.map(i => i.id));

    // Non-pinned, non-blocked items sorted by stage order.
    // Items in the same stage are sorted by created_at DESC.
    const stageItems = repoItems.filter(i => !i.pinned && !blockedIds.has(i.id));

    // Use repo-level stage_order from config.json, falling back to built-in default.
    // Stages not in the list sort alphabetically after listed stages.
    const order = getStageOrder(repoId);

    const stageOrder = (item: PipelineItem): number => {
      const idx = order.indexOf(item.stage);
      return idx === -1 ? order.length : idx;
    };

    const sortedStageItems = stageItems.sort((a, b) => {
      const orderA = stageOrder(a);
      const orderB = stageOrder(b);
      if (orderA !== orderB) return orderA - orderB;
      // Unlisted stages with same sort position: alphabetical by stage name
      if (orderA === order.length && a.stage !== b.stage) {
        return a.stage.localeCompare(b.stage);
      }
      return b.created_at.localeCompare(a.created_at);
    });

    return [...pinned, ...sortedStageItems, ...blocked];
  }

  // pinned (by pin_order) -> stages in pipeline order -> blocked (each by created_at desc).
  const sortedItemsForCurrentRepo = computed(() =>
    sortItemsForRepo(selectedRepoId.value ?? "")
  );

  // All items across all repos, in sidebar order (repo by repo, each with its own sort).
  const sortedItemsAllRepos = computed(() =>
    repos.value.flatMap((repo) => sortItemsForRepo(repo.id))
  );

  // ── Actions: Selection ───────────────────────────────────────────
  async function selectRepo(repoId: string) {
    selectedRepoId.value = repoId;
    selectedItemId.value = lastSelectedItemByRepo.value[repoId] ?? null;
    await setSetting(_db, "selected_repo_id", repoId);
  }

  // Mark unread → idle after 1s dwell. Array replacement (not mutation)
  // because computedAsync items are a shallowRef.
  watchDebounced(selectedItemId, async (itemId) => {
    if (!itemId) return;
    const selectionTime = Date.now() - 1000;
    const item = items.value.find((i) => i.id === itemId);
    if (!item || item.activity !== "unread") return;
    if (item.activity_changed_at && new Date(item.activity_changed_at).getTime() > selectionTime) return;
    await updatePipelineItemActivity(_db, itemId, "idle");
    items.value = items.value.map((i) =>
      i.id === itemId ? { ...i, activity: "idle", activity_changed_at: new Date().toISOString() } : i,
    );
  }, { debounce: 1000 });

  /** Select a task, recording the previous one in navigation history. */
  async function selectItem(itemId: string) {
    nav.select(itemId, selectedItemId.value);
    selectedItemId.value = itemId;
    const item = items.value.find((i) => i.id === itemId);
    if (item) {
      lastSelectedItemByRepo.value[item.repo_id] = itemId;
    }
    await setSetting(_db, "selected_item_id", itemId);
    emitTaskSelected(itemId);
  }

  /** Restore selection without recording history (startup / DB restore). */
  function restoreSelection(itemId: string) {
    selectedItemId.value = itemId;
    const item = items.value.find((i) => i.id === itemId);
    if (item) {
      lastSelectedItemByRepo.value[item.repo_id] = itemId;
    }
  }

  /** Navigate back, switching repos if needed. */
  function goBack() {
    if (!selectedItemId.value) return;
    const validIds = new Set(items.value.filter((i) => !isItemHidden(i)).map((i) => i.id));
    const taskId = nav.goBack(selectedItemId.value, validIds);
    if (!taskId) return;
    const item = items.value.find((i) => i.id === taskId);
    if (item) {
      if (item.repo_id !== selectedRepoId.value) {
        selectedRepoId.value = item.repo_id;
        setSetting(_db, "selected_repo_id", item.repo_id);
      }
      lastSelectedItemByRepo.value[item.repo_id] = taskId;
    }
    selectedItemId.value = taskId;
    setSetting(_db, "selected_item_id", taskId);
    emitTaskSelected(taskId);
  }

  /** Navigate forward, switching repos if needed. */
  function goForward() {
    if (!selectedItemId.value) return;
    const validIds = new Set(items.value.filter((i) => !isItemHidden(i)).map((i) => i.id));
    const taskId = nav.goForward(selectedItemId.value, validIds);
    if (!taskId) return;
    const item = items.value.find((i) => i.id === taskId);
    if (item) {
      if (item.repo_id !== selectedRepoId.value) {
        selectedRepoId.value = item.repo_id;
        setSetting(_db, "selected_repo_id", item.repo_id);
      }
      lastSelectedItemByRepo.value[item.repo_id] = taskId;
    }
    selectedItemId.value = taskId;
    setSetting(_db, "selected_item_id", taskId);
    emitTaskSelected(taskId);
  }

  // ── Actions: Repo management ─────────────────────────────────────
  async function importRepo(path: string, name: string, defaultBranch: string): Promise<string> {
    const existing = await findRepoByPath(_db, path);
    if (existing) {
      if (existing.hidden) {
        await unhideRepoQuery(_db, existing.id);
        bump();
        selectedRepoId.value = existing.id;
      }
      return existing.id;
    }
    const id = generateId();
    await insertRepo(_db, { id, path, name, default_branch: defaultBranch });
    bump();
    selectedRepoId.value = id;
    if (isTauri) {
      spawnShellSession(`shell-repo-${id}`, path, null, false)
        .catch(e => reportPrewarmSessionError("[store] repo shell pre-warm failed:", e));
    }
    return id;
  }

  async function createRepo(name: string, path: string) {
    const existing = await findRepoByPath(_db, path);
    if (existing) {
      if (existing.hidden) {
        await unhideRepoQuery(_db, existing.id);
        bump();
        selectedRepoId.value = existing.id;
      }
      return;
    }
    await invoke("ensure_directory", { path });
    await invoke("git_init", { path });
    const defaultBranch = await invoke<string>("git_default_branch", { repoPath: path }).catch(() => "main");
    const id = generateId();
    await insertRepo(_db, { id, path, name, default_branch: defaultBranch });
    bump();
    selectedRepoId.value = id;
    if (isTauri) {
      spawnShellSession(`shell-repo-${id}`, path, null, false)
        .catch(e => reportPrewarmSessionError("[store] repo shell pre-warm failed:", e));
    }
  }

  async function cloneAndImportRepo(url: string, destination: string) {
    await invoke("git_clone", { url, destination });
    const name = destination.split("/").pop() || "repo";
    const defaultBranch = await invoke<string>("git_default_branch", { repoPath: destination }).catch(() => "main");
    const id = generateId();
    await insertRepo(_db, { id, path: destination, name, default_branch: defaultBranch });
    bump();
    selectedRepoId.value = id;
    if (isTauri) {
      spawnShellSession(`shell-repo-${id}`, destination, null, false)
        .catch(e => reportPrewarmSessionError("[store] repo shell pre-warm failed:", e));
    }
  }

  async function allocateTransferredRepoPath(repoName: string): Promise<string> {
    const appDataDir = await invoke<string>("get_app_data_dir");
    const parentDir = `${appDataDir}/transferred-repos`;
    await invoke("ensure_directory", { path: parentDir });

    const baseName = sanitizeTransferRepoName(repoName);
    let candidate = `${parentDir}/${baseName}`;
    let exists = await invoke<boolean>("file_exists", { path: candidate }).catch(() => false);
    if (!exists) {
      return candidate;
    }

    for (let index = 2; index <= 99; index += 1) {
      candidate = `${parentDir}/${baseName}-${index}`;
      exists = await invoke<boolean>("file_exists", { path: candidate }).catch(() => false);
      if (!exists) {
        return candidate;
      }
    }

    return `${parentDir}/${baseName}-${Date.now()}`;
  }

  async function ensureIncomingTransferRepo(
    transferId: string,
    payload: OutgoingTransferPayload,
  ): Promise<{ repoId: string; repoPath: string }> {
    const repoName = payload.repo.name ?? "repo";
    const defaultBranch = payload.repo.default_branch ?? "main";

    if (payload.repo.mode === "reuse-local") {
      const repoPath = payload.repo.path;
      if (!repoPath) {
        throw new Error("incoming transfer payload is missing a local repo path");
      }

      const repoExists = await invoke<boolean>("file_exists", { path: repoPath });
      if (!repoExists) {
        throw new Error(`incoming transfer repo path does not exist: ${repoPath}`);
      }

      const repoId = await importRepo(repoPath, repoName, defaultBranch);
      return { repoId, repoPath };
    }

    if (payload.repo.mode === "clone-remote") {
      if (!payload.repo.remote_url) {
        throw new Error("incoming transfer payload is missing a remote URL");
      }

      const repoPath = await allocateTransferredRepoPath(repoName);
      await invoke("git_clone", {
        url: payload.repo.remote_url,
        destination: repoPath,
      });
      const repoId = await importRepo(repoPath, repoName, defaultBranch);
      return { repoId, repoPath };
    }

    if (payload.repo.mode === "bundle-repo") {
      const artifactId = payload.repo.bundle?.artifact_id;
      if (!artifactId) {
        throw new Error("incoming transfer payload is missing bundle metadata");
      }

      const fetched = await invoke<{ path: string }>("fetch_transfer_artifact", {
        transferId,
        artifactId,
      });
      const repoPath = await allocateTransferredRepoPath(repoName);
      await invoke("git_init", { path: repoPath });
      const checkoutRef =
        payload.repo.bundle?.ref_name ??
        normalizeTransferRefName(payload.task.branch) ??
        normalizeTransferRefName(payload.task.base_ref) ??
        "HEAD";
      await invoke("run_script", {
        script: `git fetch ${shellQuote(fetched.path)} '+refs/*:refs/*' && git checkout ${shellQuote(checkoutRef)}`,
        cwd: repoPath,
        env: applyWorktreeProcessIsolation({ KANNA_WORKTREE: "1" }),
      });
      const repoId = await importRepo(repoPath, repoName, defaultBranch);
      return { repoId, repoPath };
    }

    throw new Error(`unsupported repo acquisition mode: ${payload.repo.mode satisfies never}`);
  }

  async function hideRepo(repoId: string) {
    await hideRepoQuery(_db, repoId);
    if (selectedRepoId.value === repoId) selectedRepoId.value = null;
    lastHiddenRepoId.value = repoId;
    bump();
  }

  // ── Actions: Pipeline CRUD ───────────────────────────────────────
  async function createItem(
    repoId: string,
    repoPath: string,
    prompt: string,
    agentType: "pty" | "sdk" = "pty",
    opts?: CreateItemOptions,
  ): Promise<string> {
    const t0 = performance.now();
    const id = generateId();
    const branch = `task-${id}`;
    const worktreePath = `${repoPath}/.kanna-worktrees/${branch}`;

    // Compute effective values from custom task config
    const effectivePrompt = opts?.customTask?.prompt ?? prompt;
    const effectiveAgentType = opts?.customTask?.executionMode ?? agentType;
    const requestedAgentProviders = opts?.customTask?.agentProvider ?? opts?.agentProvider;
    const displayName = opts?.customTask?.name ?? opts?.displayName ?? null;
    const pendingPlaceholder = buildPendingTaskPlaceholder({
      id,
      repoId,
      prompt: effectivePrompt,
      branch,
      agentType: effectiveAgentType,
      requestedAgentProviders,
      pipelineName: opts?.pipelineName,
      stage: opts?.stage,
      displayName,
    });

    items.value = [
      pendingPlaceholder,
      ...items.value.filter((item) => item.id !== id),
    ];
    pendingSetupIds.value = [...pendingSetupIds.value, id];
    pendingCreateVisibility.set(id, { bumpAt: performance.now() });

    const removePendingPlaceholder = () => {
      items.value = items.value.filter((item) => item.id !== id);
      pendingSetupIds.value = pendingSetupIds.value.filter((pendingId) => pendingId !== id);
      pendingCreateVisibility.delete(id);
    };

    // Resolve pipeline name: explicit > repo config > "default"
    let pipelineName = opts?.pipelineName;
    let t1 = performance.now();
    let repoConfig: RepoConfig = {};
    if (!pipelineName) {
      try {
        repoConfig = await readRepoConfig(repoPath);
        pipelineName = repoConfig.pipeline ?? "default";
      } catch {
        pipelineName = "default";
      }
    }
    console.log(`[perf:createItem] readRepoConfig: ${(performance.now() - t1).toFixed(1)}ms`);

    // Load pipeline definition and resolve stage
    let firstStageName = opts?.stage ?? "in progress";
    let pipelinePrompt = effectivePrompt;
    let firstStageProviders: AgentProvider | AgentProvider[] | undefined;
    let firstStageAgentProviders: AgentProvider | AgentProvider[] | undefined;
    t1 = performance.now();
    try {
      const pipeline = await loadPipeline(repoPath, pipelineName);
      if (!opts?.stage && pipeline.stages.length > 0) {
        const firstStage = pipeline.stages[0];
        firstStageName = firstStage.name;
        firstStageProviders = firstStage.agent_provider as AgentProvider | AgentProvider[] | undefined;

        // Load the first stage's agent and build prompt (skip if stage was overridden — prompt already built)
        if (firstStage.agent && !opts?.stage) {
          try {
            const agent = await loadAgent(repoPath, firstStage.agent);
            firstStageAgentProviders = agent.agent_provider as AgentProvider | AgentProvider[] | undefined;
            pipelinePrompt = buildStagePrompt(agent.prompt, firstStage.prompt, {
              taskPrompt: effectivePrompt,
            });
          } catch (e) {
            console.error("[store] failed to load agent for first stage:", e);
            // Fall back to the raw prompt
          }
        }
      }
    } catch (e) {
      console.error("[store] failed to load pipeline definition:", e);
      // Fall back to defaults — pipeline missing is not fatal at creation time
    }
    console.log(`[perf:createItem] loadPipeline+loadAgent: ${(performance.now() - t1).toFixed(1)}ms`);

    if (Object.keys(repoConfig).length === 0) {
      try {
        repoConfig = await readRepoConfig(repoPath);
      } catch {
        repoConfig = {};
      }
    }

    let effectiveAgentProvider: AgentProvider;
    try {
      const candidates = getPreferredAgentProviders({
        explicit: requestedAgentProviders,
        stage: firstStageProviders,
        agent: firstStageAgentProviders,
      });
      const availability = await getAgentProviderAvailability();
      effectiveAgentProvider = resolveAgentProvider(candidates, availability);
    } catch (e) {
      console.error("[store] createItem: failed to resolve agent provider:", e);
      throw e;
    }

    let portOffset: number | null = null;
    let portEnv: Record<string, string> = {};
    let baseRef: string | null = null;
    let pipelineItemInserted = false;
    try {
      await withPortAllocationLock(async () => {
        try {
          // Compute base_ref for merge-base diffing
          t1 = performance.now();
          try {
            const defaultBranch = await invoke<string>("git_default_branch", { repoPath });
            const availableBaseBranches = await invoke<string[]>("git_list_base_branches", { repoPath })
              .catch(() => [defaultBranch]);
            baseRef = resolveInitialBaseRef({
              selectedBaseBranch: opts?.baseBranch,
              availableBaseBranches,
              defaultBranch,
            });
          } catch (e) {
            console.warn("[store] failed to compute base_ref:", e);
          }
          console.log(`[perf:createItem] git base_ref: ${(performance.now() - t1).toFixed(1)}ms`);

          // Insert DB record once the final metadata is known.
          t1 = performance.now();
          await insertPipelineItem(_db, {
            id,
            repo_id: repoId,
            issue_number: null,
            issue_title: null,
            prompt: effectivePrompt,
            pipeline: pipelineName,
            stage: firstStageName,
            tags: opts?.tags ?? [firstStageName],
            pr_number: null,
            pr_url: null,
            branch,
            agent_type: effectiveAgentType,
            agent_provider: effectiveAgentProvider,
            port_offset: portOffset,
            port_env: Object.keys(portEnv).length > 0 ? JSON.stringify(portEnv) : null,
            activity: "working",
            display_name: displayName,
            base_ref: baseRef,
          });

          pipelineItemInserted = true;

          // Assign machine-wide ports only after the task row exists so the
          // task_port foreign key can reference the new pipeline_item.
          const allocated = await claimTaskPorts(id, repoConfig);
          portOffset = allocated.firstPort;
          portEnv = allocated.portEnv;
          await _db.execute(
            `UPDATE pipeline_item SET port_offset = ?, port_env = ?, updated_at = datetime('now') WHERE id = ?`,
            [portOffset, Object.keys(portEnv).length > 0 ? JSON.stringify(portEnv) : null, id],
          );
          if (opts?.resumeSessionId) {
            await updateAgentSessionId(_db, id, opts.resumeSessionId);
          }
        } catch (e) {
          if (pipelineItemInserted) {
            await _db.execute("DELETE FROM pipeline_item WHERE id = ?", [id]).catch(() => undefined);
          }
          await deleteTaskPortsForItem(_db, id).catch(() => undefined);
          console.error("[store] task creation failed:", e);
          toast.error(tt('toasts.dbInsertFailed'));
          throw e;
        }
        console.log(`[perf:createItem] DB insert: ${(performance.now() - t1).toFixed(1)}ms`);
      });

      bump();
      console.log(`[perf:createItem] bump -> waiting for items refresh (id=${id})`);
      console.log(`[perf:createItem] TOTAL (modal → bump): ${(performance.now() - t0).toFixed(1)}ms`);

      // Worktree creation, config read, and agent spawn run in the background.
      // Selection is deferred until setup completes so the terminal mounts
      // only after the session exists in the daemon.
      setupWorktreeAndSpawn(
        id,
        repoPath,
        worktreePath,
        branch,
        portEnv,
        pipelinePrompt,
        effectiveAgentType,
        effectiveAgentProvider,
        opts,
      );
    } catch (e) {
      removePendingPlaceholder();
      throw e;
    }

    return id;
  }

  /** Background IO for createItem: read config, create worktree, spawn agent, then select. */
  async function setupWorktreeAndSpawn(
    id: string, repoPath: string, worktreePath: string,
    branch: string, portEnv: Record<string, string>, prompt: string,
    agentType: "pty" | "sdk",
    agentProvider: AgentProvider,
    opts?: CreateItemOptions,
  ) {
    const s0 = performance.now();
    const markSetupFailed = async (error: unknown, logPrefix: string, toastMessage: string) => {
      await updatePipelineItemActivity(_db, id, "idle");
      bump();
      console.error(logPrefix, error);
      toast.error(toastMessage);
    };

    try {
      let s1 = performance.now();
      let worktreeBootstrap: WorktreeBootstrapResult | null = null;
      let ptySetupCmds: string[] = [];
      if (agentType === "pty") {
        try {
          worktreeBootstrap = await createWorktree(repoPath, branch, worktreePath, opts?.baseBranch);
          const repoConfig = await readRepoConfig(worktreePath);
          ptySetupCmds = repoConfig.setup || [];
        } catch (e) {
          await markSetupFailed(
            e,
            "[store] failed to read repo config or create worktree:",
            tt('toasts.worktreeFailed'),
          );
          return;
        }
        console.log(`[perf:setup] readConfig+createWorktree: ${(performance.now() - s1).toFixed(1)}ms`);
      } else {
        try {
          await createWorktree(repoPath, branch, worktreePath, opts?.baseBranch);
        } catch (e) {
          await markSetupFailed(
            e,
            "[store] git_worktree_add failed:",
            tt('toasts.worktreeFailed'),
          );
          return;
        }
        console.log(`[perf:setup] readConfig+createWorktree: ${(performance.now() - s1).toFixed(1)}ms`);
      }

      s1 = performance.now();
      try {
        if (shouldPrewarmTaskShellOnCreate(agentType)) {
          // Pre-warm shell for ⌘J — fire-and-forget, runs in parallel with agent spawn
          prewarmWorktreeShellSession(`shell-wt-${id}`, worktreePath, JSON.stringify(portEnv), repoPath)
            .catch(e => reportPrewarmSessionError("[store] shell pre-warm failed:", e));
        }

        if (agentType !== "pty") {
          await invoke("create_agent_session", {
            sessionId: id,
            cwd: worktreePath,
            prompt,
            systemPrompt: null,
            permissionMode: opts?.customTask?.permissionMode ?? null,
            model: opts?.customTask?.model ?? null,
            allowedTools: opts?.customTask?.allowedTools ?? null,
            disallowedTools: opts?.customTask?.disallowedTools ?? null,
              maxTurns: opts?.customTask?.maxTurns ?? null,
              maxBudgetUsd: opts?.customTask?.maxBudgetUsd ?? null,
            });
        } else {
          const { env, setupCmds, agentCmd, kannaCliPath } = await preparePtySession(id, prompt, {
            agentProvider,
            model: opts?.customTask?.model,
            permissionMode: opts?.customTask?.permissionMode,
            allowedTools: opts?.customTask?.allowedTools,
            disallowedTools: opts?.customTask?.disallowedTools,
            maxTurns: opts?.customTask?.maxTurns,
            maxBudgetUsd: opts?.customTask?.maxBudgetUsd,
            setupCmdsOverride: opts?.customTask?.setup,
            portEnv,
            setupCmds: ptySetupCmds,
            resumeSessionId: opts?.resumeSessionId ?? undefined,
          });
          const bootstrapAgentCmd = buildTaskShellCommand(agentCmd, [], { kannaCliPath });
          const bootstrapCmd = buildTaskBootstrapCommand({
            worktreePath,
            visibleBootstrapSteps: worktreeBootstrap?.visibleBootstrapSteps ?? [],
            setupCmds,
            agentCmd: bootstrapAgentCmd,
          });
          await invoke("spawn_session", {
            sessionId: id,
            cwd: worktreePath,
            executable: "/bin/zsh",
            args: ["--login", "-i", "-c", bootstrapCmd],
            env,
            cols: 80,
            rows: 24,
            agentProvider,
          });
          if (opts?.recoverySnapshot) {
            await invoke("seed_session_recovery_state", {
              sessionId: id,
              serialized: opts.recoverySnapshot.serialized,
              cols: opts.recoverySnapshot.cols,
              rows: opts.recoverySnapshot.rows,
              cursorRow: opts.recoverySnapshot.cursorRow,
              cursorCol: opts.recoverySnapshot.cursorCol,
              cursorVisible: opts.recoverySnapshot.cursorVisible,
            });
          }
          await syncTaskStatusesFromDaemon();
        }
      } catch (e) {
        await markSetupFailed(
          e,
          "[store] agent spawn failed:",
          `${tt('toasts.agentStartFailed')}: ${e instanceof Error ? e.message : e}`,
        );
        return;
      }
      console.log(`[perf:setup] spawnSession: ${(performance.now() - s1).toFixed(1)}ms`);

      // Select after setup so the terminal mounts with the session already alive
      s1 = performance.now();
      await selectItem(id);
      console.log(`[perf:setup] selectItem: ${(performance.now() - s1).toFixed(1)}ms`);
      console.log(`[perf:setup] TOTAL (background): ${(performance.now() - s0).toFixed(1)}ms`);
    } finally {
      pendingSetupIds.value = pendingSetupIds.value.filter(pid => pid !== id);
      await syncTaskStatusesFromDaemon();
    }
  }

  async function isAgentProviderAvailable(provider: AgentProvider): Promise<boolean> {
    try {
      const path = await invoke<string | null>("which_binary", { name: provider });
      return Boolean(path);
    } catch (e) {
      console.debug(`[store] which_binary failed for ${provider}:`, e);
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

  async function createWorktree(
    repoPath: string,
    branch: string,
    worktreePath: string,
    baseBranch?: string,
  ): Promise<WorktreeBootstrapResult> {
    const visibleBootstrapSteps: string[] = [];

    let startPoint = getCreateWorktreeStartPoint(baseBranch);
    let renderedStartPoint = startPoint ?? "HEAD";

    if (!startPoint) {
      try {
        const defaultBranch = await invoke<string>("git_default_branch", { repoPath });
        renderedStartPoint = defaultBranch;
        visibleBootstrapSteps.push(`git fetch origin ${defaultBranch}`);
        await invoke("git_fetch", { repoPath, branch: defaultBranch });
        startPoint = `origin/${defaultBranch}`;
        renderedStartPoint = startPoint;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isOffline = /could not resolve host|network is unreachable|connection refused|timed out/i.test(msg);
        const noRemote = /does not appear to be a git repository|could not find remote|no remote|remote.*not found/i.test(msg);
        if (isOffline || noRemote) {
          console.debug("[store] fetch origin failed (offline or no remote), using local HEAD");
        } else {
          console.warn("[store] fetch origin failed:", msg);
          toast.warning(tt('toasts.fetchFailed'));
        }
      }
    }

    await invoke("git_worktree_add", {
      repoPath,
      branch,
      path: worktreePath,
      startPoint,
    });

    visibleBootstrapSteps.push(
      `git worktree add -b ${branch} '${worktreePath.replace(/'/g, `'\\''`)}' ${renderedStartPoint}`,
    );

    return { visibleBootstrapSteps };
  }


  /** Spawn a bare zsh login shell in the daemon. Used for pre-warming and as ShellModal fallback. */
  async function spawnShellSession(
    sessionId: string,
    cwd: string,
    portEnv?: string | null,
    isWorktree = true,
    fallbackCwd?: string | null,
  ): Promise<void> {
    const env: Record<string, string> = { TERM: "xterm-256color" };
    if (isWorktree) {
      env.KANNA_WORKTREE = "1";
      applyWorktreeProcessIsolation(env);
    }
    if (portEnv) {
      try {
        Object.assign(env, JSON.parse(portEnv));
      } catch (e) {
        console.error("[store] failed to parse portEnv:", e);
      }
    }
    try {
      env.ZDOTDIR = await invoke<string>("ensure_term_init");
    } catch (e) {
      console.error("[store] failed to set up term init:", e);
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

    // When options are provided (e.g. from createItem/startBlockedTask), use them directly
    // to avoid a race with computedAsync not having refreshed items.value yet.
    if (options?.portEnv) {
      Object.assign(env, options.portEnv);
    } else {
      // Fallback: read from items.value (works for undoClose and terminal retry)
      const item = items.value.find((i) => i.id === sessionId);
      if (item) {
        if (item.port_env) {
          try {
            Object.assign(env, JSON.parse(item.port_env));
          } catch (e) { console.error("[store] failed to parse port_env:", e); }
        }
        if (setupCmds.length === 0) {
          try {
            const repo = await getRepo(_db, item.repo_id);
            if (repo && item.branch) {
              const worktreePath = `${repo.path}/.kanna-worktrees/${item.branch}`;
              const repoConfig = await readRepoConfig(worktreePath);
              if (repoConfig.setup?.length) setupCmds = repoConfig.setup;
            }
          } catch (e) { console.error("[store] failed to read setup config:", e); }
        }
      }
    }

    env.KANNA_WORKTREE = "1";
    applyWorktreeProcessIsolation(env);

    try {
      kannaCliPath = await invoke<string>("which_binary", { name: "kanna-cli" });
      env.KANNA_CLI_PATH = kannaCliPath;
    } catch (e) {
      console.error("[store] failed to resolve kanna-cli path:", e);
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
    } catch (e) {
      console.error("[store] failed to resolve kanna-cli env:", e);
    }
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    let agentCmd: string;
    const permissionFlags = getAgentPermissionFlags(provider, options?.permissionMode);

    if (provider === "copilot") {
      // Build Copilot flags
      const copilotFlags: string[] = [...permissionFlags];
      if (options?.model) copilotFlags.push(`--model=${options.model}`);
      if (options?.allowedTools?.length) {
        for (const tool of options.allowedTools) copilotFlags.push(`--allow-tool=${tool}`);
      }
      if (options?.disallowedTools?.length) {
        for (const tool of options.disallowedTools) copilotFlags.push(`--deny-tool=${tool}`);
      }
      // maxTurns and maxBudgetUsd have no Copilot equivalent — skip silently

      // Session ID: always pass --resume. Copilot creates a new session if the ID
      // doesn't exist yet, or resumes it if it does.
      const copilotSessionId = options?.resumeSessionId || crypto.randomUUID();
      if (!options?.resumeSessionId) {
        await updateAgentSessionId(_db, sessionId, copilotSessionId);
      }
      copilotFlags.push(`--resume=${copilotSessionId}`);

      agentCmd = options?.resumeSessionId
        ? `copilot ${copilotFlags.join(" ")}`
        : `copilot ${copilotFlags.join(" ")} -i '${escapedPrompt}'`;
    } else if (provider === "codex") {
      if (options?.resumeSessionId) {
        agentCmd = `codex resume ${shellQuote(options.resumeSessionId)}`;
      } else {
        // Build Codex flags
        const codexFlags: string[] = [...permissionFlags];
        if (options?.model) codexFlags.push(`-m ${options.model}`);
        // maxTurns and maxBudgetUsd have no Codex equivalent — skip silently

        agentCmd = escapedPrompt
          ? `codex ${codexFlags.join(" ")} '${escapedPrompt}'`
          : `codex ${codexFlags.join(" ")}`;
      }
    } else {
      // Claude: inject hooks via --settings flag
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

      // Session ID: reuse for resume, generate new for fresh sessions
      const claudeSessionId = options?.resumeSessionId || crypto.randomUUID();
      if (!options?.resumeSessionId) {
        await updateAgentSessionId(_db, sessionId, claudeSessionId);
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

  async function spawnPtySession(sessionId: string, cwd: string, prompt: string, cols = 80, rows = 24, options?: PtySpawnOptions) {
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

  function computeNextItemId(closingId: string): string | null {
    const sorted = sortedItemsForCurrentRepo.value;
    const idx = sorted.findIndex((i) => i.id === closingId);
    const remaining = sorted.filter((i) => i.id !== closingId);
    const nextIdx = idx >= remaining.length ? remaining.length - 1 : idx;
    return remaining[nextIdx]?.id || null;
  }

  function selectNextItem(nextId: string | null) {
    if (nextId) {
      if (selectedItemId.value === nextId) return;
      selectItem(nextId);
    } else {
      if (selectedItemId.value === null) return;
      selectedItemId.value = null;
    }
  }

  async function closeTask(
    targetItemId?: string,
    opts?: { selectNext?: boolean },
  ) {
    const item = targetItemId
      ? items.value.find(i => i.id === targetItemId)
      : currentItem.value;
    const repo = item
      ? repos.value.find(r => r.id === item.repo_id)
      : selectedRepo.value;
    if (!item || !repo) return;
    try {
      // Compute next item before any stage changes move the item in the sort order
      const nextId = opts?.selectNext !== false ? computeNextItemId(item.id) : null;

      // Save current stage for undo (idempotent — skips if already saved from linger)
      await _db.execute(
        "UPDATE pipeline_item SET previous_stage = stage, updated_at = datetime('now') WHERE id = ? AND previous_stage IS NULL",
        [item.id]
      );

      const wasBlocked = hasTag(item, "blocked");
      const existingTeardown = isTeardownStage(item.stage);
      const teardownCmds = wasBlocked || existingTeardown
        ? []
        : await collectTeardownCommands(item, repo);
      const closeBehavior = getTaskCloseBehavior({
        wasBlocked,
        currentStage: item.stage,
        hasTeardownCommands: teardownCmds.length > 0,
      });

      // Already in teardown — second close kills sessions and finishes
      if (closeBehavior === "finish" && existingTeardown) {
        await Promise.all([
          invoke("kill_session", { sessionId: item.id }).catch((e: unknown) =>
            reportCloseSessionError("[store] kill agent session failed:", e)),
          invoke("kill_session", { sessionId: `shell-wt-${item.id}` }).catch((e: unknown) =>
            reportCloseSessionError("[store] kill shell session failed:", e)),
          invoke("kill_session", { sessionId: `td-${item.id}` }).catch((e: unknown) =>
            reportCloseSessionError("[store] kill teardown session failed:", e)),
        ]);
        await closeTaskAndReleasePorts(item.id, (id) => closePipelineItem(_db, id));

        if (opts?.selectNext !== false) selectNextItem(nextId);
        await checkUnblocked(item.id);
        bump();
        return;
      }

      // Blocked tasks never started — no teardown needed
      if (closeBehavior === "finish" && wasBlocked) {
        await removeAllBlockersForItem(_db, item.id);
        await closeTaskAndReleasePorts(item.id, (id) => closePipelineItem(_db, id));

        if (opts?.selectNext !== false) selectNextItem(nextId);
        bump();
        (async () => {
          await invoke("kill_session", { sessionId: item.id }).catch((e: unknown) =>
            reportCloseSessionError("[store] kill_session failed:", e));
        })();
        return;
      }

      if (closeBehavior === "finish") {
        await Promise.all([
          invoke("kill_session", { sessionId: item.id }).catch((e: unknown) =>
            reportCloseSessionError("[store] kill agent session failed:", e)),
          invoke("kill_session", { sessionId: `shell-wt-${item.id}` }).catch((e: unknown) =>
            reportCloseSessionError("[store] kill shell session failed:", e)),
        ]);
        if (shouldSelectNextOnCloseTransition({
          selectNext: opts?.selectNext !== false,
          wasBlocked,
          previousStage: item.stage,
          nextStage: "done",
        })) {
          selectNextItem(nextId);
        }
        await closeTaskAndReleasePorts(item.id, (id) => closePipelineItem(_db, id));
        await checkUnblocked(item.id);
        bump();
        return;
      }

      // 1. Stop the agent CLI
      await invoke("signal_session", { sessionId: item.id, signal: "SIGINT" }).catch((e: unknown) =>
        reportCloseSessionError("[store] signal_session failed:", e));

      // 2. Run teardown scripts
      let teardownExit: Promise<void> | null = null;
      const worktreePath = `${repo.path}/.kanna-worktrees/${item.branch}`;
      const scriptParts = teardownCmds.map((cmd) => {
        const escaped = cmd.replace(/'/g, "'\\''");
        return `printf '\\033[2m$ %s\\033[0m\\n' '${escaped}' && ${cmd}`;
      });
      const fullCmd = `printf '\\033[33mRunning teardown...\\033[0m\\n' && ${scriptParts.join(" && ")} && printf '\\n'`;
      const tdSessionId = `td-${item.id}`;
      teardownExit = waitForSessionExit(tdSessionId);
      const teardownEnv = applyWorktreeProcessIsolation({
        KANNA_WORKTREE: "1",
      });
      await invoke("spawn_session", {
        sessionId: tdSessionId,
        cwd: worktreePath,
        executable: "/bin/zsh",
        args: ["--login", "-i", "-c", fullCmd],
        env: teardownEnv,
        cols: 120,
        rows: 30,
      });
      await invoke("attach_session", { sessionId: tdSessionId, agentProvider: "claude" });

      // 3. Mark teardown — if linger, keep sessions alive for user to review
      await updatePipelineItemStage(_db, item.id, TEARDOWN_STAGE);
      if (shouldSelectNextOnCloseTransition({
        selectNext: opts?.selectNext !== false,
        wasBlocked,
        previousStage: item.stage,
        nextStage: TEARDOWN_STAGE,
        })) {
        selectNextItem(nextId);
      }
      bump();

      void teardownExit;
      return;
    } catch (e) {
      console.error("[store] close failed:", e);
      toast.error(tt('toasts.closeTaskFailed'));
    }
  }

  async function undoClose() {
    if (lastHiddenRepoId.value) {
      const repoId = lastHiddenRepoId.value;
      lastHiddenRepoId.value = null;
      await unhideRepoQuery(_db, repoId);
      bump();
      return;
    }
    try {
      const rows = await _db.select<PipelineItem>(
        "SELECT * FROM pipeline_item WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 1"
      );
      const item = rows[0];
      if (!item) return;
      const repo = repos.value.find((r) => r.id === item.repo_id);
      if (!repo) return;
      await reopenPipelineItem(_db, item.id);
      let portEnv: Record<string, string> = {};
      let portOffset: number | null = null;
      let portAllocationFailed = false;
      try {
        const repoConfig = await readRepoConfig(repo.path);
        await withPortAllocationLock(async () => {
          const allocated = await claimTaskPorts(item.id, repoConfig);
          portEnv = allocated.portEnv;
          portOffset = allocated.firstPort;
          await _db.execute(
            `UPDATE pipeline_item SET port_offset = ?, port_env = ?, updated_at = datetime('now') WHERE id = ?`,
          [portOffset, Object.keys(portEnv).length > 0 ? JSON.stringify(portEnv) : null, item.id],
          );
        });
      } catch (e) {
        await releaseTaskPorts(item.id).catch(() => undefined);
        portAllocationFailed = true;
        console.error("[store] undo close port allocation failed:", e);
        toast.error(`${tt('toasts.agentStartFailed')}: ${e instanceof Error ? e.message : e}`);
      }
      await selectItem(item.id);
      bump();
      if (item.branch && !portAllocationFailed) {
        const worktreePath = `${repo.path}/.kanna-worktrees/${item.branch}`;
        try {
          const agentProvider = resolveAgentProvider(
            item.agent_provider,
            await getAgentProviderAvailability(),
          );
          await spawnPtySession(item.id, worktreePath, item.prompt || "", 80, 24, {
            agentProvider,
            portEnv,
            ...(item.agent_session_id ? { resumeSessionId: item.agent_session_id } : {}),
          });
          await updatePipelineItemActivity(_db, item.id, "working");
          bump();
        } catch (spawnErr) {
          await updatePipelineItemActivity(_db, item.id, "idle");
          bump();
          console.error("[store] session re-spawn after undo failed:", spawnErr);
          toast.error(`${tt('toasts.agentStartFailed')}: ${spawnErr instanceof Error ? spawnErr.message : spawnErr}`);
        }
      }
      selectedItemId.value = item.id;
      emitTaskSelected(item.id);
    } catch (e) {
      console.error("[store] undo close failed:", e);
      toast.error(tt('toasts.undoCloseFailed'));
    }
  }

  // ── Pipeline engine: advanceStage ─────────────────────────────────
  /** Advance a task to the next pipeline stage. Core pipeline engine function. */
  async function advanceStage(taskId: string): Promise<void> {
    const item = items.value.find(i => i.id === taskId);
    if (!item?.branch) return;

    const repo = repos.value.find(r => r.id === item.repo_id) ?? await getRepo(_db, item.repo_id);
    if (!repo) {
      console.error("[store] advanceStage: repo not found for", taskId);
      return;
    }

    // Load pipeline definition
    let pipeline: PipelineDefinition;
    try {
      pipeline = await loadPipeline(repo.path, item.pipeline);
    } catch (e) {
      console.error("[store] advanceStage: pipeline definition not found:", e);
      toast.error(tt('toasts.pipelineNotFound'));
      return;
    }

    // Find next stage
    const nextStage = getNextStage(pipeline, item.stage);
    if (!nextStage) {
      toast.warning(tt('toasts.taskAtFinalStage'));
      return;
    }

    // Check blockers
    if (await hasUnresolvedBlockers(taskId)) {
      toast.warning(tt('toasts.taskBlocked'));
      return;
    }

    // Build the next stage's prompt
    let stagePrompt = "";
    let agentOpts: Record<string, unknown> = { agentProvider: item.agent_provider };

    if (nextStage.agent) {
      try {
        const agent = await loadAgent(repo.path, nextStage.agent);
        const prevResult = item.stage_result ?? undefined;
        stagePrompt = buildStagePrompt(agent.prompt, nextStage.prompt, {
          taskPrompt: item.prompt ?? "",
          prevResult,
          branch: item.branch ?? undefined,
        });

        const preferredProviders = getPreferredAgentProviders({
          stage: nextStage.agent_provider as AgentProvider | AgentProvider[] | undefined,
          agent: agent.agent_provider as AgentProvider | AgentProvider[] | undefined,
          item: item.agent_provider,
        });
        const resolvedProvider = resolveAgentProvider(
          preferredProviders,
          await getAgentProviderAvailability(),
        );

        agentOpts = {
          agentProvider: resolvedProvider,
          model: agent.model,
          permissionMode: agent.permission_mode,
          allowedTools: agent.allowed_tools,
        };
      } catch (e) {
        console.error("[store] advanceStage: failed to load agent:", e);
        toast.error(`${tt('toasts.agentStartFailed')}: ${e instanceof Error ? e.message : e}`);
        return;
      }
    }

    // Close old task first (teardown, graceful SIGINT, mark done) — must
    // complete before createItem to avoid daemon command connection race.
    // selectNext: false because the new task will auto-select itself.
    await closeTask(item.id, { selectNext: false });

    // Create new task for the next stage
    await createItem(repo.id, repo.path, stagePrompt, "pty", {
      baseBranch: item.branch,
      pipelineName: item.pipeline,
      stage: nextStage.name,
      ...agentOpts,
    });
  }

  /** Re-run the current stage's setup + agent without advancing. Used after failure. */
  async function rerunStage(taskId: string): Promise<void> {
    const item = items.value.find(i => i.id === taskId);
    if (!item) return;

    const repo = repos.value.find(r => r.id === item.repo_id) ?? await getRepo(_db, item.repo_id);
    if (!repo) return;

    let pipeline: PipelineDefinition;
    try {
      pipeline = await loadPipeline(repo.path, item.pipeline);
    } catch (e) {
      console.error("[store] rerunStage: pipeline not found:", e);
      toast.error(tt('toasts.pipelineNotFound'));
      return;
    }

    const currentStage = pipeline.stages.find(s => s.name === item.stage);
    if (!currentStage) {
      console.error("[store] rerunStage: stage not found:", item.stage);
      toast.error(tt('toasts.stageNotFound'));
      return;
    }

    // Clear previous stage result
    await clearPipelineItemStageResult(_db, taskId);

    // Run setup
    if (currentStage.environment) {
      const env = pipeline.environments?.[currentStage.environment];
      if (env?.setup?.length) {
        const worktreePath = `${repo.path}/.kanna-worktrees/${item.branch}`;
        try {
          for (const script of env.setup) {
            await invoke("run_script", {
              script,
              cwd: worktreePath,
              env: applyWorktreeProcessIsolation({ KANNA_WORKTREE: "1" }),
            });
          }
        } catch (e) {
          console.error("[store] rerunStage: setup script failed:", e);
          toast.error(tt('toasts.stageSetupFailed'));
          return;
        }
      }
    }

    // Spawn agent
    if (currentStage.agent) {
      try {
        const agent = await loadAgent(repo.path, currentStage.agent);
        const stagePrompt = buildStagePrompt(agent.prompt, currentStage.prompt, {
          taskPrompt: item.prompt ?? "",
          branch: item.branch ?? undefined,
        });
        const worktreePath = `${repo.path}/.kanna-worktrees/${item.branch}`;
        const preferredProviders = getPreferredAgentProviders({
          stage: currentStage.agent_provider as AgentProvider | AgentProvider[] | undefined,
          agent: agent.agent_provider as AgentProvider | AgentProvider[] | undefined,
          item: item.agent_provider,
        });
        const agentProvider = resolveAgentProvider(
          preferredProviders,
          await getAgentProviderAvailability(),
        );

        await invoke("kill_session", { sessionId: taskId }).catch((e: unknown) =>
          console.error("[store] kill_session before rerun failed:", e));

        await spawnPtySession(taskId, worktreePath, stagePrompt, 80, 24, {
          agentProvider,
          model: agent.model,
          permissionMode: agent.permission_mode,
          allowedTools: agent.allowed_tools,
        });
      } catch (e) {
        console.error("[store] rerunStage: agent spawn failed:", e);
        toast.error(`${tt('toasts.agentStartFailed')}: ${e instanceof Error ? e.message : e}`);
      }
    }

    bump();
  }

  async function pinItem(itemId: string, position: number) {
    await pinPipelineItem(_db, itemId, position);
    bump();
  }

  async function unpinItem(itemId: string) {
    await unpinPipelineItem(_db, itemId);
    bump();
  }

  async function reorderPinned(repoId: string, orderedIds: string[]) {
    await reorderPinnedItems(_db, repoId, orderedIds);
    bump();
  }

  async function renameItem(itemId: string, displayName: string | null) {
    await updatePipelineItemDisplayName(_db, itemId, displayName);
    bump();
  }

  // ── Actions: Preferences ─────────────────────────────────────────
  async function loadPreferences() {
    const sa = await getSetting(_db, "suspendAfterMinutes");
    if (sa) suspendAfterMinutes.value = parseInt(sa, 10) || 30;
    const ka = await getSetting(_db, "killAfterMinutes");
    if (ka) killAfterMinutes.value = parseInt(ka, 10) || 60;
    const ide = await getSetting(_db, "ideCommand");
    if (ide) ideCommand.value = ide;
    const hs = await getSetting(_db, "hideShortcutsOnStartup");
    hideShortcutsOnStartup.value = hs === "true";
    const dl = await getSetting(_db, "dev.lingerTerminals");
    devLingerTerminals.value = dl === "true";
  }

  async function savePreference(key: string, value: string) {
    await setSetting(_db, key, value);
    await loadPreferences();
  }

  async function pushTaskToPeer(taskId: string, peerId: string): Promise<void> {
    const item = items.value.find((candidate) => candidate.id === taskId);
    if (!item) {
      throw new Error(`task not found: ${taskId}`);
    }

    const repo = repos.value.find((candidate) => candidate.id === item.repo_id);
    if (!repo) {
      throw new Error(`repo not found for task: ${taskId}`);
    }

    const preflightRaw = await invoke<unknown>("prepare_outgoing_transfer", {
      payload: {
        phase: "preflight",
        sourceTaskId: taskId,
        targetPeerId: peerId,
      },
    });
    const preflight = parseOutgoingTransferPreflightResult(preflightRaw);

    const recovery = await loadSessionRecoveryState(taskId);
    const repoRemoteUrl = preflight.targetHasRepo
      ? null
      : await invoke<string | null>("git_remote_url", {
          repoPath: repo.path,
        }).catch(() => null);
    let bundle: {
      artifactId: string;
      filename: string;
      refName: string | null;
    } | null = null;
    if (!preflight.targetHasRepo && !repoRemoteUrl) {
      const bundlePath = buildTransferBundlePath(preflight.transferId);
      const artifactId = buildTransferBundleArtifactId(preflight.transferId);
      const refName = normalizeTransferRefName(item.branch) ?? normalizeTransferRefName(item.base_ref);
      const refs = buildTransferBundleRefs(item);
      const bundleTargets = refs.length > 0 ? refs.map((ref) => shellQuote(ref)).join(" ") : "--all";

      await invoke("run_script", {
        script: `git bundle create ${shellQuote(bundlePath)} ${bundleTargets}`,
        cwd: repo.path,
        env: applyWorktreeProcessIsolation({ KANNA_WORKTREE: "1" }),
      });
      await invoke("stage_transfer_artifact", {
        transferId: preflight.transferId,
        artifactId,
        path: bundlePath,
      });
      bundle = {
        artifactId,
        filename: `${preflight.transferId}.bundle`,
        refName,
      };
    }
    const artifacts = await stageTransferredSessionArtifacts(preflight.transferId, item, repo.path);
    const payload = buildOutgoingTransferPayload({
      sourcePeerId: preflight.sourcePeerId,
      sourceTaskId: taskId,
      targetPeerId: peerId,
      item,
      repoPath: repo.path,
      repoName: repo.name,
      repoDefaultBranch: repo.default_branch,
      repoRemoteUrl,
      recovery,
      artifacts,
      targetHasRepo: preflight.targetHasRepo,
      bundle,
    });

    await insertTaskTransfer(_db, {
      id: preflight.transferId,
      direction: "outgoing",
      status: "pending",
      source_peer_id: preflight.sourcePeerId,
      target_peer_id: peerId,
      source_task_id: taskId,
      local_task_id: taskId,
      error: null,
      payload_json: JSON.stringify(payload),
    });

    await invoke("prepare_outgoing_transfer", {
      payload: {
        phase: "commit",
        transferId: preflight.transferId,
        payload,
      },
    });
  }

  async function recordIncomingTransfer(request: IncomingTransferRequest): Promise<void> {
    try {
      await insertTaskTransfer(_db, {
        id: request.transferId,
        direction: "incoming",
        status: "pending",
        source_peer_id: request.sourcePeerId,
        target_peer_id: null,
        source_task_id: request.sourceTaskId,
        local_task_id: null,
        error: null,
        payload_json: JSON.stringify(request.payload),
      });
    } catch (error) {
      if (!isDuplicateTaskTransferError(error)) {
        throw error;
      }
    }
    bump();
  }

  async function finalizeOutgoingTransfer(
    transferId: string,
  ): Promise<FinalizedOutgoingTransferResult> {
    const transfer = await getTaskTransfer(_db, transferId);
    if (!transfer) {
      throw new Error(`outgoing transfer not found: ${transferId}`);
    }
    if (transfer.direction !== "outgoing") {
      throw new Error(`transfer is not outgoing: ${transferId}`);
    }

    const existingPayload = parsePersistedOutgoingTransferPayload(transfer.payload_json);
    const localTaskId = transfer.local_task_id;
    if (!localTaskId) {
      throw new Error(`outgoing transfer has no local task: ${transferId}`);
    }

    const item = items.value.find((candidate) => candidate.id === localTaskId);
    if (!item) {
      throw new Error(`source task not found for outgoing transfer: ${transferId}`);
    }

    const repo = repos.value.find((candidate) => candidate.id === item.repo_id);
    if (!repo) {
      throw new Error(`repo not found for outgoing transfer: ${transferId}`);
    }

    let finalizedCleanly = item.agent_type !== "pty";
    if (item.agent_type === "pty") {
      await invoke("signal_session", { sessionId: item.id, signal: "SIGINT" }).catch((error: unknown) => {
        console.error("[store] transfer finalization signal failed:", error);
      });
      finalizedCleanly = await waitForSessionExitWithin(
        item.id,
        TRANSFER_SOURCE_FINALIZATION_WAIT_MS,
      );
    }

    const refreshedItems = await _db.select<PipelineItem>(
      "SELECT * FROM pipeline_item",
    );
    const refreshedItem = refreshedItems.find((candidate) => candidate.id === item.id) ?? item;

    const repoRemoteUrl = existingPayload.repo.mode === "reuse-local"
      ? null
      : await invoke<string | null>("git_remote_url", {
          repoPath: repo.path,
        }).catch(() => existingPayload.repo.remote_url);
    const bundle = existingPayload.repo.bundle
      ? {
          artifactId: existingPayload.repo.bundle.artifact_id,
          filename: existingPayload.repo.bundle.filename,
          refName: existingPayload.repo.bundle.ref_name,
        }
      : null;
    const sourcePeerId = transfer.source_peer_id ?? existingPayload.task.source_peer_id;
    const sourceTaskId = transfer.source_task_id ?? existingPayload.task.source_task_id;
    const artifacts = await stageTransferredSessionArtifacts(transferId, refreshedItem, repo.path);
    const payload = buildOutgoingTransferPayload({
      sourcePeerId,
      sourceTaskId,
      targetPeerId: transfer.target_peer_id ?? existingPayload.target_peer_id,
      item: refreshedItem,
      repoPath: repo.path,
      repoName: repo.name,
      repoDefaultBranch: repo.default_branch,
      repoRemoteUrl: repoRemoteUrl ?? null,
      recovery: await loadSessionRecoveryState(item.id),
      artifacts,
      targetHasRepo: existingPayload.repo.mode === "reuse-local",
      bundle,
    });

    await _db.execute(
      "UPDATE task_transfer SET payload_json = ?, error = NULL WHERE id = ?",
      [JSON.stringify(payload), transferId],
    );
    bump();

    return {
      transferId,
      payload,
      finalizedCleanly,
    };
  }

  async function approveIncomingTransfer(transferId: string): Promise<string> {
    const transfer = await getTaskTransfer(_db, transferId);
    if (!transfer) {
      throw new Error(`incoming transfer not found: ${transferId}`);
    }
    if (transfer.direction !== "incoming") {
      throw new Error(`transfer is not incoming: ${transferId}`);
    }
    if (transfer.status !== "pending") {
      throw new Error(`incoming transfer is not pending: ${transferId}`);
    }

    const finalized = parseFinalizedOutgoingTransferResult(await invoke("finalize_outgoing_transfer", {
      transferId,
    }));
    const payload = finalized.payload;
    const { repoId, repoPath } = await ensureIncomingTransferRepo(transferId, payload);
    const resumeSessionId = await importTransferredResumeState(transferId, payload, repoPath);
    const localTaskId = await createItem(
      repoId,
      repoPath,
      payload.task.prompt ?? "",
      payload.task.agent_type === "sdk" ? "sdk" : "pty",
      {
        agentProvider: payload.task.agent_provider,
        baseBranch: resolveIncomingTransferBaseBranch(payload),
        pipelineName: payload.task.pipeline,
        stage: payload.task.stage,
        displayName: payload.task.display_name,
        resumeSessionId,
        recoverySnapshot: payload.recovery,
      },
    );

    await markTaskTransferCompleted(_db, transferId, localTaskId);
    await insertTaskTransferProvenance(_db, {
      pipeline_item_id: localTaskId,
      source_peer_id: payload.task.source_peer_id,
      source_task_id: payload.task.source_task_id,
      source_machine_task_label: payload.task.branch,
    });

    await invoke("acknowledge_incoming_transfer_commit", {
      transferId,
      sourceTaskId: payload.task.source_task_id,
      destinationLocalTaskId: localTaskId,
    }).catch((error: unknown) => {
      console.error("[store] failed to acknowledge incoming transfer commit:", error);
    });
    bump();

    return localTaskId;
  }

  async function rejectIncomingTransfer(transferId: string): Promise<void> {
    const transfer = await getTaskTransfer(_db, transferId);
    if (!transfer) {
      throw new Error(`incoming transfer not found: ${transferId}`);
    }
    if (transfer.direction !== "incoming") {
      throw new Error(`transfer is not incoming: ${transferId}`);
    }
    if (transfer.status !== "pending") {
      throw new Error(`incoming transfer is not pending: ${transferId}`);
    }

    await markTaskTransferRejected(_db, transferId, "Rejected locally");
    bump();
  }

  async function handleOutgoingTransferCommitted(
    event: OutgoingTransferCommittedEvent,
  ): Promise<void> {
    const transfer = await getTaskTransfer(_db, event.transferId);
    if (!transfer || transfer.direction !== "outgoing") {
      return;
    }
    if (transfer.status === "completed") {
      return;
    }
    if (transfer.source_task_id !== event.sourceTaskId) {
      throw new Error(
        `outgoing transfer source task mismatch for ${event.transferId}: expected ${transfer.source_task_id}, got ${event.sourceTaskId}`,
      );
    }

    await markTaskTransferCompleted(
      _db,
      event.transferId,
      transfer.local_task_id ?? event.sourceTaskId,
    );
    await closeTask(event.sourceTaskId);
    bump();
  }

  // ── Actions: Stage advance (keyboard shortcut, replaces makePR) ──
  async function makePR() {
    const item = currentItem.value;
    if (!item) return;
    try {
      await advanceStage(item.id);
    } catch (e) {
      console.error("[store] stage advance failed:", e);
      toast.error(tt('toasts.prAgentFailed'));
    }
  }

  async function mergeQueue() {
    if (!selectedRepoId.value) {
      if (repos.value.length === 1) {
        selectedRepoId.value = repos.value[0].id;
      } else {
        toast.warning(tt('toasts.selectRepoFirst'));
        return;
      }
    }
    const repo = repos.value.find((r) => r.id === selectedRepoId.value);
    if (!repo) return;
    try {
      // Load merge agent from pipeline definitions
      const agent = await loadAgent(repo.path, "merge");
      await createItem(repo.id, repo.path, agent.prompt, "pty");
    } catch (e) {
      console.error("[store] merge agent failed to start:", e);
      toast.error(tt('toasts.mergeAgentFailed'));
    }
  }

  // ── Event handlers ───────────────────────────────────────────────
  function _handleAgentFinished(sessionId: string) {
    const item = items.value.find((i) => i.id === sessionId);
    if (!item) return;
    const activity = selectedItemId.value === sessionId ? "idle" : "unread";
    updatePipelineItemActivity(_db, item.id, activity).catch((e) =>
      console.error("[store] activity update failed:", e)
    );
    bump();
  }

  async function checkUnblocked(blockerItemId: string) {
    const blockedItems = await listBlockedByItem(_db, blockerItemId);
    for (const blocked of blockedItems) {
      // A task is "blocked" if it has entries in task_blocker.
      // Check if all its blockers have been closed.
      if (blocked.closed_at !== null) continue; // already closed
      const blockers = await listBlockersForItem(_db, blocked.id);
      if (blockers.length === 0) continue;
      const allClear = blockers.every(b => b.closed_at !== null);
      if (allClear) {
        await startBlockedTask(blocked);
      }
    }
  }

  async function startBlockedTask(item: PipelineItem) {
    // repos.value may be empty during init() (computedAsync hasn't fired yet),
    // so fall back to a direct DB query.
    const repo = repos.value.find((r) => r.id === item.repo_id) ?? await getRepo(_db, item.repo_id);
    if (!repo) {
      console.error("[store] startBlockedTask: repo not found for", item.id);
      return;
    }

    const blockers = await listBlockersForItem(_db, item.id);
    const blockerContext = blockers
      .map((b) => {
        const name = b.display_name || (b.prompt ? b.prompt.slice(0, 60) : "Untitled");
        return `- ${name} (branch: ${b.branch || "unknown"})`;
      })
      .join("\n");

    const augmentedPrompt = [
      "Note: this task was previously blocked by the following tasks which have now completed:",
      blockerContext,
      "Their changes may be on branches that haven't merged to main yet.",
      "",
      "Original task:",
      item.prompt || "",
    ].join("\n");

    const id = item.id;
    const branch = `task-${id}`;
    const worktreePath = `${repo.path}/.kanna-worktrees/${branch}`;

    const worktreeExists = await invoke<boolean>("file_exists", { path: worktreePath });
    let resolvedBaseRef: string | null = null;
    if (!worktreeExists) {
      // Fetch origin so the worktree starts from the latest remote state
      let startPoint: string | null = null;
      try {
        const defaultBranch = await invoke<string>("git_default_branch", { repoPath: repo.path });
        await invoke("git_fetch", { repoPath: repo.path, branch: defaultBranch });
        startPoint = `origin/${defaultBranch}`;
        resolvedBaseRef = startPoint;
      } catch (e) {
        console.debug("[store] fetch origin failed (offline?), using local HEAD:", e);
        // Try to at least get the default branch name for base_ref
        try {
          const defaultBranch = await invoke<string>("git_default_branch", { repoPath: repo.path });
          resolvedBaseRef = defaultBranch;
        } catch {
          // leave resolvedBaseRef as null
        }
      }

      try {
        await invoke("git_worktree_add", {
          repoPath: repo.path,
          branch,
          path: worktreePath,
          startPoint,
        });
      } catch (e) {
        console.error("[store] startBlockedTask worktree_add failed:", e);
        toast.error(tt('toasts.blockedWorktreeFailed'));
        return;
      }
    }

    let repoConfig: RepoConfig = {};
    try {
      repoConfig = await readRepoConfig(worktreePath);
    } catch (e) {
      console.debug("[store] no .kanna/config.json:", e);
    }

    let agentProvider: AgentProvider;
    let portEnv: Record<string, string> = {};
    try {
      agentProvider = resolveAgentProvider(
        item.agent_provider,
        await getAgentProviderAvailability(),
      );
    } catch (e) {
      console.error("[store] startBlockedTask: agent provider resolution failed:", e);
      toast.error(`${tt('toasts.agentStartFailed')}: ${e instanceof Error ? e.message : e}`);
      return;
    }

    try {
      await withPortAllocationLock(async () => {
        try {
          const allocated = await claimTaskPorts(id, repoConfig);
          portEnv = allocated.portEnv;
          const portOffset = allocated.firstPort;

          await _db.execute(
            `UPDATE pipeline_item
             SET branch = ?, port_offset = ?, port_env = ?, base_ref = ?,
                 tags = '[]', activity = 'working',
                 activity_changed_at = datetime('now'), updated_at = datetime('now')
             WHERE id = ?`,
            [branch, portOffset, Object.keys(portEnv).length > 0 ? JSON.stringify(portEnv) : null, resolvedBaseRef, id],
          );
          bump();
        } catch (e) {
          await deleteTaskPortsForItem(_db, id).catch(() => undefined);
          throw e;
        }
      });

      await spawnPtySession(id, worktreePath, augmentedPrompt, 80, 24, {
        agentProvider,
        portEnv,
        setupCmds: repoConfig.setup || [],
      });
    } catch (e) {
      await updatePipelineItemActivity(_db, id, "idle");
      bump();
      console.error("[store] startBlockedTask PTY spawn failed:", e);
      toast.error(`${tt('toasts.agentStartFailed')}: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function blockTask(blockerIds: string[]) {
    const item = currentItem.value;
    const repo = selectedRepo.value;
    if (!item || !repo || isItemHidden(item) || hasTag(item, "blocked")) return;

    const originalPrompt = item.prompt;
    const originalRepoId = item.repo_id;
    const originalAgentType = item.agent_type;
    const originalAgentProvider = item.agent_provider;
    const originalDisplayName = item.display_name;
    const originalId = item.id;

    const newId = generateId();
    await insertPipelineItem(_db, {
      id: newId,
      repo_id: originalRepoId,
      issue_number: null,
      issue_title: null,
      prompt: originalPrompt,
      pipeline: item.pipeline,
      stage: item.stage,
      tags: ["blocked"],
      pr_number: null,
      pr_url: null,
      branch: null,
      agent_type: originalAgentType,
      agent_provider: originalAgentProvider ?? null,
      port_offset: null,
      port_env: null,
      activity: "idle",
      base_ref: null,
    });

    if (originalDisplayName) {
      await updatePipelineItemDisplayName(_db, newId, originalDisplayName);
    }

    for (const blockerId of blockerIds) {
      await insertTaskBlocker(_db, newId, blockerId);
    }

    const now = new Date().toISOString();
    const blockedReplacement: PipelineItem = {
      ...item,
      id: newId,
      issue_number: null,
      issue_title: null,
      stage_result: null,
      tags: JSON.stringify(["blocked"]),
      pr_number: null,
      pr_url: null,
      branch: null,
      agent_session_id: null,
      port_offset: null,
      port_env: null,
      activity: "idle",
      activity_changed_at: now,
      unread_at: null,
      closed_at: null,
      base_ref: null,
      previous_stage: null,
      pinned: 0,
      pin_order: null,
      created_at: now,
      updated_at: now,
    };

    items.value = items.value
      .filter((candidate) => candidate.id !== originalId)
      .concat(blockedReplacement);
    await selectItem(newId);

    // Transfer: any task that was blocked by the original now depends on
    // the new blocked replacement instead. Without this, blocking B when
    // A' depends on B would leave A' pointing at the dead original B.
    const dependents = await listBlockedByItem(_db, originalId);
    for (const dep of dependents) {
      await removeTaskBlocker(_db, dep.id, originalId);
      await insertTaskBlocker(_db, dep.id, newId);
    }

    try {
      await invoke("kill_session", { sessionId: originalId }).catch((e: unknown) =>
        console.error("[store] kill_session failed:", e)
      );
      await invoke("kill_session", { sessionId: `shell-wt-${originalId}` }).catch((e: unknown) =>
        console.error("[store] kill shell session failed:", e)
      );

      const worktreePath = `${repo.path}/.kanna-worktrees/${item.branch}`;
      try {
        const teardownCmds = await collectTeardownCommands(item, repo);
        for (const cmd of teardownCmds) {
          await invoke("run_script", {
            script: cmd,
            cwd: worktreePath,
            env: applyWorktreeProcessIsolation({ KANNA_WORKTREE: "1" }),
          });
        }
      } catch (e) {
        console.error("[store] teardown failed:", e);
      }

      await invoke("git_worktree_remove", { repoPath: repo.path, path: worktreePath }).catch((e: unknown) =>
        console.error("[store] worktree remove failed:", e)
      );

      await closePipelineItemAndClearCachedTerminalState(originalId, (id) => closePipelineItem(_db, id));
      // The original task being closed may unblock other tasks that
      // were waiting on it. We must check — suppressing this causes deadlocks
      // when two tasks block each other (A blocked by B, then B blocked by A').
      await checkUnblocked(originalId);
    } catch (e) {
      console.error("[store] blockTask close failed:", e);
      toast.error(tt('toasts.blockTaskFailed'));
      bump();
    }

    bump();
  }

  async function editBlockedTask(itemId: string, newBlockerIds: string[]) {
    const item = items.value.find((i) => i.id === itemId);
    if (!item || !hasTag(item, "blocked")) return;

    if (newBlockerIds.length > 0) {
      const hasCycle = await hasCircularDependency(_db, itemId, newBlockerIds);
      if (hasCycle) {
        throw new Error("Cannot add blocker — it would create a circular dependency");
      }
    }

    const currentBlockers = await listBlockersForItem(_db, itemId);
    const currentIds = new Set(currentBlockers.map((b) => b.id));
    const newIds = new Set(newBlockerIds);

    for (const id of currentIds) {
      if (!newIds.has(id)) {
        await removeTaskBlocker(_db, itemId, id);
      }
    }

    for (const id of newIds) {
      if (!currentIds.has(id)) {
        await insertTaskBlocker(_db, itemId, id);
      }
    }

    bump();

    const updatedBlockers = await listBlockersForItem(_db, itemId);
    const allClear = updatedBlockers.length === 0 || updatedBlockers.every(
      b => b.closed_at !== null
    );
    if (allClear) {
      await startBlockedTask(item);
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────
  async function init(db: DbHandle) {
    _db = db;

    await loadPreferences();

    // Transition stale "working" items to "unread"
    const workingItems = await _db.select<PipelineItem>(
      "SELECT * FROM pipeline_item WHERE activity = 'working'"
    );
    for (const item of workingItems) {
      await updatePipelineItemActivity(_db, item.id, "unread");
    }

    // Eager load repos + items for selection restore
    // (computedAsync hasn't fired yet — repos.value is still [])
    const eagerRepos = await listRepos(_db);
    const eagerItems: PipelineItem[] = [];
    for (const repo of eagerRepos) {
      eagerItems.push(...await listPipelineItems(_db, repo.id));
    }

    // Close tasks whose worktrees no longer exist on disk (orphaned by manual
    // cleanup, hide/re-import, or other out-of-band deletion).
    if (isTauri) {
      for (const item of eagerItems) {
        if (!item.branch || item.stage === "done") continue;
        const repo = eagerRepos.find(r => r.id === item.repo_id);
        if (!repo) continue;
        const wtPath = `${repo.path}/.kanna-worktrees/${item.branch}`;
        const exists = await invoke<boolean>("file_exists", { path: wtPath });
        if (!exists) {
          console.warn(`[store] closing orphaned task ${item.id}: worktree missing at ${wtPath}`);
          await closeTaskAndReleasePorts(item.id, (id) => closePipelineItem(_db, id));
          item.stage = "done";
        }
      }
    }

    // Check for blocked tasks that can now start
    const unblockedItems = await getUnblockedItems(_db);
    for (const item of unblockedItems) {
      console.debug(`[store] auto-starting previously blocked task: ${item.id}`);
      await startBlockedTask(item);
    }

    // Trigger reactive data load
    bump();

    // Restore persisted selection (use eager data since computedAsync is still resolving)
    const savedRepo = await getSetting(_db, "selected_repo_id");
    const savedItem = await getSetting(_db, "selected_item_id");
    if (savedRepo && eagerRepos.some((r) => r.id === savedRepo)) {
      selectedRepoId.value = savedRepo;
      if (savedItem && eagerItems.some((i) => i.id === savedItem && i.stage !== "done")) {
        restoreSelection(savedItem);
      }
    } else if (eagerRepos.length === 1) {
      selectedRepoId.value = eagerRepos[0].id;
    }

    // Set window title for non-main branches
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
      } catch (e) { console.error("[store] failed to set window title:", e); }
    }

    // Pre-warm shell sessions so ⌘J / ⇧⌘J are instant
    if (isTauri) {
      for (const item of eagerItems) {
        if (!item.branch) continue;
        if (item.stage === "done") continue;
        const repo = eagerRepos.find(r => r.id === item.repo_id);
        if (!repo) continue;
        const wtPath = `${repo.path}/.kanna-worktrees/${item.branch}`;
        prewarmWorktreeShellSession(`shell-wt-${item.id}`, wtPath, item.port_env, repo.path)
          .catch(e => reportPrewarmSessionError("[store] shell pre-warm failed:", e));
      }
      for (const repo of eagerRepos) {
        spawnShellSession(`shell-repo-${repo.id}`, repo.path, null, false)
          .catch(e => reportPrewarmSessionError("[store] repo shell pre-warm failed:", e));
      }
    }

    // Event listeners
    listen("status_changed", async (event: any) => {
      const payload = event.payload || event;
      const sessionId = payload.session_id;
      const status = payload.status;
      if (!sessionId) return;

      const item = items.value.find((i) => i.id === sessionId);
      if (!item) return;
      if (typeof status !== "string") return;
      await applyTaskRuntimeStatus(item, status);
    });

    listen("session_exit", async (event: any) => {
      const payload = event.payload || event;
      const sessionId = payload.session_id;
      if (!sessionId) return;

      const waiters = sessionExitWaiters.get(sessionId);
      if (waiters) {
        sessionExitWaiters.delete(sessionId);
        for (const resolve of waiters) resolve();
      }

      await persistExitedSessionResumeId(sessionId, payload.resume_session_id);

      // Successful teardown exits finish the task unless lingering is enabled.
      if (typeof sessionId === "string" && isTeardownSessionId(sessionId)) {
        const itemId = getTaskIdFromTeardownSessionId(sessionId);
        const exitCode = typeof payload.code === "number" ? payload.code : null;
        if (!itemId || !shouldAutoCloseTaskAfterTeardownExit({
          exitCode,
          lingerEnabled: devLingerTerminals.value,
        })) {
          return;
        }

        const item = items.value.find((i) => i.id === itemId);
        if (!item || !isTeardownStage(item.stage)) {
          return;
        }

        await Promise.all([
          invoke("kill_session", { sessionId: item.id }).catch((e: unknown) =>
            reportCloseSessionError("[store] kill agent session failed:", e)),
          invoke("kill_session", { sessionId: `shell-wt-${item.id}` }).catch((e: unknown) =>
            reportCloseSessionError("[store] kill shell session failed:", e)),
        ]);
        await closeTaskAndReleasePorts(item.id, (id) => closePipelineItem(_db, id));
        await checkUnblocked(item.id);
        bump();
        return;
      }

      if (shouldClearCachedTerminalStateOnSessionExit(sessionId)) {
        clearCachedTerminalState(sessionId);
      }
      _handleAgentFinished(sessionId);
    });

    listen("terminal_output", (event: any) => {
      const payload = event.payload || event;
      const sessionId = payload.session_id;
      if (typeof sessionId !== "string") return;
      scheduleRuntimeStatusSync(sessionId);
    });

    listen("daemon_ready", async () => {
      await syncTaskStatusesFromDaemon();
    });

    // Pipeline stage-complete signal from kanna-cli via app socket
    listen("pipeline_stage_complete", async (event: unknown) => {
      const payload = (event as { payload: { task_id: string } }).payload;
      const taskId = payload?.task_id;
      if (!taskId) return;

      const item = items.value.find(i => i.id === taskId);
      if (!item) return;

      // Reload item from DB to get fresh stage_result
      bump();

      // Wait a tick for computedAsync to refresh
      await new Promise(resolve => setTimeout(resolve, 100));

      const freshItem = items.value.find(i => i.id === taskId);
      if (!freshItem) return;

      // Load pipeline to check transition type
      const repo = repos.value.find(r => r.id === freshItem.repo_id);
      if (!repo) return;

      try {
        const pipeline = await loadPipeline(repo.path, freshItem.pipeline);
        const stage = pipeline.stages.find(s => s.name === freshItem.stage);
        if (!stage) return;

        if (stage.transition === "auto") {
          // Parse stage_result to check if agent signaled success
          if (freshItem.stage_result) {
            try {
              const result = JSON.parse(freshItem.stage_result) as StageCompleteResult;
              if (result.status === "success") {
                await advanceStage(taskId);
              }
            } catch (e) {
              console.error("[store] failed to parse stage_result:", e);
            }
          }
        }

        // For manual transition or failure: mark activity as unread so user notices
        if (selectedItemId.value !== taskId) {
          await updatePipelineItemActivity(_db, taskId, "unread");
          bump();
        }
      } catch (e) {
        console.error("[store] pipeline_stage_complete handler failed:", e);
      }
    });
  }

  return {
    // State
    repos, items, selectedRepoId, selectedItemId, lastSelectedItemByRepo,
    canGoBack, canGoForward,
    suspendAfterMinutes, killAfterMinutes,
    ideCommand, hideShortcutsOnStartup, devLingerTerminals,
    lastHiddenRepoId, refreshKey,
    // Getters
    selectedRepo, currentItem, sortedItemsForCurrentRepo, sortedItemsAllRepos, getStageOrder,
    // Actions
    bump, init,
    selectRepo, selectItem, goBack, goForward,
    importRepo, createRepo, cloneAndImportRepo, hideRepo,
    createItem, spawnPtySession, spawnShellSession, closeTask, undoClose,
    advanceStage, rerunStage,
    loadPipeline, loadAgent,
    makePR, mergeQueue,
    pushTaskToPeer, recordIncomingTransfer, approveIncomingTransfer, rejectIncomingTransfer,
    finalizeOutgoingTransfer, handleOutgoingTransferCommitted,
    blockTask, editBlockedTask,
    listBlockersForItem: (itemId: string) => listBlockersForItem(_db, itemId),
    listBlockedByItem: (itemId: string) => listBlockedByItem(_db, itemId),
    pinItem, unpinItem, reorderPinned, renameItem,
    savePreference,
  };
});
