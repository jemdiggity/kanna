import { nextTick, ref, watch, type ComputedRef, type Ref } from "vue";
import { computedAsync } from "@vueuse/core";
import { parseRepoConfig, type RepoConfig } from "@kanna/core";
import type { AgentProvider, DbHandle, PipelineItem, Repo } from "@kanna/db";
import type { PipelineDefinition, AgentDefinition } from "../../../../packages/core/src/pipeline/pipeline-types";
import { listPipelineItems, listRepos } from "@kanna/db";
import { invoke } from "../invoke";
import i18n from "../i18n";
import { useToast } from "../composables/useToast";

/** Generate an 8-char hex ID (32 bits of randomness). */
export function generateId(): string {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export function hasTag(item: { tags: string }, tag: string): boolean {
  return parseTags(item.tags).includes(tag);
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

export interface PreparedPtySession {
  env: Record<string, string>;
  setupCmds: string[];
  agentCmd: string;
  kannaCliPath?: string;
}

export interface WorktreeBootstrapResult {
  visibleBootstrapSteps: string[];
}

export interface CreateItemOptions {
  baseBranch?: string;
  tags?: string[];
  pipelineName?: string;
  stage?: string;
  customTask?: import("@kanna/core").CustomTaskConfig;
  agentProvider?: AgentProvider;
  model?: string;
  permissionMode?: string;
  allowedTools?: string[];
}

export interface StoreState {
  db: Ref<DbHandle | null>;
  refreshKey: Ref<number>;
  repos: Ref<Repo[]>;
  items: Ref<PipelineItem[]>;
  selectedRepoId: Ref<string | null>;
  selectedItemId: Ref<string | null>;
  lastSelectedItemByRepo: Ref<Record<string, string>>;
  suspendAfterMinutes: Ref<number>;
  killAfterMinutes: Ref<number>;
  ideCommand: Ref<string>;
  hideShortcutsOnStartup: Ref<boolean>;
  devLingerTerminals: Ref<boolean>;
  lastHiddenRepoId: Ref<string | null>;
  pendingSetupIds: Ref<string[]>;
  pipelineCache: Map<string, PipelineDefinition>;
  agentCache: Map<string, AgentDefinition>;
  stageOrderCache: Map<string, string[]>;
  pendingCreateVisibility: Map<string, { bumpAt: number }>;
  runtimeStatusSyncTimer: Ref<ReturnType<typeof setTimeout> | null>;
  refreshRunId: Ref<number>;
}

export interface StoreServices {
  selectedRepo?: ComputedRef<Repo | null>;
  currentItem?: ComputedRef<PipelineItem | null>;
  sortedItemsForCurrentRepo?: ComputedRef<PipelineItem[]>;
  sortedItemsAllRepos?: ComputedRef<PipelineItem[]>;
  isItemHidden?: (item: PipelineItem) => boolean;
  getStageOrder?: (repoId: string) => readonly string[];
  selectRepo?: (repoId: string) => Promise<void>;
  selectItem?: (itemId: string) => Promise<void>;
  restoreSelection?: (itemId: string) => void;
  goBack?: () => void;
  goForward?: () => void;
  loadPipeline?: (repoPath: string, pipelineName: string) => Promise<PipelineDefinition>;
  loadAgent?: (repoPath: string, agentName: string) => Promise<AgentDefinition>;
  advanceStage?: (taskId: string) => Promise<void>;
  rerunStage?: (taskId: string) => Promise<void>;
  spawnShellSession?: (
    sessionId: string,
    cwd: string,
    portEnv?: string | null,
    isWorktree?: boolean,
    fallbackCwd?: string | null,
  ) => Promise<void>;
  prewarmWorktreeShellSession?: (
    sessionId: string,
    worktreePath: string,
    portEnv?: string | null,
    fallbackCwd?: string | null,
  ) => Promise<void>;
  preparePtySession?: (
    sessionId: string,
    prompt: string,
    options?: PtySpawnOptions,
  ) => Promise<PreparedPtySession>;
  spawnPtySession?: (
    sessionId: string,
    cwd: string,
    prompt: string,
    cols?: number,
    rows?: number,
    options?: PtySpawnOptions,
  ) => Promise<void>;
  syncTaskStatusesFromDaemon?: () => Promise<void>;
  scheduleRuntimeStatusSync?: (sessionId: string) => void;
  applyTaskRuntimeStatus?: (item: PipelineItem, status: string) => Promise<void>;
  waitForSessionExit?: (sessionId: string) => Promise<void>;
  resolveSessionExitWaiters?: (sessionId: string) => void;
  getAgentProviderAvailability?: () => Promise<import("./agent-provider").AgentProviderAvailability>;
  createItem?: (
    repoId: string,
    repoPath: string,
    prompt: string,
    agentType?: "pty" | "sdk",
    opts?: CreateItemOptions,
  ) => Promise<void>;
  closeTask?: (targetItemId?: string, opts?: { selectNext?: boolean }) => Promise<void>;
  undoClose?: () => Promise<void>;
  checkUnblocked?: (blockerItemId: string) => Promise<void>;
  startBlockedTask?: (item: PipelineItem) => Promise<void>;
  blockTask?: (blockerIds: string[]) => Promise<void>;
  editBlockedTask?: (itemId: string, newBlockerIds: string[]) => Promise<void>;
}

export interface StoreContext {
  state: StoreState;
  services: StoreServices;
  toast: ReturnType<typeof useToast>;
  bump: () => void;
  requireDb: () => DbHandle;
  tt: (key: string) => string;
}

export function requireService<T>(
  service: T | undefined,
  name: string,
): T {
  if (service == null) {
    throw new Error(`Store service "${name}" is not registered`);
  }
  return service;
}

export async function readRepoConfig(basePath: string): Promise<RepoConfig> {
  try {
    const content = await invoke<string>("read_text_file", {
      path: `${basePath}/.kanna/config.json`,
    });
    return content ? parseRepoConfig(content) : {};
  } catch (error) {
    console.debug("[store] no .kanna/config.json:", error);
    return {};
  }
}

export function createStoreState(): StoreState {
  const db = ref<DbHandle | null>(null);
  const refreshKey = ref(0);
  const selectedRepoId = ref<string | null>(null);
  const selectedItemId = ref<string | null>(null);
  const lastSelectedItemByRepo = ref<Record<string, string>>({});
  const suspendAfterMinutes = ref(30);
  const killAfterMinutes = ref(60);
  const ideCommand = ref("code");
  const hideShortcutsOnStartup = ref(false);
  const devLingerTerminals = ref(false);
  const lastHiddenRepoId = ref<string | null>(null);
  const pendingSetupIds = ref<string[]>([]);
  const pendingCreateVisibility = new Map<string, { bumpAt: number }>();
  const pipelineCache = new Map<string, PipelineDefinition>();
  const agentCache = new Map<string, AgentDefinition>();
  const stageOrderCache = new Map<string, string[]>();
  const runtimeStatusSyncTimer = ref<ReturnType<typeof setTimeout> | null>(null);
  const refreshRunId = ref(0);

  const repos = computedAsync<Repo[]>(async () => {
    refreshKey.value;
    if (!db.value) return [];
    return listRepos(db.value);
  }, []);

  const items = computedAsync<PipelineItem[]>(async () => {
    refreshKey.value;
    if (!db.value || repos.value.length === 0) return [];

    const runId = ++refreshRunId.value;
    const refreshStart = performance.now();
    console.log(`[perf:items] refresh start #${runId}: repos=${repos.value.length}`);

    const loaded: PipelineItem[] = [];
    for (const repo of repos.value) {
      const repoStart = performance.now();
      loaded.push(...await listPipelineItems(db.value, repo.id));
      console.log(`[perf:items] refresh repo #${runId} ${repo.id}: ${(performance.now() - repoStart).toFixed(1)}ms`);
      if (!stageOrderCache.has(repo.path)) {
        try {
          const config = await readRepoConfig(repo.path);
          if (config.stage_order) {
            stageOrderCache.set(repo.path, config.stage_order);
          }
        } catch {
          // ignore missing config
        }
      }
    }

    console.log(
      `[perf:items] refresh done #${runId}: ${(performance.now() - refreshStart).toFixed(1)}ms total, items=${loaded.length}`,
    );

    for (const item of loaded) {
      const pending = pendingCreateVisibility.get(item.id);
      if (!pending) continue;
      console.log(
        `[perf:createItem] items refresh -> visible: ${(performance.now() - pending.bumpAt).toFixed(1)}ms (id=${item.id})`,
      );
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
      console.log(
        `[perf:createItem] nextTick after visible: ${(performance.now() - pending.bumpAt).toFixed(1)}ms (id=${id})`,
      );
    }
  });

  return {
    db,
    refreshKey,
    repos,
    items,
    selectedRepoId,
    selectedItemId,
    lastSelectedItemByRepo,
    suspendAfterMinutes,
    killAfterMinutes,
    ideCommand,
    hideShortcutsOnStartup,
    devLingerTerminals,
    lastHiddenRepoId,
    pendingSetupIds,
    pipelineCache,
    agentCache,
    stageOrderCache,
    pendingCreateVisibility,
    runtimeStatusSyncTimer,
    refreshRunId,
  };
}

export function createStoreContext(
  state: StoreState,
  toast: ReturnType<typeof useToast>,
  services: StoreServices,
): StoreContext {
  return {
    state,
    services,
    toast,
    bump: () => {
      state.refreshKey.value += 1;
    },
    requireDb: () => {
      if (!state.db.value) {
        throw new Error("Kanna store has not been initialized");
      }
      return state.db.value;
    },
    tt: (key: string) => i18n.global.t(key),
  };
}
