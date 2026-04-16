import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbHandle, PipelineItem, Repo } from "@kanna/db";

const mockState = vi.hoisted(() => {
  const now = "2026-04-16T00:00:00.000Z";

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
      tags: "[]",
      pr_number: null,
      pr_url: null,
      branch: "task-task-1",
      closed_at: null,
      agent_type: "pty",
      agent_provider: "claude",
      activity: "working",
      activity_changed_at: now,
      unread_at: null,
      port_offset: null,
      display_name: null,
      port_env: null,
      pinned: 0,
      pin_order: null,
      base_ref: null,
      claude_session_id: null,
      previous_stage: null,
      created_at: now,
      updated_at: now,
      ...overrides,
    };
  }

  let repos = [makeRepo()];
  let pipelineItems = [makeItem()];
  let sessionStatuses: Array<{ session_id: string; status: string }> = [];
  const listeners = new Map<string, Array<(event: unknown) => void>>();

  const invokeMock = vi.fn(async (command: string) => {
    switch (command) {
      case "list_sessions":
        return sessionStatuses;
      case "spawn_session":
      case "ensure_term_init":
      case "get_app_data_dir":
      case "get_pipeline_socket_path":
        return undefined;
      case "file_exists":
        return true;
      case "read_text_file":
        return "{}";
      case "which_binary":
        return "/usr/bin/claude";
      default:
        throw new Error(`unexpected invoke: ${command}`);
    }
  });

  const listenMock = vi.fn(async (event: string, handler: (event: unknown) => void) => {
    const handlers = listeners.get(event) ?? [];
    handlers.push(handler);
    listeners.set(event, handlers);
    return () => {
      const current = listeners.get(event) ?? [];
      listeners.set(
        event,
        current.filter((candidate) => candidate !== handler),
      );
    };
  });

  const updatePipelineItemActivityMock = vi.fn(async (_db: DbHandle, itemId: string, activity: PipelineItem["activity"]) => {
    const item = pipelineItems.find((candidate) => candidate.id === itemId);
    if (!item) return;
    item.activity = activity;
    item.activity_changed_at = now;
    item.updated_at = now;
  });

  function emit(event: string, payload: unknown): void {
    for (const handler of listeners.get(event) ?? []) {
      handler({ payload });
    }
  }

  function reset(): void {
    repos = [makeRepo()];
    pipelineItems = [makeItem()];
    sessionStatuses = [];
    listeners.clear();
    invokeMock.mockClear();
    listenMock.mockClear();
    updatePipelineItemActivityMock.mockClear();
  }

  return {
    get repos() {
      return repos;
    },
    get pipelineItems() {
      return pipelineItems;
    },
    set pipelineItems(value: PipelineItem[]) {
      pipelineItems = value;
    },
    get sessionStatuses() {
      return sessionStatuses;
    },
    set sessionStatuses(value: Array<{ session_id: string; status: string }>) {
      sessionStatuses = value;
    },
    invokeMock,
    listenMock,
    updatePipelineItemActivityMock,
    emit,
    reset,
  };
});

vi.mock("../invoke", () => ({
  invoke: mockState.invokeMock,
}));

vi.mock("../tauri-mock", () => ({
  isTauri: true,
}));

vi.mock("../listen", () => ({
  listen: mockState.listenMock,
}));

vi.mock("@kanna/core", () => ({
  parseRepoConfig: vi.fn(() => ({})),
  parseAgentMd: vi.fn(() => null),
  DEFAULT_STAGE_ORDER: ["in progress", "pr", "merge", "done"],
}));

vi.mock("../../../../packages/core/src/pipeline/agent-loader", () => ({
  parseAgentDefinition: vi.fn(() => ({
    name: "agent",
    description: "agent",
    prompt: "Agent prompt",
  })),
}));

vi.mock("../../../../packages/core/src/pipeline/pipeline-loader", () => ({
  parsePipelineJson: vi.fn(() => ({
    name: "default",
    stages: [],
  })),
}));

vi.mock("../../../../packages/core/src/pipeline/prompt-builder", () => ({
  buildStagePrompt: vi.fn(() => "Stage prompt"),
}));

vi.mock("../composables/useToast", () => ({
  useToast: () => ({
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock("../composables/terminalSessionRecovery", () => ({
  buildTaskShellCommand: vi.fn(() => "agent-command"),
  getTaskTerminalEnv: vi.fn(() => ({})),
}));

vi.mock("../composables/terminalStateCache", () => ({
  clearCachedTerminalState: vi.fn(),
}));

vi.mock("./kannaCleanup", () => ({
  closePipelineItemAndClearCachedTerminalState: vi.fn(async () => {}),
  getTaskIdFromTeardownSessionId: vi.fn(() => null),
  isTeardownSessionId: vi.fn(() => false),
  reportCloseSessionError: vi.fn(),
  reportPrewarmSessionError: vi.fn(),
  shouldAutoCloseTaskAfterTeardownExit: vi.fn(() => false),
  shouldAutoCloseTaskImmediatelyAfterEnteringTeardown: vi.fn(() => false),
  shouldClearCachedTerminalStateOnSessionExit: vi.fn(() => false),
}));

vi.mock("./agent-provider", () => ({
  getPreferredAgentProviders: vi.fn(() => "claude"),
  requireResolvedAgentProvider: vi.fn((provider?: string) => provider ?? "claude"),
  resolveAgentProvider: vi.fn((provider?: string | string[]) => Array.isArray(provider) ? provider[0] : (provider ?? "claude")),
}));

vi.mock("./taskCreationPlaceholder", () => ({
  buildPendingTaskPlaceholder: vi.fn(),
}));

vi.mock("./portAllocationLog", () => ({
  formatTaskPortAllocationLog: vi.fn(() => ""),
}));

vi.mock("./taskCloseBehavior", () => ({
  getTaskCloseBehavior: vi.fn(() => "close"),
}));

vi.mock("./taskCloseSelection", () => ({
  shouldSelectNextOnCloseTransition: vi.fn(() => true),
}));

vi.mock("./taskShellPrewarm", () => ({
  shouldPrewarmTaskShellOnCreate: vi.fn(() => false),
}));

vi.mock("./agent-permissions", () => ({
  getAgentPermissionFlags: vi.fn(() => []),
}));

vi.mock("./taskBaseBranch", () => ({
  getCreateWorktreeStartPoint: vi.fn(() => "main"),
  resolveInitialBaseRef: vi.fn(() => "origin/main"),
}));

vi.mock("./db", () => ({
  resolveDbName: vi.fn(() => "kanna.db"),
}));

vi.mock("./kannaCliEnv", () => ({
  buildKannaCliEnv: vi.fn(() => ({})),
}));

vi.mock("../i18n", () => ({
  default: {
    global: {
      t: (key: string) => key,
    },
  },
}));

vi.mock("@kanna/db", () => ({
  listRepos: vi.fn(async () => mockState.repos),
  insertRepo: vi.fn(async () => {}),
  findRepoByPath: vi.fn(async () => null),
  hideRepo: vi.fn(async () => {}),
  unhideRepo: vi.fn(async () => {}),
  listPipelineItems: vi.fn(async (_db: DbHandle, repoId: string) =>
    mockState.pipelineItems.filter((item) => item.repo_id === repoId),
  ),
  insertPipelineItem: vi.fn(async () => {}),
  updatePipelineItemActivity: mockState.updatePipelineItemActivityMock,
  updatePipelineItemStage: vi.fn(async () => {}),
  pinPipelineItem: vi.fn(async () => {}),
  unpinPipelineItem: vi.fn(async () => {}),
  reorderPinnedItems: vi.fn(async () => {}),
  updatePipelineItemDisplayName: vi.fn(async () => {}),
  clearPipelineItemStageResult: vi.fn(async () => {}),
  closePipelineItem: vi.fn(async () => {}),
  reopenPipelineItem: vi.fn(async () => {}),
  getRepo: vi.fn(async (_db: DbHandle, repoId: string) =>
    mockState.repos.find((repo) => repo.id === repoId) ?? null,
  ),
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => {}),
  insertTaskBlocker: vi.fn(async () => {}),
  removeTaskBlocker: vi.fn(async () => {}),
  removeAllBlockersForItem: vi.fn(async () => {}),
  listBlockersForItem: vi.fn(async () => []),
  listBlockedByItem: vi.fn(async () => []),
  getUnblockedItems: vi.fn(async () => []),
  hasCircularDependency: vi.fn(async () => false),
  insertOperatorEvent: vi.fn(async () => {}),
  updateClaudeSessionId: vi.fn(async () => {}),
  listTaskPorts: vi.fn(async () => []),
  listTaskPortsForItem: vi.fn(async () => []),
  deleteTaskPortsForItem: vi.fn(async () => {}),
}));

import { useKannaStore } from "./kanna";

function createDb(): DbHandle {
  return {
    execute: vi.fn(async () => ({ rowsAffected: 1 })),
    select: vi.fn(async () => []),
  };
}

async function flushStore(): Promise<void> {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

async function createStore() {
  setActivePinia(createPinia());
  const store = useKannaStore();
  await store.init(createDb());
  await flushStore();
  return store;
}

describe("kanna runtime status reconciliation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockState.reset();
  });

  it("reconciles a selected task to idle after terminal output when the daemon now reports waiting", async () => {
    const store = await createStore();
    await store.selectRepo("repo-1");
    await store.selectItem("task-1");
    await flushStore();

    mockState.sessionStatuses = [{ session_id: "task-1", status: "waiting" }];

    mockState.emit("terminal_output", {
      session_id: "task-1",
      data_b64: "AA==",
    });

    await vi.advanceTimersByTimeAsync(250);
    await flushStore();

    expect(mockState.updatePipelineItemActivityMock).toHaveBeenCalledWith(
      expect.anything(),
      "task-1",
      "idle",
    );
    expect(mockState.pipelineItems[0]?.activity).toBe("idle");
  });

  it("reconciles an unselected task to unread after terminal output when the daemon now reports waiting", async () => {
    const store = await createStore();
    await store.selectRepo("repo-1");
    await flushStore();

    mockState.sessionStatuses = [{ session_id: "task-1", status: "waiting" }];

    mockState.emit("terminal_output", {
      session_id: "task-1",
      data_b64: "AA==",
    });

    await vi.advanceTimersByTimeAsync(250);
    await flushStore();

    expect(mockState.updatePipelineItemActivityMock).toHaveBeenCalledWith(
      expect.anything(),
      "task-1",
      "unread",
    );
    expect(mockState.pipelineItems[0]?.activity).toBe("unread");
  });
});
