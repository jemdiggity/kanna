import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbHandle, PipelineItem, Repo } from "@kanna/db";
import { createStoreContext, createStoreState } from "./state";
import { createInitApi } from "./init";

const mockState = vi.hoisted(() => {
  const now = "2026-04-23T00:00:00.000Z";

  function makeRepo(overrides: Partial<Repo> = {}): Repo {
    return {
      id: "repo-1",
      path: "/tmp/repo",
      name: "repo",
      default_branch: "main",
      hidden: 0,
      created_at: now,
      last_opened_at: now,
      ...overrides,
    };
  }

  function makeItem(overrides: Partial<PipelineItem> = {}): PipelineItem {
    return {
      id: "task-1",
      repo_id: "repo-1",
      issue_number: null,
      issue_title: null,
      prompt: "Ship it",
      pipeline: "default",
      stage: "in progress",
      stage_result: null,
      tags: "[\"blocked\"]",
      pr_number: null,
      pr_url: null,
      branch: "task-task-1",
      closed_at: null,
      agent_type: "pty",
      agent_provider: "claude",
      activity: "idle",
      activity_changed_at: now,
      unread_at: null,
      port_offset: 1421,
      display_name: null,
      port_env: "{\"KANNA_DEV_PORT\":\"1421\"}",
      pinned: 0,
      pin_order: null,
      base_ref: null,
      agent_session_id: "resume-123",
      previous_stage: null,
      last_output_preview: null,
      created_at: now,
      updated_at: now,
      ...overrides,
    };
  }

  let repos = [makeRepo()];
  let unblockedItems: PipelineItem[] = [];
  const listenMock = vi.fn(async () => () => {});
  const updatePipelineItemActivityMock = vi.fn(async () => {});

  function reset(): void {
    repos = [makeRepo()];
    unblockedItems = [];
    listenMock.mockClear();
    updatePipelineItemActivityMock.mockClear();
  }

  return {
    makeItem,
    get repos() {
      return repos;
    },
    get unblockedItems() {
      return unblockedItems;
    },
    set unblockedItems(value: PipelineItem[]) {
      unblockedItems = value;
    },
    listenMock,
    updatePipelineItemActivityMock,
    reset,
  };
});

vi.mock("@kanna/db", () => ({
  getSetting: vi.fn(async () => null),
  getUnblockedItems: vi.fn(async () => mockState.unblockedItems),
  listRepos: vi.fn(async () => mockState.repos),
  listPipelineItems: vi.fn(async () => []),
  updatePipelineItemActivity: mockState.updatePipelineItemActivityMock,
  closePipelineItem: vi.fn(async () => {}),
}));

vi.mock("../tauri-mock", () => ({
  isTauri: false,
}));

vi.mock("../listen", () => ({
  listen: mockState.listenMock,
}));

function createDb(): DbHandle {
  return {
    execute: vi.fn(async () => ({ rowsAffected: 1 })),
    select: vi.fn(async () => []),
  };
}

describe("createInitApi", () => {
  beforeEach(() => {
    mockState.reset();
  });

  it("restores unblocked tasks through the shared blocked-task restore path on startup", async () => {
    mockState.unblockedItems = [mockState.makeItem()];

    const state = createStoreState();
    const services = {
      loadInitialData: vi.fn(async () => {}),
    };
    const toast = {
      toasts: ref([]),
      dismiss: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    };
    const context = createStoreContext(state, toast, services);
    const ports = {
      closeTaskAndReleasePorts: vi.fn(async () => {}),
    } as unknown as import("./ports").PortsStore;
    const restoreUnblockedTask = vi.fn(async () => {});
    const startBlockedTask = vi.fn(async () => {});
    const initApi = createInitApi(context, ports, {
      checkUnblocked: vi.fn(async () => {}),
      handleAgentFinished: vi.fn(),
      startBlockedTask,
      restoreUnblockedTask,
    } as unknown as Parameters<typeof createInitApi>[2]);

    await initApi.init(createDb());

    expect(restoreUnblockedTask).toHaveBeenCalledWith(mockState.unblockedItems[0]);
    expect(startBlockedTask).not.toHaveBeenCalled();
  });
});
