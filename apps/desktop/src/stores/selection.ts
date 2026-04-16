import { computed, type ComputedRef } from "vue";
import { watchDebounced } from "@vueuse/core";
import { DEFAULT_STAGE_ORDER } from "@kanna/core";
import { insertOperatorEvent, setSetting, updatePipelineItemActivity, type PipelineItem, type Repo } from "@kanna/db";
import { createNavigationHistory } from "../composables/useNavigationHistory";
import { hasTag, requireService, type StoreContext } from "./state";

export interface SelectionApi {
  selectedRepo: ComputedRef<Repo | null>;
  currentItem: ComputedRef<PipelineItem | null>;
  sortedItemsForCurrentRepo: ComputedRef<PipelineItem[]>;
  sortedItemsAllRepos: ComputedRef<PipelineItem[]>;
  canGoBack: ComputedRef<boolean>;
  canGoForward: ComputedRef<boolean>;
  getStageOrder: (repoId: string) => readonly string[];
  selectRepo: (repoId: string) => Promise<void>;
  selectItem: (itemId: string) => Promise<void>;
  restoreSelection: (itemId: string) => void;
  goBack: () => void;
  goForward: () => void;
  isItemHidden: (item: PipelineItem) => boolean;
}

export function createSelectionApi(context: StoreContext): SelectionApi {
  const nav = createNavigationHistory();

  function emitTaskSelected(itemId: string) {
    const item = context.state.items.value.find((candidate) => candidate.id === itemId);
    insertOperatorEvent(context.requireDb(), "task_selected", itemId, item?.repo_id ?? null).catch((error) =>
      console.error("[store] operator event failed:", error),
    );
  }

  function getStageOrder(repoId: string): readonly string[] {
    const repoPath = context.state.repos.value.find((repo) => repo.id === repoId)?.path ?? "";
    return context.state.stageOrderCache.get(repoPath) ?? DEFAULT_STAGE_ORDER;
  }

  function isItemHidden(item: PipelineItem): boolean {
    return item.stage === "done";
  }

  const selectedRepo = computed(() =>
    context.state.repos.value.find((repo) => repo.id === context.state.selectedRepoId.value) ?? null,
  );

  function sortItemsForRepo(repoId: string): PipelineItem[] {
    const repoItems = context.state.items.value.filter(
      (item) => item.repo_id === repoId && !isItemHidden(item),
    );
    const pinned = repoItems
      .filter((item) => item.pinned)
      .sort((left, right) => (left.pin_order ?? 0) - (right.pin_order ?? 0));
    const sortByCreatedAt = (entries: PipelineItem[]) =>
      entries.sort((left, right) => right.created_at.localeCompare(left.created_at));

    const blocked = sortByCreatedAt(repoItems.filter((item) => hasTag(item, "blocked") && !item.pinned));
    const blockedIds = new Set(blocked.map((item) => item.id));
    const stageItems = repoItems.filter((item) => !item.pinned && !blockedIds.has(item.id));
    const order = getStageOrder(repoId);

    const stageOrder = (item: PipelineItem): number => {
      const idx = order.indexOf(item.stage);
      return idx === -1 ? order.length : idx;
    };

    const sortedStageItems = stageItems.sort((left, right) => {
      const orderLeft = stageOrder(left);
      const orderRight = stageOrder(right);
      if (orderLeft !== orderRight) return orderLeft - orderRight;
      if (orderLeft === order.length && left.stage !== right.stage) {
        return left.stage.localeCompare(right.stage);
      }
      return right.created_at.localeCompare(left.created_at);
    });

    return [...pinned, ...sortedStageItems, ...blocked];
  }

  const sortedItemsForCurrentRepo = computed(() =>
    sortItemsForRepo(context.state.selectedRepoId.value ?? ""),
  );

  const sortedItemsAllRepos = computed(() =>
    context.state.repos.value.flatMap((repo) => sortItemsForRepo(repo.id)),
  );

  const currentItem = computed(() => {
    if (context.state.selectedItemId.value) {
      const item = context.state.items.value.find((candidate) => candidate.id === context.state.selectedItemId.value);
      if (item && !isItemHidden(item) && item.repo_id === context.state.selectedRepoId.value) return item;
    }

    return sortedItemsForCurrentRepo.value.find(
      (item) => !context.state.pendingSetupIds.value.includes(item.id),
    ) ?? null;
  });

  watchDebounced(
    context.state.selectedItemId,
    async (itemId) => {
      if (!itemId) return;
      const selectionTime = Date.now() - 1000;
      const item = context.state.items.value.find((candidate) => candidate.id === itemId);
      if (!item || item.activity !== "unread") return;
      if (item.activity_changed_at && new Date(item.activity_changed_at).getTime() > selectionTime) return;
      await updatePipelineItemActivity(context.requireDb(), itemId, "idle");
      await requireService(context.services.reloadSnapshot, "reloadSnapshot")();
    },
    { debounce: 1000 },
  );

  async function selectRepo(repoId: string) {
    context.state.selectedRepoId.value = repoId;
    context.state.selectedItemId.value = context.state.lastSelectedItemByRepo.value[repoId] ?? null;
    await setSetting(context.requireDb(), "selected_repo_id", repoId);
  }

  async function selectItem(itemId: string) {
    nav.select(itemId, context.state.selectedItemId.value);
    context.state.selectedItemId.value = itemId;
    const item = context.state.items.value.find((candidate) => candidate.id === itemId);
    if (item) {
      context.state.lastSelectedItemByRepo.value[item.repo_id] = itemId;
    }
    await setSetting(context.requireDb(), "selected_item_id", itemId);
    emitTaskSelected(itemId);
  }

  function restoreSelection(itemId: string) {
    context.state.selectedItemId.value = itemId;
    const item = context.state.items.value.find((candidate) => candidate.id === itemId);
    if (item) {
      context.state.lastSelectedItemByRepo.value[item.repo_id] = itemId;
    }
  }

  function goBack() {
    if (!context.state.selectedItemId.value) return;
    const validIds = new Set(
      requireService(context.services.sortedItemsAllRepos, "sortedItemsAllRepos").value.map((item) => item.id),
    );
    const taskId = nav.goBack(context.state.selectedItemId.value, validIds);
    if (!taskId) return;

    const item = context.state.items.value.find((candidate) => candidate.id === taskId);
    if (item) {
      if (item.repo_id !== context.state.selectedRepoId.value) {
        context.state.selectedRepoId.value = item.repo_id;
        void setSetting(context.requireDb(), "selected_repo_id", item.repo_id);
      }
      context.state.lastSelectedItemByRepo.value[item.repo_id] = taskId;
    }

    context.state.selectedItemId.value = taskId;
    void setSetting(context.requireDb(), "selected_item_id", taskId);
    emitTaskSelected(taskId);
  }

  function goForward() {
    if (!context.state.selectedItemId.value) return;
    const validIds = new Set(
      requireService(context.services.sortedItemsAllRepos, "sortedItemsAllRepos").value.map((item) => item.id),
    );
    const taskId = nav.goForward(context.state.selectedItemId.value, validIds);
    if (!taskId) return;

    const item = context.state.items.value.find((candidate) => candidate.id === taskId);
    if (item) {
      if (item.repo_id !== context.state.selectedRepoId.value) {
        context.state.selectedRepoId.value = item.repo_id;
        void setSetting(context.requireDb(), "selected_repo_id", item.repo_id);
      }
      context.state.lastSelectedItemByRepo.value[item.repo_id] = taskId;
    }

    context.state.selectedItemId.value = taskId;
    void setSetting(context.requireDb(), "selected_item_id", taskId);
    emitTaskSelected(taskId);
  }

  return {
    selectedRepo,
    currentItem,
    sortedItemsForCurrentRepo,
    sortedItemsAllRepos,
    canGoBack: nav.canGoBack,
    canGoForward: nav.canGoForward,
    getStageOrder,
    selectRepo,
    selectItem,
    restoreSelection,
    goBack,
    goForward,
    isItemHidden,
  };
}
