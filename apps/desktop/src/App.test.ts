// @vitest-environment happy-dom

import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

async function flushPromises() {
  await Promise.resolve();
  await nextTick();
}

const store = {
  repos: [{ id: "repo-1", path: "/tmp/repo", name: "repo" }],
  items: [],
  selectedRepoId: "repo-1",
  selectedItemId: null,
  selectedRepo: { id: "repo-1", path: "/tmp/repo", name: "repo" },
  currentItem: null,
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

vi.mock("./stores/kanna", () => ({
  useKannaStore: () => store,
}));

vi.mock("./invoke", () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === "list_dir") return ["default.json"];
    if (command === "read_text_file") return "";
    if (command === "git_default_branch") return "main";
    if (command === "git_list_base_branches") return ["feature/x", "main", "origin/main"];
    if (command === "read_env_var") return "/Users/test";
    return [];
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
  useKeyboardShortcuts: vi.fn(),
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
}));

const SidebarStub = defineComponent({
  name: "Sidebar",
  emits: ["new-task"],
  template: '<button data-testid="open-new-task" @click="$emit(\'new-task\', \'repo-1\')">open</button>',
});

const NewTaskModalStub = defineComponent({
  name: "NewTaskModal",
  props: {
    defaultBaseBranch: { type: String, default: "" },
  },
  template: '<div data-testid="modal-default-base-branch">{{ defaultBaseBranch }}</div>',
});

describe("App", () => {
  beforeEach(() => {
    store.init.mockClear();
    store.selectedRepoId = "repo-1";
  });

  it("passes the preferred existing base branch to the new task modal", async () => {
    vi.stubGlobal("__KANNA_MOBILE__", false);
    const { default: App } = await import("./App.vue");
    const wrapper = mount(App, {
      global: {
        provide: {
          db: {},
          dbName: "test.db",
        },
        stubs: {
          Sidebar: SidebarStub,
          MainPanel: true,
          NewTaskModal: NewTaskModalStub,
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

    await flushPromises();
    await wrapper.get('[data-testid="open-new-task"]').trigger("click");
    await flushPromises();
    await flushPromises();

    expect(wrapper.get('[data-testid="modal-default-base-branch"]').text()).toBe("origin/main");
  });
});
