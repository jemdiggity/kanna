// @vitest-environment happy-dom

import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyboardActions } from "./composables/useKeyboardShortcuts";

async function flushPromises() {
  await Promise.resolve();
  await nextTick();
}

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
  listBlockedByItem: vi.fn(async () => []),
  listBlockersForItem: vi.fn(async () => []),
  blockTask: vi.fn(async () => {}),
  editBlockedTask: vi.fn(async () => {}),
  createRepo: vi.fn(async () => {}),
  importRepo: vi.fn(async () => {}),
  cloneAndImportRepo: vi.fn(async () => {}),
  savePreference: vi.fn(async () => {}),
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
};

let capturedKeyboardActions: KeyboardActions | null = null;

const invokeMock = vi.fn(async (command: string, args?: { name?: string; repoPath?: string }) => {
  if (command === "list_dir") return ["default.json"];
  if (command === "read_text_file") return "";
  if (command === "git_default_branch") return "main";
  if (command === "git_list_base_branches") return ["feature/x", "main", "origin/main"];
  if (command === "read_env_var") return "/Users/test";
  if (command === "which_binary" && (args?.name === "claude" || args?.name === "codex")) return true;
  throw new Error(`unexpected invoke: ${command}`);
});

vi.mock("./stores/kanna", () => ({
  useKannaStore: () => store,
}));

vi.mock("./invoke", () => ({
  invoke: (command: string, args?: { name?: string; repoPath?: string }) => invokeMock(command, args),
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
    tasks: [],
    scan: vi.fn(async () => []),
  }),
}));

vi.mock("./composables/useToast", () => ({
  useToast: () => ({
    error: vi.fn(),
    warning: vi.fn(),
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

async function mountApp(sidebarStub: typeof SidebarWithRepoStub | typeof SidebarWithoutRepoStub) {
  vi.stubGlobal("__KANNA_MOBILE__", false);
  const { default: App } = await import("./App.vue");
  return mount(App, {
    global: {
      provide: {
        db: {},
        dbName: "test.db",
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

describe("App", () => {
  beforeEach(() => {
    store.init.mockClear();
    store.createItem.mockClear();
    store.selectedRepoId = "repo-1";
    store.selectedRepo = { id: "repo-1", path: "/tmp/repo", name: "repo" };
    store.sortedItemsForCurrentRepo = [];
    store.sortedItemsAllRepos = [];
    capturedKeyboardActions = null;
    invokeMock.mockClear();
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

  it("renders the modal with the preferred existing base branch selected", async () => {
    const wrapper = await mountApp(SidebarWithRepoStub);

    await flushPromises();
    await wrapper.get('[data-testid="open-new-task"]').trigger("click");
    await flushPromises();
    await flushPromises();

    expect(wrapper.get('[data-testid="base-branch-value"]').text()).toBe("origin/main");
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
});
