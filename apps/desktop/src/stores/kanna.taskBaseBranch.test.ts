import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbHandle, PipelineItem, Repo, TaskPort } from "@kanna/db";
import type { PipelineDefinition } from "../../../../packages/core/src/pipeline/pipeline-types";
import type { RepoConfig } from "@kanna/core";

const mockState = vi.hoisted(() => {
  const repoPath = "/tmp/repo";
  const now = "2026-04-14T00:00:00.000Z";

  function makeRepo(overrides: Partial<Repo> = {}): Repo {
    return {
      id: "repo-1",
      path: repoPath,
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
      id: "item-1",
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
      branch: "task-existing",
      closed_at: null,
      agent_type: "pty",
      agent_provider: "claude",
      activity: "idle",
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
  let pipelineItems: PipelineItem[] = [];
  let pipelineDefinition: PipelineDefinition = {
    name: "default",
    stages: [],
  };
  let baseBranchResponse: string[] | Error = ["origin/main", "main"];
  let repoConfig: RepoConfig = {};
  let taskPorts: TaskPort[] = [];
  let blockCleanupGate: Promise<void> | null = null;

  function defer(): { promise: Promise<void>; resolve: () => void } {
    let resolve = () => {};
    const promise = new Promise<void>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  const invokeMock = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    switch (command) {
      case "git_default_branch":
        return "main";
      case "git_list_base_branches":
        if (baseBranchResponse instanceof Error) throw baseBranchResponse;
        return baseBranchResponse;
      case "git_fetch":
      case "git_worktree_add":
      case "git_worktree_remove":
      case "spawn_session":
      case "signal_session":
      case "create_agent_session":
      case "kill_session":
      case "attach_session":
      case "run_script":
        return undefined;
      case "which_binary":
        return `/usr/bin/${String(args?.name ?? "tool")}`;
      case "get_app_data_dir":
        return "/tmp/kanna";
      case "get_pipeline_socket_path":
        return "/tmp/kanna.sock";
      case "read_builtin_resource":
        return "{}";
      case "read_text_file":
        if (typeof args?.path === "string" && args.path.endsWith("/.kanna/config.json")) {
          return "{}";
        }
        throw new Error("missing");
      default:
        throw new Error(`unexpected invoke: ${command}`);
    }
  });

  const insertPipelineItemMock = vi.fn(async (_db: DbHandle, item: Partial<PipelineItem>) => {
    pipelineItems.push(makeItem({
      id: item.id,
      repo_id: item.repo_id,
      prompt: item.prompt ?? null,
      pipeline: item.pipeline,
      stage: item.stage,
      tags: JSON.stringify(item.tags ?? []),
      branch: item.branch ?? null,
      agent_type: item.agent_type ?? null,
      agent_provider: item.agent_provider ?? "claude",
      activity: item.activity ?? "idle",
      display_name: item.display_name ?? null,
      port_offset: item.port_offset ?? null,
      port_env: item.port_env ?? null,
      base_ref: item.base_ref ?? null,
    }));
  });

  const updatePipelineItemStageMock = vi.fn(async (_db: DbHandle, itemId: string, stage: string) => {
    const item = pipelineItems.find((candidate) => candidate.id === itemId);
    if (item) {
      item.stage = stage;
      item.updated_at = now;
    }
  });

  const updatePipelineItemActivityMock = vi.fn(async (_db: DbHandle, itemId: string, activity: PipelineItem["activity"]) => {
    const item = pipelineItems.find((candidate) => candidate.id === itemId);
    if (item) {
      item.activity = activity;
      item.activity_changed_at = now;
      item.updated_at = now;
    }
  });

  const closePipelineItemMock = vi.fn(async (_db: DbHandle, itemId: string) => {
    const item = pipelineItems.find((candidate) => candidate.id === itemId);
    if (item) {
      item.stage = "done";
      item.closed_at = now;
      item.updated_at = now;
    }
  });

  function reset(): void {
    repos = [makeRepo()];
    pipelineItems = [];
    pipelineDefinition = { name: "default", stages: [] };
    baseBranchResponse = ["origin/main", "main"];
    repoConfig = {};
    taskPorts = [];
    blockCleanupGate = null;
    invokeMock.mockClear();
    insertPipelineItemMock.mockClear();
    updatePipelineItemStageMock.mockClear();
    updatePipelineItemActivityMock.mockClear();
    closePipelineItemMock.mockClear();
  }

  return {
    get repos() {
      return repos;
    },
    set repos(value: Repo[]) {
      repos = value;
    },
    get pipelineItems() {
      return pipelineItems;
    },
    set pipelineItems(value: PipelineItem[]) {
      pipelineItems = value;
    },
    get pipelineDefinition() {
      return pipelineDefinition;
    },
    set pipelineDefinition(value: PipelineDefinition) {
      pipelineDefinition = value;
    },
    get baseBranchResponse() {
      return baseBranchResponse;
    },
    set baseBranchResponse(value: string[] | Error) {
      baseBranchResponse = value;
    },
    get repoConfig() {
      return repoConfig;
    },
    set repoConfig(value: RepoConfig) {
      repoConfig = value;
    },
    get taskPorts() {
      return taskPorts;
    },
    set taskPorts(value: TaskPort[]) {
      taskPorts = value;
    },
    invokeMock,
    insertPipelineItemMock,
    updatePipelineItemStageMock,
    updatePipelineItemActivityMock,
    closePipelineItemMock,
    makeItem,
    makeRepo,
    defer,
    get blockCleanupGate() {
      return blockCleanupGate;
    },
    set blockCleanupGate(value: Promise<void> | null) {
      blockCleanupGate = value;
    },
    reset,
  };
});

vi.mock("../invoke", () => ({
  invoke: mockState.invokeMock,
}));

vi.mock("../tauri-mock", () => ({
  isTauri: false,
}));

vi.mock("../listen", () => ({
  listen: vi.fn(),
}));

vi.mock("@kanna/core", () => ({
  parseRepoConfig: vi.fn(() => mockState.repoConfig),
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
  parsePipelineJson: vi.fn(() => mockState.pipelineDefinition),
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
  buildTaskShellCommand: vi.fn((agentCmd: string) => agentCmd),
  getTaskTerminalEnv: vi.fn(() => ({})),
}));

vi.mock("../composables/terminalStateCache", () => ({
  clearCachedTerminalState: vi.fn(),
}));

vi.mock("./kannaCleanup", () => ({
  closePipelineItemAndClearCachedTerminalState: vi.fn(async (itemId: string, closePipelineItem: (itemId: string) => Promise<unknown>) => {
    if (mockState.blockCleanupGate) {
      await mockState.blockCleanupGate;
    }
    await closePipelineItem(itemId);
  }),
  isTeardownSessionId: vi.fn(() => false),
  reportCloseSessionError: vi.fn(),
  reportPrewarmSessionError: vi.fn(),
  shouldClearCachedTerminalStateOnSessionExit: vi.fn(() => false),
}));

vi.mock("./agent-provider", () => ({
  getPreferredAgentProviders: vi.fn((options: {
    explicit?: string | string[];
    stage?: string | string[];
    agent?: string | string[];
    item?: string;
  }) => options.explicit ?? options.stage ?? options.agent ?? options.item ?? "claude"),
  requireResolvedAgentProvider: vi.fn((provider?: string) => provider ?? "claude"),
  resolveAgentProvider: vi.fn((provider?: string | string[]) => Array.isArray(provider) ? provider[0] : (provider ?? "claude")),
}));

vi.mock("./taskCreationPlaceholder", () => ({
  buildPendingTaskPlaceholder: vi.fn((options: {
    id: string;
    repoId: string;
    prompt: string;
    branch: string;
    agentType: string;
    requestedAgentProviders?: string | string[];
    pipelineName?: string;
    stage?: string;
    displayName?: string | null;
  }) => mockState.makeItem({
    id: options.id,
    repo_id: options.repoId,
    prompt: options.prompt,
    branch: options.branch,
    agent_type: options.agentType,
    agent_provider: Array.isArray(options.requestedAgentProviders)
      ? (options.requestedAgentProviders[0] ?? "claude")
      : (options.requestedAgentProviders ?? "claude"),
    pipeline: options.pipelineName ?? "default",
    stage: options.stage ?? "in progress",
    activity: "working",
    display_name: options.displayName ?? null,
  })),
}));

vi.mock("./taskRuntimeStatus", () => ({
  shouldIgnoreRuntimeStatusDuringSetup: vi.fn(() => false),
}));

vi.mock("./portAllocationLog", () => ({
  formatTaskPortAllocationLog: vi.fn(() => ""),
}));

vi.mock("./taskShellPrewarm", () => ({
  shouldPrewarmTaskShellOnCreate: vi.fn(() => false),
}));

vi.mock("./agent-permissions", () => ({
  getAgentPermissionFlags: vi.fn(() => []),
}));

vi.mock("./db", () => ({
  resolveDbName: vi.fn(async () => "kanna-test.db"),
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
    mockState.pipelineItems.filter((item) => item.repo_id === repoId)
  ),
  insertPipelineItem: mockState.insertPipelineItemMock,
  updatePipelineItemActivity: mockState.updatePipelineItemActivityMock,
  updatePipelineItemStage: mockState.updatePipelineItemStageMock,
  pinPipelineItem: vi.fn(async () => {}),
  unpinPipelineItem: vi.fn(async () => {}),
  reorderPinnedItems: vi.fn(async () => {}),
  updatePipelineItemDisplayName: vi.fn(async () => {}),
  clearPipelineItemStageResult: vi.fn(async () => {}),
  closePipelineItem: mockState.closePipelineItemMock,
  reopenPipelineItem: vi.fn(async (_db: DbHandle, itemId: string) => {
    const item = mockState.pipelineItems.find((candidate) => candidate.id === itemId);
    if (item) {
      item.closed_at = null;
    }
  }),
  getRepo: vi.fn(async (_db: DbHandle, repoId: string) =>
    mockState.repos.find((repo) => repo.id === repoId) ?? null
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
  listTaskPorts: vi.fn(async () => [...mockState.taskPorts].sort((a, b) => a.port - b.port)),
  listTaskPortsForItem: vi.fn(async (_db: DbHandle, itemId: string) =>
    mockState.taskPorts
      .filter((taskPort) => taskPort.pipeline_item_id === itemId)
      .sort((a, b) => a.port - b.port)
  ),
  deleteTaskPortsForItem: vi.fn(async (_db: DbHandle, itemId: string) => {
    mockState.taskPorts = mockState.taskPorts.filter((taskPort) => taskPort.pipeline_item_id !== itemId);
  }),
}));

import { useKannaStore } from "./kanna";

function createDb(): DbHandle {
  return {
    execute: vi.fn(async (query: string, bindValues?: unknown[]) => {
      if (query.startsWith("INSERT OR IGNORE INTO task_port")) {
        const [port, pipelineItemId, envName] = bindValues as [number, string, string];
        if (!mockState.taskPorts.some((taskPort) => taskPort.port === port)) {
          mockState.taskPorts = [
            ...mockState.taskPorts,
            {
              port,
              pipeline_item_id: pipelineItemId,
              env_name: envName,
              created_at: mockState.makeItem().created_at,
            },
          ];
          return { rowsAffected: 1 };
        }
        return { rowsAffected: 0 };
      }

      if (query.startsWith("UPDATE pipeline_item SET port_offset = ?, port_env = ?, updated_at = datetime('now') WHERE id = ?")) {
        const [portOffset, portEnv, itemId] = bindValues as [number | null, string | null, string];
        const item = mockState.pipelineItems.find((candidate) => candidate.id === itemId);
        if (item) {
          item.port_offset = portOffset;
          item.port_env = portEnv;
        }
        return { rowsAffected: item ? 1 : 0 };
      }

      if (query.startsWith("DELETE FROM pipeline_item WHERE id = ?")) {
        const [itemId] = bindValues as [string];
        mockState.pipelineItems = mockState.pipelineItems.filter((candidate) => candidate.id !== itemId);
        return { rowsAffected: 1 };
      }

      return { rowsAffected: 1 };
    }),
    select: vi.fn(async <T>(query: string, bindValues?: unknown[]) => {
      if (query === "SELECT pipeline_item_id FROM task_port WHERE port = ?") {
        const [port] = bindValues as [number];
        const row = mockState.taskPorts.find((taskPort) => taskPort.port === port);
        return row ? [{ pipeline_item_id: row.pipeline_item_id }] as T[] : [];
      }

      if (query === "SELECT * FROM pipeline_item WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 1") {
        const closed = [...mockState.pipelineItems]
          .filter((item) => item.closed_at !== null)
          .sort((a, b) => String(b.closed_at).localeCompare(String(a.closed_at)));
        return (closed[0] ? [closed[0]] : []) as T[];
      }

      return [];
    }),
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

describe("kanna store task base branch integration", () => {
  beforeEach(() => {
    mockState.reset();
  });

  it("persists an explicit baseBranch into base_ref and uses it as the worktree start point from repo root", async () => {
    const store = await createStore();

    await store.createItem("repo-1", "/tmp/repo", "Ship explicit base branch", "sdk", {
      baseBranch: "feature/task-base-branch",
      agentProvider: "claude",
    });

    expect(mockState.insertPipelineItemMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        base_ref: "feature/task-base-branch",
      }),
    );

    await vi.waitFor(() => {
      expect(mockState.invokeMock).toHaveBeenCalledWith(
        "git_worktree_add",
        expect.objectContaining({
          repoPath: "/tmp/repo",
          startPoint: "feature/task-base-branch",
        }),
      );
    });
  });

  it("prefers origin/default for base_ref when no explicit base branch is provided and the remote ref exists", async () => {
    mockState.baseBranchResponse = ["feature/x", "main", "origin/main"];
    const store = await createStore();

    await store.createItem("repo-1", "/tmp/repo", "Ship default branch task", "sdk", {
      agentProvider: "claude",
    });

    expect(mockState.insertPipelineItemMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        base_ref: "origin/main",
      }),
    );

    await vi.waitFor(() => {
      expect(mockState.invokeMock).toHaveBeenCalledWith("git_fetch", {
        repoPath: "/tmp/repo",
        branch: "main",
      });
    });

    await vi.waitFor(() => {
      expect(mockState.invokeMock).toHaveBeenCalledWith(
        "git_worktree_add",
        expect.objectContaining({
          repoPath: "/tmp/repo",
          startPoint: "origin/main",
        }),
      );
    });

    const gitFetchCallIndex = mockState.invokeMock.mock.calls.findIndex(([command]) => command === "git_fetch");
    const gitWorktreeAddCallIndex = mockState.invokeMock.mock.calls.findIndex(([command]) => command === "git_worktree_add");

    expect(gitFetchCallIndex).toBeGreaterThanOrEqual(0);
    expect(gitWorktreeAddCallIndex).toBeGreaterThan(gitFetchCallIndex);
    expect(
      mockState.invokeMock.mock.calls.some(([command, args]) =>
        command === "git_worktree_add" &&
        typeof args === "object" &&
        args !== null &&
        "startPoint" in args &&
        (args as { startPoint?: unknown }).startPoint === "main"
      ),
    ).toBe(false);
  });

  it("falls back to the local default branch for base_ref when base branch enumeration fails", async () => {
    mockState.baseBranchResponse = new Error("git_list_base_branches failed");
    const store = await createStore();

    await store.createItem("repo-1", "/tmp/repo", "Ship fallback task", "sdk", {
      agentProvider: "claude",
    });

    expect(mockState.insertPipelineItemMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        base_ref: "main",
      }),
    );
  });

  it("reserves every configured base port for the default branch and starts worktrees at the next offset", async () => {
    mockState.repoConfig = {
      ports: {
        KANNA_DEV_PORT: 1420,
        API_PORT: 3000,
      },
    };
    const store = await createStore();

    await store.createItem("repo-1", "/tmp/repo", "Ship reserved ports", "sdk", {
      agentProvider: "claude",
    });

    const createdItem = mockState.pipelineItems.at(-1);
    expect(createdItem?.port_offset).toBe(1421);
    expect(createdItem?.port_env).toBe(JSON.stringify({
      KANNA_DEV_PORT: "1421",
      API_PORT: "3001",
    }));
    expect(mockState.taskPorts.map((taskPort) => `${taskPort.env_name}:${taskPort.port}`)).toEqual([
      "KANNA_DEV_PORT:1421",
      "API_PORT:3001",
    ]);
  });

  it("assigns later worktrees the next free offset above the reserved default-branch port", async () => {
    mockState.repoConfig = {
      ports: {
        KANNA_DEV_PORT: 1420,
        API_PORT: 3000,
      },
    };
    const store = await createStore();

    await store.createItem("repo-1", "/tmp/repo", "First task", "sdk", {
      agentProvider: "claude",
    });
    await store.createItem("repo-1", "/tmp/repo", "Second task", "sdk", {
      agentProvider: "claude",
    });

    const secondItem = mockState.pipelineItems.at(-1);
    expect(secondItem?.port_offset).toBe(1422);
    expect(secondItem?.port_env).toBe(JSON.stringify({
      KANNA_DEV_PORT: "1422",
      API_PORT: "3002",
    }));
  });

  it("assigns ports freshly on undo close instead of restoring the task's previous assignment", async () => {
    mockState.repoConfig = {
      ports: {
        KANNA_DEV_PORT: 1420,
        API_PORT: 3000,
      },
    };
    mockState.pipelineItems = [
      mockState.makeItem({
        id: "item-closed",
        branch: "task-closed",
        closed_at: "2026-04-14T12:00:00.000Z",
        port_offset: 1422,
        port_env: JSON.stringify({
          KANNA_DEV_PORT: "1422",
          API_PORT: "3002",
        }),
      }),
    ];
    const store = await createStore();

    await store.undoClose();

    const reopenedItem = mockState.pipelineItems[0];
    expect(reopenedItem.closed_at).toBeNull();
    expect(reopenedItem.port_offset).toBe(1421);
    expect(reopenedItem.port_env).toBe(JSON.stringify({
      KANNA_DEV_PORT: "1421",
      API_PORT: "3001",
    }));
    expect(mockState.taskPorts.map((taskPort) => `${taskPort.env_name}:${taskPort.port}`)).toEqual([
      "KANNA_DEV_PORT:1421",
      "API_PORT:3001",
    ]);
  });

  it("reuses the saved prompt when respawning a reopened PTY task", async () => {
    mockState.pipelineItems = [
      mockState.makeItem({
        id: "item-closed",
        branch: "task-closed",
        prompt: "continue e3d1fc75",
        closed_at: "2026-04-14T12:00:00.000Z",
        agent_type: "pty",
        agent_provider: "codex",
      }),
    ];
    const store = await createStore();

    await store.undoClose();

    expect(mockState.invokeMock).toHaveBeenCalledWith(
      "spawn_session",
      expect.objectContaining({
        sessionId: "item-closed",
        cwd: "/tmp/repo/.kanna-worktrees/task-closed",
        agentProvider: "codex",
        args: expect.arrayContaining([
          expect.stringContaining("continue e3d1fc75"),
        ]),
      }),
    );
  });

  it("advances stages using the previous task branch as the next worktree start point", async () => {
    mockState.pipelineDefinition = {
      name: "default",
      stages: [
        { name: "in progress", transition: "manual" },
        { name: "pr", transition: "manual" },
      ],
    };
    mockState.pipelineItems = [
      mockState.makeItem({
        id: "item-existing",
        branch: "task-existing-branch",
        stage: "in progress",
      }),
    ];

    const store = await createStore();
    await vi.waitFor(() => {
      expect(store.items).toHaveLength(1);
    });

    await store.advanceStage("item-existing");

    await vi.waitFor(() => {
      expect(mockState.invokeMock).toHaveBeenCalledWith(
        "git_worktree_add",
        expect.objectContaining({
          repoPath: "/tmp/repo",
          startPoint: "task-existing-branch",
        }),
      );
    });
  });

  it("shows the blocked replacement before cleanup finishes", async () => {
    const cleanup = mockState.defer();
    mockState.blockCleanupGate = cleanup.promise;
    mockState.pipelineItems = [
      mockState.makeItem({
        id: "item-active",
        branch: "task-item-active",
        prompt: "Investigate sidebar lag",
        display_name: "Sidebar lag",
      }),
      mockState.makeItem({
        id: "item-blocker",
        branch: "task-item-blocker",
        prompt: "Finish upstream dependency",
        display_name: "Upstream dependency",
        created_at: "2026-04-14T00:01:00.000Z",
        updated_at: "2026-04-14T00:01:00.000Z",
      }),
    ];

    const store = await createStore();
    await vi.waitFor(() => {
      expect(store.currentItem?.id).toBe("item-blocker");
    });

    await store.selectItem("item-active");
    await flushStore();

    const blockPromise = store.blockTask(["item-blocker"]);
    await flushStore();

    const blockedReplacement = mockState.pipelineItems.find((item) =>
      item.id !== "item-active" && JSON.parse(item.tags).includes("blocked")
    );

    expect(blockedReplacement).toBeDefined();
    expect(store.selectedItemId).toBe(blockedReplacement?.id ?? null);
    expect(store.currentItem?.id).toBe(blockedReplacement?.id ?? null);
    expect(JSON.parse(store.currentItem?.tags ?? "[]")).toContain("blocked");
    expect(store.items.some((item) => item.id === "item-active" && item.stage !== "done")).toBe(false);

    cleanup.resolve();
    await blockPromise;
    await flushStore();

    expect(store.items.some((item) => item.id === "item-active" && item.stage !== "done")).toBe(false);
    expect(store.items.some((item) => item.id === blockedReplacement?.id)).toBe(true);
  });
});
