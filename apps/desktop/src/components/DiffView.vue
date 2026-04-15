<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useLessScroll } from "../composables/useLessScroll";
import { invoke } from "../invoke";
import { registerContextShortcuts } from "../composables/useShortcutContext";
import { FileDiff, parsePatchFiles, setLanguageOverride } from "@pierre/diffs";
import {
  getSyntaxLanguageForPath,
  isBazelSyntaxPath,
} from "../utils/syntaxLanguage";
import { normalizeGitPatchForDiffParser } from "../utils/normalizeGitPatch";
import {
  getOrCreateWorkerPoolSingleton,
  type WorkerPoolManager,
} from "@pierre/diffs/worker";

const { t } = useI18n();

registerContextShortcuts("diff", [
  { label: t('diffView.shortcutScopeNext'), display: "⇧⌘]" },
  { label: t('diffView.shortcutScopePrev'), display: "⇧⌘[" },
  { label: t('diffView.shortcutCycleFilter'), display: "s" },
  { label: t('diffView.shortcutLineUpDown'), display: "j / k" },
  { label: t('diffView.shortcutPageUpDown'), display: "f / b" },
  { label: t('diffView.shortcutHalfUpDown'), display: "d / u" },
  { label: t('diffView.shortcutTopBottom'), display: "g / G" },
  { label: t('diffView.shortcutClose'), display: "q" },
]);

type WorkingFilter = "all" | "unstaged" | "staged";
type DiffScope = "branch" | "working";
type DiffScrollPositions = Partial<Record<DiffScope, number>>;
const workingFilterOrder: WorkingFilter[] = ["all", "unstaged", "staged"];

const props = defineProps<{
  repoPath: string;
  worktreePath?: string;
  initialScope?: DiffScope;
  initialScrollPositions?: DiffScrollPositions;
  baseRef?: string;
  viewKey?: string;
}>();

const emit = defineEmits<{
  (e: "scope-change", scope: DiffScope): void;
  (e: "scroll-state-change", positions: DiffScrollPositions): void;
  (e: "close"): void;
}>();

const containerRef = ref<HTMLElement | null>(null);
const diffContent = ref("");
const loading = ref(false);
const error = ref<string | null>(null);
const noDiff = ref(false);
const workingFilter = ref<WorkingFilter>("all");
const scope = ref<DiffScope>(props.initialScope === "branch" ? "branch" : "working");
const scrollPositions = ref<DiffScrollPositions>(cloneScrollPositions(props.initialScrollPositions));

const workingFilterLabel = computed(() => {
  const labels: Record<WorkingFilter, string> = {
    all: t('diffView.filterAll'),
    unstaged: t('diffView.filterUnstaged'),
    staged: t('diffView.filterStaged'),
  };
  return labels[workingFilter.value];
});
let fileDiffInstance: FileDiff | null = null;
let workerPool: WorkerPoolManager | null = null;

interface DiffFilePathMetadata {
  newName?: string;
  oldName?: string;
  fileName?: string;
}

interface DiffWorkerPoolStats {
  managerState?: string;
  totalWorkers?: number;
  workersFailed?: boolean;
  busyWorkers?: number;
  queuedTasks?: number;
  pendingTasks?: number;
  diffCacheSize?: number;
}

interface DiffWorkerPoolInspector {
  getStats?: () => DiffWorkerPoolStats;
  isInitialized?: () => boolean;
}

interface DiffRenderContext {
  loadId: number;
  loadStartedAt: number;
}

let nextDiffLoadId = 0;

function roundDuration(durationMs: number): number {
  return Math.round(durationMs * 10) / 10;
}

function getWorkerPoolStatsSnapshot(pool: WorkerPoolManager | null): DiffWorkerPoolStats | null {
  if (pool == null) return null;
  const inspector = pool as WorkerPoolManager & DiffWorkerPoolInspector;
  if (typeof inspector.getStats !== "function") return null;
  return inspector.getStats();
}

function logDiffPerf(
  loadId: number,
  stage: string,
  details: Record<string, unknown>,
) {
  console.warn(`[DiffView][perf] load#${loadId} ${stage}`, details);
}

function cloneScrollPositions(positions?: DiffScrollPositions): DiffScrollPositions {
  return positions ? { ...positions } : {};
}

function emitScrollStateChange() {
  emit("scroll-state-change", { ...scrollPositions.value });
}

function updateScrollPosition(scopeName: DiffScope, top: number) {
  if (scrollPositions.value[scopeName] === top) return;
  scrollPositions.value = {
    ...scrollPositions.value,
    [scopeName]: top,
  };
  emitScrollStateChange();
}

function saveCurrentScrollPosition() {
  if (!containerRef.value) return;
  updateScrollPosition(scope.value, containerRef.value.scrollTop);
}

function restoreScrollPosition() {
  if (!containerRef.value) return;
  const top = scrollPositions.value[scope.value] ?? 0;
  containerRef.value.scrollTo({ top, behavior: "auto" });
}

function syncViewStateFromProps() {
  scope.value = props.initialScope === "branch" ? "branch" : "working";
  scrollPositions.value = cloneScrollPositions(props.initialScrollPositions);
}

async function initWorkerPool() {
  if (workerPool) return workerPool;
  try {
    workerPool = getOrCreateWorkerPoolSingleton({
      poolOptions: {
        workerFactory: () =>
          new Worker(
            new URL("@pierre/diffs/worker/worker-portable.js", import.meta.url),
            { type: "module" }
          ),
      },
      highlighterOptions: {
        theme: "github-dark",
        lineDiffType: "word",
      },
    });
    return workerPool;
  } catch (e) {
    console.warn("[DiffView] Worker pool init failed, falling back:", e);
    return null;
  }
}

async function loadDiff(options: { preserveCurrentScroll?: boolean } = {}) {
  if (options.preserveCurrentScroll !== false) {
    saveCurrentScrollPosition();
  }
  emit("scope-change", scope.value);
  const path = props.worktreePath || props.repoPath;
  const loadId = ++nextDiffLoadId;
  const loadStartedAt = performance.now();
  const renderContext: DiffRenderContext = {
    loadId,
    loadStartedAt,
  };
  loading.value = true;
  error.value = null;
  noDiff.value = false;
  logDiffPerf(loadId, "start", {
    scope: scope.value,
    path,
    hasExplicitBaseRef: Boolean(props.baseRef),
    workingFilter: scope.value === "working" ? workingFilter.value : undefined,
  });

  try {
    let patch = "";

    if (scope.value === "working") {
      const diffStartedAt = performance.now();
      patch = await invoke<string>("git_diff", { repoPath: path, mode: workingFilter.value });
      logDiffPerf(loadId, "git_diff:done", {
        durationMs: roundDuration(performance.now() - diffStartedAt),
        mode: workingFilter.value,
      });
    } else {
      // "branch" scope — diff from merge base
      const baseRefStartedAt = performance.now();
      const baseRef = props.baseRef || await detectBaseRef(path);
      logDiffPerf(loadId, "base_ref:done", {
        durationMs: roundDuration(performance.now() - baseRefStartedAt),
        baseRef,
        source: props.baseRef ? "prop" : "detected",
      });

      const mergeBaseStartedAt = performance.now();
      const mergeBase = await invoke<string>("git_merge_base", {
        repoPath: path,
        refA: baseRef,
        refB: "HEAD",
      });
      logDiffPerf(loadId, "merge_base:done", {
        durationMs: roundDuration(performance.now() - mergeBaseStartedAt),
        mergeBase,
      });

      const diffRangeStartedAt = performance.now();
      patch = await invoke<string>("git_diff_range", {
        repoPath: path,
        from: mergeBase,
        to: "HEAD",
      });
      logDiffPerf(loadId, "git_diff_range:done", {
        durationMs: roundDuration(performance.now() - diffRangeStartedAt),
      });
    }

    if (!patch?.trim()) {
      noDiff.value = true;
      diffContent.value = "";
      cleanupInstance();
      logDiffPerf(loadId, "empty", {
        totalMs: roundDuration(performance.now() - loadStartedAt),
      });
      return;
    }

    logDiffPerf(loadId, "patch:ready", {
      durationMs: roundDuration(performance.now() - loadStartedAt),
      bytes: patch.length,
      lines: patch.split("\n").length,
    });

    diffContent.value = patch;
    await renderDiff(diffContent.value, renderContext);
    restoreScrollPosition();
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : String(e);
    logDiffPerf(loadId, "error", {
      totalMs: roundDuration(performance.now() - loadStartedAt),
      error: error.value,
    });
  } finally {
    loading.value = false;
  }
}

async function detectBaseRef(path: string): Promise<string> {
  const defaultBranch = await invoke<string>("git_default_branch", { repoPath: path });
  try {
    await invoke<string>("git_merge_base", {
      repoPath: path,
      refA: `origin/${defaultBranch}`,
      refB: "HEAD",
    });
    return `origin/${defaultBranch}`;
  } catch (e: unknown) {
    console.warn("[DiffView] origin ref not available, using local:", e);
    return defaultBranch;
  }
}

function cleanupInstance() {
  if (fileDiffInstance) {
    // FileDiff doesn't have a destroy method — just null the reference
    fileDiffInstance = null;
  }
  // Clear rendered diff elements safely
  if (containerRef.value) {
    while (containerRef.value.firstChild) {
      containerRef.value.removeChild(containerRef.value.firstChild);
    }
  }
}

async function renderDiff(patch: string, context: DiffRenderContext) {
  if (!containerRef.value) return;

  const normalizedPatchStartedAt = performance.now();
  const normalizedPatch = normalizeGitPatchForDiffParser(patch);
  const normalizedPatchDurationMs = performance.now() - normalizedPatchStartedAt;

  const parseStartedAt = performance.now();
  const patches = parsePatchFiles(normalizedPatch);
  const parseDurationMs = performance.now() - parseStartedAt;
  const allFiles = patches?.flatMap((p) => p.files || []) || [];
  if (allFiles.length === 0) {
    noDiff.value = true;
    cleanupInstance();
    logDiffPerf(context.loadId, "parse:empty", {
      totalMs: roundDuration(performance.now() - context.loadStartedAt),
      normalizeMs: roundDuration(normalizedPatchDurationMs),
      parseMs: roundDuration(parseDurationMs),
    });
    return;
  }

  logDiffPerf(context.loadId, "parse:done", {
    normalizeMs: roundDuration(normalizedPatchDurationMs),
    parseMs: roundDuration(parseDurationMs),
    patchCount: patches.length,
    fileCount: allFiles.length,
  });

  const workerInitStartedAt = performance.now();
  const pool = await initWorkerPool();
  logDiffPerf(context.loadId, "worker_pool:ready", {
    durationMs: roundDuration(performance.now() - workerInitStartedAt),
    stats: getWorkerPoolStatsSnapshot(pool),
  });

  const cleanupStartedAt = performance.now();
  cleanupInstance();
  logDiffPerf(context.loadId, "cleanup:done", {
    durationMs: roundDuration(performance.now() - cleanupStartedAt),
  });

  // Render each file diff
  let completedFiles = 0;
  let firstCompletedAt: number | null = null;
  let completedAllLogged = false;

  for (const [fileIndex, rawFileMeta] of allFiles.entries()) {
    const fileRenderStartedAt = performance.now();
    const pathMeta = rawFileMeta as typeof rawFileMeta & DiffFilePathMetadata;
    const displayPath =
      pathMeta.newName ||
      pathMeta.oldName ||
      pathMeta.fileName ||
      "";
    let didLogPostRender = false;

    const fileMeta = isBazelSyntaxPath(displayPath)
      ? setLanguageOverride(
          rawFileMeta,
          getSyntaxLanguageForPath(displayPath) as "python"
        )
      : rawFileMeta;

    const wrapper = document.createElement("div");
    wrapper.className = "diff-file";
    containerRef.value.appendChild(wrapper);

    const instance = new FileDiff(
      {
        theme: "github-dark",
        diffStyle: "unified",
        diffIndicators: "classic",
        onPostRender: () => {
          if (didLogPostRender) return;
          didLogPostRender = true;
          const completedAt = performance.now();
          const sinceFileStartMs = completedAt - fileRenderStartedAt;
          const sinceLoadStartMs = completedAt - context.loadStartedAt;
          completedFiles += 1;
          if (firstCompletedAt == null) {
            firstCompletedAt = completedAt;
            logDiffPerf(context.loadId, "content:first_file_ready", {
              durationMs: roundDuration(sinceLoadStartMs),
              fileIndex,
              fileCount: allFiles.length,
              path: displayPath,
              workerStats: getWorkerPoolStatsSnapshot(pool),
            });
          }
          if (sinceFileStartMs >= 250) {
            logDiffPerf(context.loadId, "content:file_ready", {
              fileIndex,
              fileCount: allFiles.length,
              path: displayPath,
              sinceFileStartMs: roundDuration(sinceFileStartMs),
              sinceLoadStartMs: roundDuration(sinceLoadStartMs),
              workerStats: getWorkerPoolStatsSnapshot(pool),
            });
          }
          if (!completedAllLogged && completedFiles === allFiles.length) {
            completedAllLogged = true;
            logDiffPerf(context.loadId, "content:all_files_ready", {
              durationMs: roundDuration(sinceLoadStartMs),
              fileCount: allFiles.length,
              firstContentMs: roundDuration(
                (firstCompletedAt ?? completedAt) - context.loadStartedAt,
              ),
              workerStats: getWorkerPoolStatsSnapshot(pool),
            });
          }
        },
      },
      pool || undefined
    );

    instance.render({
      fileDiff: fileMeta,
      containerWrapper: wrapper,
    });

    // Keep last instance for cleanup
    fileDiffInstance = instance;

    logDiffPerf(context.loadId, "render:file_invoked", {
      fileIndex,
      fileCount: allFiles.length,
      path: displayPath,
      syncMs: roundDuration(performance.now() - fileRenderStartedAt),
      workerStats: getWorkerPoolStatsSnapshot(pool),
    });
  }

  logDiffPerf(context.loadId, "render:scheduled", {
    totalMs: roundDuration(performance.now() - context.loadStartedAt),
    fileCount: allFiles.length,
    workerStats: getWorkerPoolStatsSnapshot(pool),
  });
}

watch(
  () => [props.viewKey, props.repoPath, props.worktreePath, props.baseRef] as const,
  (nextValue, previousValue) => {
    const viewChanged = previousValue !== undefined && nextValue[0] !== previousValue[0];
    if (viewChanged) {
      syncViewStateFromProps();
    }
    void loadDiff({ preserveCurrentScroll: !viewChanged });
  },
  { immediate: false }
);

const scopeOrder: DiffScope[] = ["working", "branch"];

async function setScope(nextScope: DiffScope) {
  if (scope.value === nextScope) return;
  saveCurrentScrollPosition();
  scope.value = nextScope;
  await loadDiff({ preserveCurrentScroll: false });
}

function cycleScopeForward() {
  const idx = scopeOrder.indexOf(scope.value);
  void setScope(scopeOrder[(idx + 1) % scopeOrder.length]);
}

function cycleScopeBack() {
  const idx = scopeOrder.indexOf(scope.value);
  void setScope(scopeOrder[(idx - 1 + scopeOrder.length) % scopeOrder.length]);
}

function cycleWorkingFilter() {
  const idx = workingFilterOrder.indexOf(workingFilter.value);
  workingFilter.value = workingFilterOrder[(idx + 1) % workingFilterOrder.length];
  void loadDiff();
}

function handleScroll() {
  saveCurrentScrollPosition();
}

useLessScroll(containerRef, {
  extraHandler(e) {
    // s — cycle working filter (only in working scope)
    if (e.key === "s" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      if (scope.value === "working") {
        e.preventDefault();
        cycleWorkingFilter();
        return true;
      }
    }
    // Cmd+Shift+] — next scope
    if (e.key === "]" && e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      cycleScopeForward();
      return true;
    }
    // Cmd+Shift+[ — previous scope
    if (e.key === "[" && e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      cycleScopeBack();
      return true;
    }
    return false;
  },
  onClose: () => emit("close"),
});

onMounted(() => {
  syncViewStateFromProps();
  void loadDiff({ preserveCurrentScroll: false });
});

onUnmounted(() => cleanupInstance());

defineExpose({ refresh: loadDiff });
</script>

<template>
  <div class="diff-view">
    <div class="diff-toolbar">
      <div class="scope-selector">
        <button :class="{ active: scope === 'working' }" @click="setScope('working')">{{ $t('diffView.scopeWorking') }}</button>
        <button :class="{ active: scope === 'branch' }" @click="setScope('branch')">{{ $t('diffView.scopeBranch') }}</button>
      </div>
      <button
        v-if="scope === 'working'"
        class="staged-toggle"
        @click="cycleWorkingFilter()"
      >{{ workingFilterLabel }}</button>
    </div>
    <div v-if="error" class="diff-status diff-error">{{ error }}</div>
    <div v-else-if="noDiff && !loading" class="diff-status">{{ $t('diffView.noChanges') }}</div>
    <div ref="containerRef" class="diff-container" @scroll="handleScroll"></div>
  </div>
</template>

<style scoped>
.diff-view {
  flex: 1;
  overflow: auto;
  background: #1a1a1a;
  font-size: 13px;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.diff-toolbar {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  border-bottom: 1px solid #333;
  background: #1e1e1e;
  flex-shrink: 0;
}

.scope-selector {
  display: flex;
  gap: 0;
}

.scope-selector button {
  padding: 3px 12px;
  background: #2a2a2a;
  border: 1px solid #444;
  color: #888;
  font-size: 11px;
  cursor: pointer;
}

.scope-selector button:first-child { border-radius: 4px 0 0 4px; }
.scope-selector button:last-child { border-radius: 0 4px 4px 0; }
.scope-selector button:not(:first-child) { border-left: none; }

.scope-selector button.active {
  background: #0066cc;
  border-color: #0077ee;
  color: #fff;
}

.staged-toggle {
  margin-left: 12px;
  padding: 3px 10px;
  background: #2a2a2a;
  border: 1px solid #444;
  color: #888;
  font-size: 11px;
  border-radius: 4px;
  cursor: pointer;
}

.diff-status {
  padding: 24px;
  color: #666;
  text-align: center;
  font-size: 13px;
}

.diff-error {
  color: #f85149;
}

.diff-container {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.diff-container :deep(.diff-file) {
  margin-bottom: 2px;
}

.diff-container :deep(diffs-container) {
  color-scheme: dark;
}
</style>
