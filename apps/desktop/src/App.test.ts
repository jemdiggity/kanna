// @vitest-environment happy-dom

import { computed, defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyboardActions } from "./composables/useKeyboardShortcuts";

async function flushPromises() {
  await Promise.resolve();
  await nextTick();
}

const listenHandlers = new Map<string, (event: unknown) => void | Promise<void>>();
const dbSelectMock = vi.fn(async () => []);
const dbMock = {
  select: dbSelectMock,
  execute: vi.fn(async () => ({ rowsAffected: 0 })),
};

const store = {
  repos: [{ id: "repo-1", path: "/tmp/repo", name: "repo" }],
  items: [],
  selectedRepoId: "repo-1" as string | null,
  selectedItemId: null,
  selectedRepo: { id: "repo-1", path: "/tmp/repo", name: "repo" } as { id: string; path: string; name: string } | null,
  currentItem: null,
  sortedItemsForCurrentRepo: [],
  sortedItemsAllRepos: [],
  lastSelectedItemByRepo: {},
  suspendAfterMinutes: 30,
  killAfterMinutes: 60,
  ideCommand: "code",
  devLingerTerminals: false,
  hideShortcutsOnStartup: true,
  init: vi.fn(async () => {}),
  createItem: vi.fn(async () => {}),
  recordIncomingTransfer: vi.fn(async () => {}),
  approveIncomingTransfer: vi.fn(async () => "task-imported"),
  rejectIncomingTransfer: vi.fn(async () => {}),
  finalizeOutgoingTransfer: vi.fn(async () => ({
    transferId: "transfer-1",
    payload: {
      target_peer_id: "peer-target",
      task: {
        source_peer_id: "peer-source",
        source_task_id: "task-source",
        resume_session_id: null,
        prompt: "Fix handoff",
        stage: "in progress",
        branch: "task-source",
        pipeline: "default",
        display_name: "Transferred task",
        base_ref: "main",
        agent_type: "pty",
        agent_provider: "claude",
      },
      repo: {
        mode: "reuse-local",
        remote_url: null,
        path: "/tmp/repo",
        name: "repo",
        default_branch: "main",
        bundle: null,
      },
      recovery: null,
      artifacts: [],
    },
    finalizedCleanly: true,
  })),
  handleOutgoingTransferCommitted: vi.fn(async () => {}),
  listBlockedByItem: vi.fn(async () => []),
  listBlockersForItem: vi.fn(async () => []),
  blockTask: vi.fn(async () => {}),
  editBlockedTask: vi.fn(async () => {}),
  createRepo: vi.fn(async () => {}),
  importRepo: vi.fn(async () => {}),
  cloneAndImportRepo: vi.fn(async () => {}),
  savePreference: vi.fn(async () => {}),
  attachWindowWorkspace: vi.fn(),
  selectRepo: vi.fn(),
  selectItem: vi.fn(),
  closeTask: vi.fn(async () => {}),
  bump: vi.fn(async () => {}),
  pinItem: vi.fn(async () => {}),
  unpinItem: vi.fn(async () => {}),
  reorderPinned: vi.fn(async () => {}),
  renameItem: vi.fn(async () => {}),
  hideRepo: vi.fn(async () => {}),
  spawnPtySession: vi.fn(async () => {}),
  loadAgent: vi.fn(async () => ({
    prompt: "Use https://schemas.kanna.build/config.schema.json when writing .kanna/config.json.",
    agent_provider: ["codex", "claude"],
    model: undefined,
    permission_mode: "default",
    allowed_tools: undefined,
  })),
};
const toastInfoMock = vi.fn();
const toastWarningMock = vi.fn();
const mockWindowWorkspace = {
  bootstrap: {
    windowId: "main",
    selectedRepoId: null,
    selectedItemId: null,
  },
  loadSnapshot: vi.fn(async () => ({ windows: [] })),
  saveSnapshot: vi.fn(async () => {}),
  openWindow: vi.fn(async () => {}),
  persistSelection: vi.fn(async () => {}),
  persistSidebarHidden: vi.fn(async () => {}),
  invalidateSharedData: vi.fn(async () => {}),
  restoreAdditionalWindows: vi.fn(async () => {}),
};

let capturedKeyboardActions: KeyboardActions | null = null;

const invokeMock = vi.fn(async (command: string, args?: Record<string, unknown>) => {
  if (command === "list_dir") return ["default.json"];
  if (command === "read_text_file") return "";
  if (command === "git_default_branch") return "main";
  if (command === "git_list_base_branches") return ["feature/x", "main", "origin/main"];
  if (command === "read_env_var") return "/Users/test";
  if (command === "which_binary" && (args?.name === "claude" || args?.name === "codex")) return true;
  if (command === "complete_outgoing_transfer_finalization") return { transferId: args?.transferId ?? "transfer-1" };
  throw new Error(`unexpected invoke: ${command}`);
});

vi.mock("./stores/kanna", () => ({
  useKannaStore: () => store,
}));

vi.mock("./invoke", () => ({
  invoke: (command: string, args?: { name?: string; repoPath?: string }) => invokeMock(command, args),
}));

vi.mock("./listen", () => ({
  listen: vi.fn(async (event: string, handler: (event: unknown) => void | Promise<void>) => {
    listenHandlers.set(event, handler);
    return () => {
      listenHandlers.delete(event);
    };
  }),
}));

vi.mock("@kanna/core", () => ({
  NEW_CUSTOM_TASK_PROMPT: "custom",
  parseRepoConfig: vi.fn(() => ({})),
}));

vi.mock("@kanna/db", () => ({
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => {}),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("./i18n", () => ({
  default: {
    global: {
      locale: {
        value: "en",
      },
    },
  },
}));

vi.mock("./composables/useBackup", () => ({
  startPeriodicBackup: vi.fn(),
}));

vi.mock("./composables/useOperatorEvents", () => ({
  useOperatorEvents: vi.fn(),
}));

vi.mock("./composables/useKeyboardShortcuts", () => ({
  useKeyboardShortcuts: vi.fn((actions: KeyboardActions) => {
    capturedKeyboardActions = actions;
  }),
}));

vi.mock("./composables/useCustomTasks", () => ({
  useCustomTasks: () => ({
    tasks: ref([]),
    scan: vi.fn(async () => []),
  }),
}));

const appUpdateStartMock = vi.fn();
const appUpdateMock = {
  status: ref<"idle" | "checking" | "available" | "downloading" | "readyToRestart" | "error">("available"),
  updateVersion: ref("0.0.39"),
  releaseNotes: ref("Notes for 0.0.39"),
  publishedAt: ref("2026-04-15T00:00:00Z"),
  dismissedVersion: ref<string | null>(null),
  downloadedBytes: ref(0),
  contentLength: ref<number | null>(null),
  errorMessage: ref<string | null>(null),
  visible: computed(() => true),
  start: appUpdateStartMock,
  checkNow: vi.fn(),
  dismiss: vi.fn(),
  install: vi.fn(),
  restartNow: vi.fn(),
  dispose: vi.fn(),
};

vi.mock("./composables/useAppUpdate", () => ({
  useAppUpdate: () => appUpdateMock,
}));

vi.mock("./composables/useToast", () => ({
  useToast: () => ({
    error: vi.fn(),
    info: toastInfoMock,
    warning: toastWarningMock,
  }),
}));

vi.mock("./composables/useRestoreFocus", () => ({
  useRestoreFocus: vi.fn(),
}));

vi.mock("./composables/useModalZIndex", () => ({
  isTopModal: vi.fn(() => true),
  useModalZIndex: () => ({ zIndex: 1000 }),
}));

const SidebarWithRepoStub = defineComponent({
  name: "Sidebar",
  emits: ["new-task"],
  template: '<button data-testid="open-new-task" @click="$emit(\'new-task\', \'repo-1\')">open</button>',
});

const SidebarWithoutRepoStub = defineComponent({
  name: "Sidebar",
  emits: ["new-task"],
  template: '<button data-testid="open-new-task" @click="$emit(\'new-task\')">open</button>',
});

const FilePickerModalTestStub = defineComponent({
  name: "FilePickerModal",
  emits: ["close", "select"],
  template: `
    <div data-testid="file-picker-modal">
      <button data-testid="file-picker-select" @click="$emit('select', 'src/example.ts')">select</button>
      <button data-testid="file-picker-close" @click="$emit('close')">close</button>
    </div>
  `,
});

const FilePreviewModalTestStub = defineComponent({
  name: "FilePreviewModal",
  emits: ["close"],
  setup(_props, { emit, expose }) {
    function dismiss() {
      emit("close");
      return true;
    }

    expose({ dismiss });

    return {};
  },
  template: `
    <div data-testid="file-preview-modal">
      <button data-testid="file-preview-close" @click="$emit('close')">close</button>
    </div>
  `,
});

const TreeExplorerModalTestStub = defineComponent({
  name: "TreeExplorerModal",
  props: {
    maximized: Boolean,
    worktreePath: {
      type: String,
      required: true,
    },
  },
  template: `
    <div
      data-testid="tree-explorer-modal"
      :data-maximized="String(maximized)"
      :data-worktree-path="worktreePath"
    />
  `,
});

function buildIncomingTransferEvent() {
  return {
    payload: {
      type: "incoming_transfer_request",
      transfer_id: "transfer-1",
      source_peer_id: "peer-source",
      source_task_id: "task-source",
      source_name: "Primary",
      payload: {
        target_peer_id: "peer-target",
        task: {
          source_peer_id: "peer-source",
          source_task_id: "task-source",
          prompt: "Fix handoff",
          stage: "in progress",
          branch: "task-source",
          pipeline: "default",
          display_name: "Transferred task",
          base_ref: "main",
          agent_type: "sdk",
          agent_provider: "claude",
        },
        repo: {
          mode: "reuse-local",
          remote_url: "git@github.com:jemdiggity/kanna.git",
          path: "/tmp/repo",
          name: "repo",
          default_branch: "main",
        },
        recovery: null,
      },
    },
  };
}

function buildPendingIncomingTransferRow() {
  return {
    id: "transfer-1",
    source_peer_id: "peer-source",
    payload_json: JSON.stringify(buildIncomingTransferEvent().payload.payload),
  };
}

function buildOutgoingTransferCommittedEvent() {
  return {
    payload: {
      type: "outgoing_transfer_committed",
      transfer_id: "transfer-1",
      source_task_id: "task-source",
      destination_local_task_id: "task-imported",
    },
  };
}

function buildOutgoingTransferFinalizationRequestedEvent() {
  return {
    payload: {
      type: "outgoing_transfer_finalization_requested",
      transfer_id: "transfer-1",
    },
  };
}
async function mountApp(sidebarStub: typeof SidebarWithRepoStub | typeof SidebarWithoutRepoStub) {
  vi.stubGlobal("__KANNA_MOBILE__", false);
  const { default: App } = await import("./App.vue");
  return mount(App, {
    global: {
      provide: {
        db: dbMock,
        dbName: "test.db",
        windowWorkspace: mockWindowWorkspace,
      },
      mocks: {
        $t: (key: string) => key,
      },
      stubs: {
        Sidebar: sidebarStub,
        MainPanel: true,
        AddRepoModal: true,
        KeyboardShortcutsModal: true,
        FilePickerModal: true,
        FilePreviewModal: true,
        TreeExplorerModal: true,
        DiffModal: true,
        CommitGraphModal: true,
        ShellModal: true,
        CommandPaletteModal: true,
        AnalyticsModal: true,
        BlockerSelectModal: true,
        PreferencesPanel: true,
        ToastContainer: true,
        KeepAlive: false,
      },
    },
  });
}

async function mountAppWithOverrides(
  sidebarStub: typeof SidebarWithRepoStub | typeof SidebarWithoutRepoStub,
  stubs: Record<string, unknown>,
) {
  vi.stubGlobal("__KANNA_MOBILE__", false);
  const { default: App } = await import("./App.vue");
  return mount(App, {
    global: {
      provide: {
        db: dbMock,
        dbName: "test.db",
        windowWorkspace: mockWindowWorkspace,
      },
      mocks: {
        $t: (key: string) => key,
      },
      stubs: {
        Sidebar: sidebarStub,
        MainPanel: true,
        AddRepoModal: true,
        KeyboardShortcutsModal: true,
        FilePickerModal: true,
        FilePreviewModal: true,
        TreeExplorerModal: true,
        DiffModal: true,
        CommitGraphModal: true,
        ShellModal: true,
        CommandPaletteModal: true,
        AnalyticsModal: true,
        BlockerSelectModal: true,
        PreferencesPanel: true,
        ToastContainer: true,
        KeepAlive: false,
        ...stubs,
      },
    },
  });
}

describe("App", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    store.init.mockClear();
    store.createItem.mockClear();
    store.recordIncomingTransfer.mockClear();
    store.approveIncomingTransfer.mockClear();
    store.rejectIncomingTransfer.mockClear();
    store.handleOutgoingTransferCommitted.mockClear();
    store.loadAgent.mockClear();
    store.repos = [{ id: "repo-1", path: "/tmp/repo", name: "repo" }];
    store.selectedRepoId = "repo-1";
    store.selectedRepo = { id: "repo-1", path: "/tmp/repo", name: "repo" };
    store.sortedItemsForCurrentRepo = [];
    store.sortedItemsAllRepos = [];
    listenHandlers.clear();
    capturedKeyboardActions = null;
    mockWindowWorkspace.loadSnapshot.mockClear();
    mockWindowWorkspace.saveSnapshot.mockClear();
    mockWindowWorkspace.openWindow.mockClear();
    mockWindowWorkspace.persistSelection.mockClear();
    mockWindowWorkspace.persistSidebarHidden.mockClear();
    mockWindowWorkspace.invalidateSharedData.mockClear();
    mockWindowWorkspace.restoreAdditionalWindows.mockClear();
    dbSelectMock.mockReset();
    dbSelectMock.mockResolvedValue([]);
    invokeMock.mockClear();
    toastInfoMock.mockClear();
    toastWarningMock.mockClear();
    appUpdateStartMock.mockClear();
    appUpdateMock.dispose.mockClear();
    appUpdateMock.dismiss.mockClear();
    appUpdateMock.install.mockClear();
    appUpdateMock.status.value = "available";
    appUpdateMock.visible = computed(() => true);
    invokeMock.mockImplementation(async (command: string, args?: { name?: string; repoPath?: string }) => {
      if (command === "list_dir") return ["default.json"];
      if (command === "read_text_file") return "";
      if (command === "git_default_branch") return "main";
      if (command === "git_list_base_branches") return ["feature/x", "main", "origin/main"];
      if (command === "read_env_var") return "/Users/test";
      if (command === "which_binary" && (args?.name === "claude" || args?.name === "codex")) return true;
      throw new Error(`unexpected invoke: ${command}`);
    });
  });

  it("prevents browser navigation when files are dragged over or dropped on the app shell", async () => {
    const wrapper = await mountApp(SidebarWithRepoStub);
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const dragOverEvent = new DragEvent("dragover", { cancelable: true });
    Object.defineProperty(dragOverEvent, "dataTransfer", {
      value: {
        files: [{ path: "/tmp/image.png", type: "image/png" }],
        types: ["Files"],
      },
    });

    const dropEvent = new DragEvent("drop", { cancelable: true });
    Object.defineProperty(dropEvent, "dataTransfer", {
      value: {
        files: [{ path: "/tmp/image.png", type: "image/png" }],
        types: ["Files"],
      },
    });

    window.dispatchEvent(dragOverEvent);
    window.dispatchEvent(dropEvent);

    expect(dragOverEvent.defaultPrevented).toBe(true);
    expect(dropEvent.defaultPrevented).toBe(true);

    wrapper.unmount();
  });

  it("does not suppress non-file drags on the app shell", async () => {
    const wrapper = await mountApp(SidebarWithRepoStub);
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const dragOverEvent = new DragEvent("dragover", { cancelable: true });
    Object.defineProperty(dragOverEvent, "dataTransfer", {
      value: {
        files: [],
        types: ["text/plain"],
      },
    });

    window.dispatchEvent(dragOverEvent);

    expect(dragOverEvent.defaultPrevented).toBe(false);

    wrapper.unmount();
  });

  it("renders the modal with the preferred existing base branch selected", async () => {
    const wrapper = await mountApp(SidebarWithRepoStub);

    await flushPromises();
    await wrapper.get('[data-testid="open-new-task"]').trigger("click");
    await flushPromises();
    await flushPromises();

    expect(wrapper.get('[data-testid="base-branch-value"]').text()).toBe("origin/main");
  });

  it("warns when Cmd+Shift+N is pressed without any repositories loaded", async () => {
    store.repos = [];
    store.selectedRepoId = null;
    store.selectedRepo = null;

    const wrapper = await mountApp(SidebarWithoutRepoStub);

    await flushPromises();
    expect(capturedKeyboardActions).not.toBeNull();

    capturedKeyboardActions?.newTask();
    await flushPromises();
    await flushPromises();

    expect(toastWarningMock).toHaveBeenCalledWith("toasts.noReposLoaded");
    expect(wrapper.find("textarea").exists()).toBe(false);

    wrapper.unmount();
  });

  it("submits undefined baseBranch when the resolved default branch was never explicitly changed", async () => {
    const wrapper = await mountApp(SidebarWithRepoStub);

    await flushPromises();
    await wrapper.get('[data-testid="open-new-task"]').trigger("click");
    await flushPromises();
    await flushPromises();

    await wrapper.get("textarea").setValue("Create default-base task");
    await wrapper.get("textarea").trigger("keydown", { key: "Enter", metaKey: true });
    await flushPromises();

    expect(store.createItem).toHaveBeenCalledWith(
      "repo-1",
      "/tmp/repo",
      "Create default-base task",
      "pty",
      expect.objectContaining({
        agentProvider: "claude",
        pipelineName: "default",
        baseBranch: undefined,
      }),
    );
  });

  it("does not pass an explicit fallback base branch when repo branch data was unresolved", async () => {
    store.selectedRepoId = null;
    store.selectedRepo = null;

    const wrapper = await mountApp(SidebarWithoutRepoStub);

    await flushPromises();
    await wrapper.get('[data-testid="open-new-task"]').trigger("click");
    await flushPromises();
    await flushPromises();

    expect(wrapper.get('[data-testid="base-branch-value"]').text()).toBe("main");

    await wrapper.get("textarea").setValue("Create unresolved task");
    await wrapper.get("textarea").trigger("keydown", { key: "Enter", metaKey: true });
    await flushPromises();

    expect(store.createItem).toHaveBeenCalledWith(
      "repo-1",
      "/tmp/repo",
      "Create unresolved task",
      "pty",
      expect.objectContaining({
        agentProvider: "claude",
        pipelineName: "default",
        baseBranch: undefined,
      }),
    );
  });
  it("skips blocked tasks when navigating to the oldest and newest read task", async () => {
    store.sortedItemsForCurrentRepo = [
      { id: "blocked-oldest", activity: "idle", created_at: "2026-03-31T00:00:00.000Z", tags: '["blocked"]' },
      { id: "read-oldest", activity: "idle", created_at: "2026-03-31T01:00:00.000Z", tags: "[]" },
      { id: "read-newest", activity: "idle", created_at: "2026-03-31T03:00:00.000Z", tags: "[]" },
      { id: "blocked-newest", activity: "idle", created_at: "2026-03-31T04:00:00.000Z", tags: '["blocked"]' },
    ];

    await mountApp(SidebarWithRepoStub);
    expect(capturedKeyboardActions).not.toBeNull();

    capturedKeyboardActions?.goToOldestRead();
    expect(store.selectItem).toHaveBeenCalledWith("read-oldest");

    store.selectItem.mockClear();
    capturedKeyboardActions?.goToNewestRead();
    expect(store.selectItem).toHaveBeenCalledWith("read-newest");
  });

  it("opens a new window through the workspace controller using the current selection", async () => {
    store.selectedRepoId = "repo-1";
    store.selectedItemId = "task-1";

    await mountApp(SidebarWithRepoStub);
    expect(capturedKeyboardActions).not.toBeNull();

    await capturedKeyboardActions?.newWindow();

    expect(mockWindowWorkspace.openWindow).toHaveBeenCalledWith({
      selectedRepoId: "repo-1",
      selectedItemId: "task-1",
    });
  });

  it("reopens the diff modal with the last saved diff view state", async () => {
    const DiffModalStub = defineComponent({
      name: "DiffModal",
      props: {
        initialScope: String,
        initialScrollPositions: Object,
      },
      emits: ["scope-change", "scroll-state-change", "close"],
      template: `
        <div data-testid="diff-modal">
          <span data-testid="diff-scope">{{ initialScope ?? '' }}</span>
          <span data-testid="diff-working-scroll">{{ initialScrollPositions?.working ?? '' }}</span>
          <button
            data-testid="remember-diff-state"
            @click="$emit('scope-change', 'branch'); $emit('scroll-state-change', { working: 240, branch: 520 })"
          >
            remember
          </button>
          <button data-testid="close-diff" @click="$emit('close')">close</button>
        </div>
      `,
    });

    vi.stubGlobal("__KANNA_MOBILE__", false);
    const { default: App } = await import("./App.vue");
    const wrapper = mount(App, {
      global: {
        provide: {
          db: dbMock,
          dbName: "test.db",
        },
        mocks: {
          $t: (key: string) => key,
        },
        stubs: {
          Sidebar: SidebarWithRepoStub,
          MainPanel: true,
          AddRepoModal: true,
          KeyboardShortcutsModal: true,
          FilePickerModal: true,
          FilePreviewModal: true,
          TreeExplorerModal: true,
          DiffModal: DiffModalStub,
          CommitGraphModal: true,
          ShellModal: true,
          CommandPaletteModal: true,
          AnalyticsModal: true,
          BlockerSelectModal: true,
          PreferencesPanel: true,
          ToastContainer: true,
          KeepAlive: false,
        },
      },
    });

    await flushPromises();
    expect(capturedKeyboardActions).not.toBeNull();

    capturedKeyboardActions?.showDiff();
    await flushPromises();

    expect(wrapper.get('[data-testid="diff-scope"]').text()).toBe("");

    await wrapper.get('[data-testid="remember-diff-state"]').trigger("click");
    await flushPromises();

    capturedKeyboardActions?.showDiff();
    await flushPromises();
    expect(wrapper.find('[data-testid="diff-modal"]').exists()).toBe(false);

    capturedKeyboardActions?.showDiff();
    await flushPromises();

    expect(wrapper.get('[data-testid="diff-scope"]').text()).toBe("branch");
    expect(wrapper.get('[data-testid="diff-working-scroll"]').text()).toBe("240");
  });
  it("starts the updater controller and renders the global update prompt", async () => {
    const wrapper = await mountApp(SidebarWithRepoStub);

    await flushPromises();

    expect(appUpdateStartMock).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-testid="update-install"]').text()).toBe("app.update.install");
    await wrapper.get('[data-testid="update-install"]').trigger("click");
    expect(appUpdateMock.install).toHaveBeenCalledTimes(1);
    await wrapper.get('[data-testid="update-dismiss"]').trigger("click");
    expect(appUpdateMock.dismiss).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    expect(appUpdateMock.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes the updater controller when the app unmounts", async () => {
    const wrapper = await mountApp(SidebarWithRepoStub);

    await flushPromises();
    wrapper.unmount();

    expect(appUpdateMock.dispose).toHaveBeenCalledTimes(1);
  });
  it("auto-imports an incoming transfer as soon as it is received", async () => {
    dbSelectMock.mockResolvedValue([]);
    const wrapper = await mountApp(SidebarWithRepoStub);

    await flushPromises();
    const handler = listenHandlers.get("transfer-request");
    expect(handler).toBeTypeOf("function");

    await handler?.(buildIncomingTransferEvent());
    await flushPromises();

    expect(store.recordIncomingTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        transferId: "transfer-1",
        sourcePeerId: "peer-source",
      }),
    );
    expect(store.approveIncomingTransfer).toHaveBeenCalledWith("transfer-1");
    expect(wrapper.text()).not.toContain("peer-source");
  });

  it("auto-imports any pending incoming transfer on mount", async () => {
    dbSelectMock.mockResolvedValue([
      {
        ...buildPendingIncomingTransferRow(),
        id: "transfer-db-1",
      },
    ]);

    const wrapper = await mountApp(SidebarWithRepoStub);
    await flushPromises();

    expect(store.approveIncomingTransfer).toHaveBeenCalledWith("transfer-db-1");
    expect(wrapper.text()).not.toContain("peer-source");
  });

  it("forwards outgoing transfer commit events to the store", async () => {
    await mountApp(SidebarWithRepoStub);
    await flushPromises();
    await flushPromises();

    const handler = listenHandlers.get("outgoing-transfer-committed");
    expect(handler).toBeTypeOf("function");

    await handler?.(buildOutgoingTransferCommittedEvent());
    await flushPromises();

    expect(store.handleOutgoingTransferCommitted).toHaveBeenCalledWith({
      transferId: "transfer-1",
      sourceTaskId: "task-source",
      destinationLocalTaskId: "task-imported",
    });
  });

  it("forwards outgoing transfer finalization requests to the store and completes them", async () => {
    await mountApp(SidebarWithRepoStub);
    await flushPromises();
    await flushPromises();

    const handler = listenHandlers.get("outgoing-transfer-finalization-requested");
    expect(handler).toBeTypeOf("function");

    await handler?.(buildOutgoingTransferFinalizationRequestedEvent());
    await flushPromises();

    expect(store.finalizeOutgoingTransfer).toHaveBeenCalledWith("transfer-1");
    expect(invokeMock).toHaveBeenCalledWith("complete_outgoing_transfer_finalization", {
      transferId: "transfer-1",
      payload: expect.any(Object),
      finalizedCleanly: true,
      error: null,
    });
  });

  it("shows the pairing verification code when another machine pairs with this one", async () => {
    const wrapper = await mountApp(SidebarWithRepoStub);
    await flushPromises();

    const handler = listenHandlers.get("pairing-completed");
    expect(handler).toBeTypeOf("function");

    await handler?.({
      type: "pairing_completed",
      peer_id: "peer-1",
      display_name: "Peer 1",
      verification_code: "654321",
    });
    await flushPromises();

    expect(toastInfoMock).toHaveBeenCalledWith(expect.stringContaining("654321"));
    wrapper.unmount();
  });

  it("adds Push to Machine to command palette commands for active tasks", async () => {
    store.currentItem = {
      id: "task-1",
      stage: "in progress",
      branch: "task-1",
      prompt: "Fix handoff",
      tags: "[]",
    };

    const CommandPaletteModalStub = defineComponent({
      name: "CommandPaletteModal",
      props: {
        dynamicCommands: {
          type: Array,
          default: () => [],
        },
      },
      setup(props) {
        const labels = computed(() =>
          (props.dynamicCommands as Array<{ label: string }>).map((command) => command.label).join("|"),
        );
        return { labels };
      },
      template: `
        <div data-testid="command-palette">
          {{ labels }}
        </div>
      `,
    });

    const wrapper = await mountAppWithOverrides(SidebarWithRepoStub, {
      CommandPaletteModal: CommandPaletteModalStub,
    });

    await flushPromises();
    expect(capturedKeyboardActions).not.toBeNull();

    capturedKeyboardActions?.commandPalette();
    await flushPromises();

    expect(wrapper.get('[data-testid="command-palette"]').text()).toContain("taskTransfer.pushToMachine");
  });

  it("adds Pair Machine to command palette commands independently of task transfer", async () => {
    store.currentItem = null;

    const CommandPaletteModalStub = defineComponent({
      name: "CommandPaletteModal",
      props: {
        dynamicCommands: {
          type: Array,
          default: () => [],
        },
      },
      setup(props) {
        const labels = computed(() =>
          (props.dynamicCommands as Array<{ label: string }>).map((command) => command.label).join("|"),
        );
        return { labels };
      },
      template: `
        <div data-testid="command-palette">
          {{ labels }}
        </div>
      `,
    });

    const wrapper = await mountAppWithOverrides(SidebarWithRepoStub, {
      CommandPaletteModal: CommandPaletteModalStub,
    });

    await flushPromises();
    expect(capturedKeyboardActions).not.toBeNull();

    capturedKeyboardActions?.commandPalette();
    await flushPromises();

    expect(wrapper.get('[data-testid="command-palette"]').text()).toContain("taskTransfer.pairPeer");
  });

  it("adds Create Config to command palette commands and launches a config-factory task", async () => {
    store.currentItem = null;

    const CommandPaletteModalStub = defineComponent({
      name: "CommandPaletteModal",
      props: {
        dynamicCommands: {
          type: Array,
          default: () => [],
        },
      },
      template: `
        <div data-testid="command-palette">
          <button
            v-for="command in dynamicCommands"
            :key="command.id"
            type="button"
            :data-command-id="command.id"
            :data-command-description="command.description"
            @click="command.execute()"
          >
            {{ command.label }}
          </button>
        </div>
      `,
    });

    const wrapper = await mountAppWithOverrides(SidebarWithRepoStub, {
      CommandPaletteModal: CommandPaletteModalStub,
    });

    await flushPromises();
    expect(capturedKeyboardActions).not.toBeNull();

    capturedKeyboardActions?.commandPalette();
    await flushPromises();

    const createConfigButton = wrapper.get('[data-command-id="create-config"]');
    expect(createConfigButton.text()).toBe("Create Config");
    expect(createConfigButton.attributes("data-command-description")).toBe("Create or update .kanna/config.json");

    await createConfigButton.trigger("click");
    await flushPromises();

    expect(store.loadAgent).toHaveBeenCalledWith("/tmp/repo", "config-factory");
    expect(store.createItem).toHaveBeenCalledWith(
      "repo-1",
      "/tmp/repo",
      "Help me create or update the .kanna/config.json for this repository.",
      "pty",
      expect.objectContaining({
        agentProvider: "codex",
        customTask: expect.objectContaining({
          agent: "config-factory",
          name: "Create Config",
          prompt: expect.stringContaining("https://schemas.kanna.build/config.schema.json"),
        }),
      }),
    );
  });

  it("keeps loading transfer peers until discovery has had time to warm up", async () => {
    vi.useFakeTimers();
    let listTransferPeersCalls = 0;
    invokeMock.mockImplementation(async (command: string, args?: { name?: string; repoPath?: string }) => {
      if (command === "list_dir") return ["default.json"];
      if (command === "read_text_file") return "";
      if (command === "git_default_branch") return "main";
      if (command === "git_list_base_branches") return ["feature/x", "main", "origin/main"];
      if (command === "read_env_var") return "/Users/test";
      if (command === "which_binary" && (args?.name === "claude" || args?.name === "codex")) return true;
      if (command === "list_transfer_peers") {
        listTransferPeersCalls += 1;
        if (listTransferPeersCalls < 9) return [];
        return [{
          peer_id: "peer-remote",
          display_name: "Desk",
          trusted: false,
          accepting_transfers: true,
        }];
      }
      throw new Error(`unexpected invoke: ${command}`);
    });

    const CommandPaletteModalStub = defineComponent({
      name: "CommandPaletteModal",
      props: {
        dynamicCommands: {
          type: Array,
          default: () => [],
        },
      },
      template: `
        <div data-testid="command-palette">
          <button
            v-for="command in dynamicCommands"
            :key="command.id"
            type="button"
            @click="command.execute()"
          >
            {{ command.label }}
          </button>
        </div>
      `,
    });

    const PeerPickerModalStub = defineComponent({
      name: "PeerPickerModal",
      props: {
        peers: {
          type: Array,
          default: () => [],
        },
        loading: Boolean,
      },
      template: `
        <div data-testid="peer-picker">
          <span data-testid="peer-picker-loading">{{ loading }}</span>
          <span data-testid="peer-picker-peers">{{ peers.map((peer) => peer.name).join("|") }}</span>
        </div>
      `,
    });

    const wrapper = await mountAppWithOverrides(SidebarWithRepoStub, {
      CommandPaletteModal: CommandPaletteModalStub,
      PeerPickerModal: PeerPickerModalStub,
    });

    await flushPromises();
    capturedKeyboardActions?.commandPalette();
    await flushPromises();

    const pairButton = wrapper.findAll('[data-testid="command-palette"] button')
      .find((button) => button.text() === "taskTransfer.pairPeer");
    expect(pairButton).toBeTruthy();

    await pairButton!.trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="peer-picker-loading"]').text()).toBe("true");
    expect(wrapper.get('[data-testid="peer-picker-peers"]').text()).toBe("");

    await vi.advanceTimersByTimeAsync(1500);
    await flushPromises();

    expect(wrapper.get('[data-testid="peer-picker-loading"]').text()).toBe("true");
    expect(wrapper.get('[data-testid="peer-picker-peers"]').text()).toBe("");

    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();

    expect(wrapper.get('[data-testid="peer-picker-loading"]').text()).toBe("false");
    expect(wrapper.get('[data-testid="peer-picker-peers"]').text()).toContain("Desk");

    vi.useRealTimers();
  });

  it("does not render the footer action bar for the current task view", async () => {
    store.currentItem = {
      id: "task-1",
      stage: "in progress",
      branch: "task-1",
      prompt: "Fix handoff",
      tags: "[]",
    };

    const wrapper = await mountApp(SidebarWithRepoStub);
    await flushPromises();

    expect(wrapper.find(".action-bar").exists()).toBe(false);
  });

  it("dismiss closes the entire file flow after preview-local dismiss is exhausted", async () => {
    vi.stubGlobal("__KANNA_MOBILE__", false);
    const { default: App } = await import("./App.vue");
    const wrapper = mount(App, {
      global: {
        provide: {
          db: dbMock,
          dbName: "test.db",
        },
        mocks: {
          $t: (key: string) => key,
        },
        stubs: {
          Sidebar: SidebarWithRepoStub,
          MainPanel: true,
          AddRepoModal: true,
          KeyboardShortcutsModal: true,
          FilePickerModal: FilePickerModalTestStub,
          FilePreviewModal: FilePreviewModalTestStub,
          TreeExplorerModal: true,
          DiffModal: true,
          CommitGraphModal: true,
          ShellModal: true,
          CommandPaletteModal: true,
          AnalyticsModal: true,
          BlockerSelectModal: true,
          PreferencesPanel: true,
          ToastContainer: true,
          KeepAlive: false,
        },
      },
    });

    await flushPromises();
    expect(capturedKeyboardActions).not.toBeNull();

    capturedKeyboardActions?.openFile();
    await flushPromises();
    expect(wrapper.find('[data-testid="file-picker-modal"]').exists()).toBe(true);

    await wrapper.get('[data-testid="file-picker-select"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="file-preview-modal"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="file-picker-modal"]').exists()).toBe(false);

    const handled = capturedKeyboardActions?.dismiss();
    await flushPromises();

    expect(handled).toBe(true);
    expect(wrapper.find('[data-testid="file-preview-modal"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="file-picker-modal"]').exists()).toBe(false);
  });

  it("recalls the last previewed file with the file preview shortcut after dismissal", async () => {
    vi.stubGlobal("__KANNA_MOBILE__", false);
    const { default: App } = await import("./App.vue");
    const wrapper = mount(App, {
      global: {
        provide: {
          db: dbMock,
          dbName: "test.db",
        },
        mocks: {
          $t: (key: string) => key,
        },
        stubs: {
          Sidebar: SidebarWithRepoStub,
          MainPanel: true,
          AddRepoModal: true,
          KeyboardShortcutsModal: true,
          FilePickerModal: FilePickerModalTestStub,
          FilePreviewModal: FilePreviewModalTestStub,
          TreeExplorerModal: true,
          DiffModal: true,
          CommitGraphModal: true,
          ShellModal: true,
          CommandPaletteModal: true,
          AnalyticsModal: true,
          BlockerSelectModal: true,
          PreferencesPanel: true,
          ToastContainer: true,
          KeepAlive: false,
        },
      },
    });

    await flushPromises();
    expect(capturedKeyboardActions).not.toBeNull();

    capturedKeyboardActions?.openFile();
    await flushPromises();
    await wrapper.get('[data-testid="file-picker-select"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="file-preview-modal"]').exists()).toBe(true);

    capturedKeyboardActions?.dismiss();
    await flushPromises();

    expect(wrapper.find('[data-testid="file-preview-modal"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="file-picker-modal"]').exists()).toBe(false);

    capturedKeyboardActions?.toggleFilePreview();
    await flushPromises();

    expect(wrapper.find('[data-testid="file-preview-modal"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="file-picker-modal"]').exists()).toBe(false);
  });

  it("opens the file picker over the file preview and dismisses the picker first", async () => {
    vi.stubGlobal("__KANNA_MOBILE__", false);
    const { default: App } = await import("./App.vue");
    const wrapper = mount(App, {
      global: {
        provide: {
          db: dbMock,
          dbName: "test.db",
        },
        mocks: {
          $t: (key: string) => key,
        },
        stubs: {
          Sidebar: SidebarWithRepoStub,
          MainPanel: true,
          AddRepoModal: true,
          KeyboardShortcutsModal: true,
          FilePickerModal: FilePickerModalTestStub,
          FilePreviewModal: FilePreviewModalTestStub,
          TreeExplorerModal: true,
          DiffModal: true,
          CommitGraphModal: true,
          ShellModal: true,
          CommandPaletteModal: true,
          AnalyticsModal: true,
          BlockerSelectModal: true,
          PreferencesPanel: true,
          ToastContainer: true,
          KeepAlive: false,
        },
      },
    });

    await flushPromises();
    expect(capturedKeyboardActions).not.toBeNull();

    capturedKeyboardActions?.openFile();
    await flushPromises();
    await wrapper.get('[data-testid="file-picker-select"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="file-preview-modal"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="file-picker-modal"]').exists()).toBe(false);

    capturedKeyboardActions?.openFile();
    await flushPromises();

    expect(wrapper.find('[data-testid="file-preview-modal"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="file-picker-modal"]').exists()).toBe(true);

    const handled = capturedKeyboardActions?.dismiss();
    await flushPromises();

    expect(handled).toBe(true);
    expect(wrapper.find('[data-testid="file-preview-modal"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="file-picker-modal"]').exists()).toBe(false);
  });

  it("dismiss closes commit graph search before closing the commit graph modal", async () => {
    const dismissMock = vi.fn(() => false);
    const CommitGraphModalTestStub = defineComponent({
      setup(_props, { expose }) {
        expose({
          dismiss: dismissMock,
          zIndex: 1,
          bringToFront: vi.fn(),
        });
        return () => h("div", { "data-testid": "commit-graph-modal" });
      },
    });

    const wrapper = await mountAppWithOverrides(SidebarWithRepoStub, {
      CommitGraphModal: CommitGraphModalTestStub,
    });
    await flushPromises();
    expect(capturedKeyboardActions).not.toBeNull();

    capturedKeyboardActions?.showCommitGraph();
    await flushPromises();

    expect(wrapper.find('[data-testid="commit-graph-modal"]').exists()).toBe(true);

    const handled = capturedKeyboardActions?.dismiss();
    await flushPromises();

    expect(handled).toBe(true);
    expect(dismissMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="commit-graph-modal"]').exists()).toBe(true);
  });

  it("passes maximize state through to the tree explorer modal", async () => {
    const wrapper = await mountAppWithOverrides(SidebarWithRepoStub, {
      TreeExplorerModal: TreeExplorerModalTestStub,
    });

    await flushPromises();
    expect(capturedKeyboardActions).not.toBeNull();

    capturedKeyboardActions?.toggleTreeExplorer();
    await flushPromises();

    expect(wrapper.get('[data-testid="tree-explorer-modal"]').attributes("data-maximized")).toBe("false");

    capturedKeyboardActions?.toggleMaximize();
    await flushPromises();

    expect(wrapper.get('[data-testid="tree-explorer-modal"]').attributes("data-maximized")).toBe("true");
  });

  it("clears tree explorer maximize state when the modal closes", async () => {
    const TreeExplorerClosableStub = defineComponent({
      name: "TreeExplorerModal",
      props: {
        maximized: Boolean,
      },
      emits: ["close"],
      template: `
        <div data-testid="tree-explorer-modal" :data-maximized="String(maximized)">
          <button data-testid="close-tree-explorer" @click="$emit('close')">close</button>
        </div>
      `,
    });

    const wrapper = await mountAppWithOverrides(SidebarWithRepoStub, {
      TreeExplorerModal: TreeExplorerClosableStub,
    });

    await flushPromises();
    expect(capturedKeyboardActions).not.toBeNull();

    capturedKeyboardActions?.toggleTreeExplorer();
    await flushPromises();
    capturedKeyboardActions?.toggleMaximize();
    await flushPromises();

    expect(wrapper.get('[data-testid="tree-explorer-modal"]').attributes("data-maximized")).toBe("true");

    await wrapper.get('[data-testid="close-tree-explorer"]').trigger("click");
    await flushPromises();
    capturedKeyboardActions?.toggleTreeExplorer();
    await flushPromises();

    expect(wrapper.get('[data-testid="tree-explorer-modal"]').attributes("data-maximized")).toBe("false");
  });
});
