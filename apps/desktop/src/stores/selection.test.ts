import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DbHandle, PipelineItem, Repo } from "@kanna/db";

import { createSelectionApi } from "./selection";
import { createStoreContext, createStoreState } from "./state";

const mockState = vi.hoisted(() => {
  const insertOperatorEventMock = vi.fn(async () => {});
  const setSettingMock = vi.fn(async () => {});
  const updatePipelineItemActivityMock = vi.fn(async () => {});

  return {
    insertOperatorEventMock,
    setSettingMock,
    updatePipelineItemActivityMock,
    reset() {
      insertOperatorEventMock.mockClear();
      setSettingMock.mockClear();
      updatePipelineItemActivityMock.mockClear();
    },
  };
});

vi.mock("@kanna/db", () => ({
  insertOperatorEvent: mockState.insertOperatorEventMock,
  setSetting: mockState.setSettingMock,
  updatePipelineItemActivity: mockState.updatePipelineItemActivityMock,
}));

function createDb(): DbHandle {
  return {
    execute: vi.fn(async () => ({ rowsAffected: 1 })),
    select: vi.fn(async () => []),
  };
}

describe("createSelectionApi", () => {
  beforeEach(() => {
    mockState.reset();
  });

  it("persists selection through the window workspace instead of global selected_item_id settings", async () => {
    const state = createStoreState();
    state.db.value = createDb();
    state.repos.value = [
      {
        id: "repo-1",
        path: "/tmp/repo",
        name: "repo",
        default_branch: "main",
        hidden: 0,
        sort_order: 0,
        created_at: "2026-04-29T00:00:00.000Z",
        last_opened_at: "2026-04-29T00:00:00.000Z",
      } satisfies Repo,
    ];
    state.items.value = [
      {
        id: "task-1",
        repo_id: "repo-1",
        issue_number: null,
        issue_title: null,
        prompt: "Ship it",
        pipeline: "default",
        stage: "in progress",
        stage_result: null,
        tags: "[]",
        pr_number: null,
        pr_url: null,
        branch: "task-task-1",
        closed_at: null,
        agent_type: "sdk",
        agent_provider: "claude",
        activity: "idle",
        activity_changed_at: "2026-04-29T00:00:00.000Z",
        unread_at: null,
        port_offset: null,
        display_name: null,
        port_env: null,
        pinned: 0,
        pin_order: null,
        base_ref: null,
        agent_session_id: null,
        previous_stage: null,
        last_output_preview: null,
        created_at: "2026-04-29T00:00:00.000Z",
        updated_at: "2026-04-29T00:00:00.000Z",
      } satisfies PipelineItem,
    ];
    state.selectedRepoId.value = "repo-1";

    const persistSelection = vi.fn(async () => {});
    const context = createStoreContext(
      state,
      {
        toasts: ref([]),
        dismiss: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
      },
      {
        windowWorkspace: {
          persistSelection,
        },
      } as never,
    );

    await createSelectionApi(context).selectItem("task-1");

    expect(persistSelection).toHaveBeenCalledWith({
      selectedRepoId: "repo-1",
      selectedItemId: "task-1",
    });
    expect(mockState.setSettingMock).not.toHaveBeenCalledWith(
      createDb(),
      "selected_item_id",
      "task-1",
    );
  });

  it("falls back to the first visible repo and task when the current selection disappears", async () => {
    const state = createStoreState();
    state.db.value = createDb();
    state.repos.value = [
      {
        id: "repo-1",
        path: "/tmp/repo-1",
        name: "repo-1",
        default_branch: "main",
        hidden: 0,
        sort_order: 0,
        created_at: "2026-04-29T00:00:00.000Z",
        last_opened_at: "2026-04-29T00:00:00.000Z",
      } satisfies Repo,
    ];
    state.items.value = [
      {
        id: "task-1",
        repo_id: "repo-1",
        issue_number: null,
        issue_title: null,
        prompt: "Ship it",
        pipeline: "default",
        stage: "in progress",
        stage_result: null,
        tags: "[]",
        pr_number: null,
        pr_url: null,
        branch: "task-task-1",
        closed_at: null,
        agent_type: "sdk",
        agent_provider: "claude",
        activity: "idle",
        activity_changed_at: "2026-04-29T00:00:00.000Z",
        unread_at: null,
        port_offset: null,
        display_name: null,
        port_env: null,
        pinned: 0,
        pin_order: null,
        base_ref: null,
        agent_session_id: null,
        previous_stage: null,
        last_output_preview: null,
        created_at: "2026-04-29T00:00:00.000Z",
        updated_at: "2026-04-29T00:00:00.000Z",
      } satisfies PipelineItem,
    ];
    state.selectedRepoId.value = "repo-missing";
    state.selectedItemId.value = "task-missing";

    const context = createStoreContext(
      state,
      {
        toasts: ref([]),
        dismiss: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
      },
      {} as never,
    );

    const api = createSelectionApi(context);
    api.reconcileSelection();

    expect(state.selectedRepoId.value).toBe("repo-1");
    expect(state.selectedItemId.value).toBe("task-1");
  });
});
