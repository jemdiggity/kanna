import { defineStore } from "pinia";
import { listBlockedByItem, listBlockersForItem } from "@kanna/db";
import { useToast } from "../composables/useToast";
import { createStoreContext, createStoreState, type StoreServices } from "./state";
import { createPortsStore } from "./ports";
import { createSelectionApi } from "./selection";
import { createSessionsApi } from "./sessions";
import { createPipelineApi } from "./pipeline";
import { createTasksApi } from "./tasks";
import { createInitApi } from "./init";
export { readRepoConfig } from "./state";
export { collectTeardownCommands } from "./tasks";

export const useKannaStore = defineStore("kanna", () => {
  const toast = useToast();
  const state = createStoreState();
  const services: StoreServices = {};
  const context = createStoreContext(state, toast, services);

  const ports = createPortsStore(context);
  const selection = createSelectionApi(context);
  const sessions = createSessionsApi(context);
  const pipeline = createPipelineApi(context);
  const tasks = createTasksApi(context, ports);
  const initApi = createInitApi(context, ports, tasks);

  services.selectedRepo = selection.selectedRepo;
  services.currentItem = selection.currentItem;
  services.sortedItemsForCurrentRepo = selection.sortedItemsForCurrentRepo;
  services.sortedItemsAllRepos = selection.sortedItemsAllRepos;
  services.isItemHidden = selection.isItemHidden;
  services.getStageOrder = selection.getStageOrder;
  services.selectRepo = selection.selectRepo;
  services.selectItem = selection.selectItem;
  services.restoreSelection = selection.restoreSelection;
  services.goBack = selection.goBack;
  services.goForward = selection.goForward;

  services.applyTaskRuntimeStatus = sessions.applyTaskRuntimeStatus;
  services.syncTaskStatusesFromDaemon = sessions.syncTaskStatusesFromDaemon;
  services.scheduleRuntimeStatusSync = sessions.scheduleRuntimeStatusSync;
  services.getAgentProviderAvailability = sessions.getAgentProviderAvailability;
  services.waitForSessionExit = sessions.waitForSessionExit;
  services.resolveSessionExitWaiters = sessions.resolveSessionExitWaiters;
  services.spawnShellSession = sessions.spawnShellSession;
  services.prewarmWorktreeShellSession = sessions.prewarmWorktreeShellSession;
  services.preparePtySession = sessions.preparePtySession;
  services.spawnPtySession = sessions.spawnPtySession;

  services.loadPipeline = pipeline.loadPipeline;
  services.loadAgent = pipeline.loadAgent;
  services.advanceStage = pipeline.advanceStage;
  services.rerunStage = pipeline.rerunStage;

  services.createItem = tasks.createItem;
  services.closeTask = tasks.closeTask;
  services.undoClose = tasks.undoClose;
  services.checkUnblocked = tasks.checkUnblocked;
  services.startBlockedTask = tasks.startBlockedTask;
  services.blockTask = tasks.blockTask;
  services.editBlockedTask = tasks.editBlockedTask;

  async function makePR() {
    const item = selection.currentItem.value;
    if (!item) return;
    try {
      await pipeline.advanceStage(item.id);
    } catch (error) {
      console.error("[store] stage advance failed:", error);
      toast.error(context.tt("toasts.prAgentFailed"));
    }
  }

  async function mergeQueue() {
    if (!state.selectedRepoId.value) {
      if (state.repos.value.length === 1) {
        state.selectedRepoId.value = state.repos.value[0].id;
      } else {
        toast.warning(context.tt("toasts.selectRepoFirst"));
        return;
      }
    }

    const repo = state.repos.value.find((candidate) => candidate.id === state.selectedRepoId.value);
    if (!repo) return;

    try {
      const agent = await pipeline.loadAgent(repo.path, "merge");
      await tasks.createItem(repo.id, repo.path, agent.prompt, "pty");
    } catch (error) {
      console.error("[store] merge agent failed to start:", error);
      toast.error(context.tt("toasts.mergeAgentFailed"));
    }
  }

  return {
    repos: state.repos,
    items: state.items,
    selectedRepoId: state.selectedRepoId,
    selectedItemId: state.selectedItemId,
    lastSelectedItemByRepo: state.lastSelectedItemByRepo,
    canGoBack: selection.canGoBack,
    canGoForward: selection.canGoForward,
    suspendAfterMinutes: state.suspendAfterMinutes,
    killAfterMinutes: state.killAfterMinutes,
    ideCommand: state.ideCommand,
    hideShortcutsOnStartup: state.hideShortcutsOnStartup,
    devLingerTerminals: state.devLingerTerminals,
    lastHiddenRepoId: state.lastHiddenRepoId,
    refreshKey: state.refreshKey,

    selectedRepo: selection.selectedRepo,
    currentItem: selection.currentItem,
    sortedItemsForCurrentRepo: selection.sortedItemsForCurrentRepo,
    sortedItemsAllRepos: selection.sortedItemsAllRepos,
    getStageOrder: selection.getStageOrder,

    bump: context.bump,
    init: initApi.init,
    selectRepo: selection.selectRepo,
    selectItem: selection.selectItem,
    goBack: selection.goBack,
    goForward: selection.goForward,

    importRepo: tasks.importRepo,
    createRepo: tasks.createRepo,
    cloneAndImportRepo: tasks.cloneAndImportRepo,
    hideRepo: tasks.hideRepo,

    createItem: tasks.createItem,
    spawnPtySession: sessions.spawnPtySession,
    spawnShellSession: sessions.spawnShellSession,
    closeTask: tasks.closeTask,
    undoClose: tasks.undoClose,

    advanceStage: pipeline.advanceStage,
    rerunStage: pipeline.rerunStage,
    loadPipeline: pipeline.loadPipeline,
    loadAgent: pipeline.loadAgent,

    makePR,
    mergeQueue,
    blockTask: tasks.blockTask,
    editBlockedTask: tasks.editBlockedTask,
    listBlockersForItem: (itemId: string) => listBlockersForItem(context.requireDb(), itemId),
    listBlockedByItem: (itemId: string) => listBlockedByItem(context.requireDb(), itemId),
    pinItem: tasks.pinItem,
    unpinItem: tasks.unpinItem,
    reorderPinned: tasks.reorderPinned,
    renameItem: tasks.renameItem,
    savePreference: initApi.savePreference,
  };
});
