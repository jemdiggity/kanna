// @vitest-environment happy-dom

import type { PipelineItem, Repo } from "@kanna/db";
import { mount } from "@vue/test-utils";
import { h, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Sidebar from "../Sidebar.vue";

const getStageOrder = vi.fn();

function translate(key: string, params?: Record<string, string>) {
  if (key === "sidebar.noTasksMatching") {
    return `No tasks match "${params?.query ?? ""}"`;
  }
  if (key === "sidebar.noTasks") {
    return "No tasks";
  }
  return key;
}

vi.mock("../../stores/kanna", () => ({
  useKannaStore: () => ({
    getStageOrder,
  }),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: translate,
  }),
}));

const draggableStub = {
  props: ["modelValue", "class", "disabled"],
  setup(
    props: { modelValue: PipelineItem[]; class?: string; disabled?: boolean },
    { slots }: { slots: { item?: (scope: { element: PipelineItem }) => unknown } },
  ) {
    return () => h(
      "div",
      { class: props.class, "data-disabled": String(Boolean(props.disabled)) },
      (props.modelValue ?? []).map((element) => slots.item?.({ element })),
    );
  },
};

function flushPromises() {
  return Promise.resolve().then(() => nextTick());
}

const repo: Repo = {
  id: "repo-1",
  path: "/repo",
  name: "kanna-v2",
  default_branch: "main",
  hidden: 0,
  created_at: "2026-01-01T00:00:00.000Z",
  last_opened_at: "2026-01-01T00:00:00.000Z",
};

function item(id: string, overrides: Partial<PipelineItem>): PipelineItem {
  const base: PipelineItem = {
    id,
    repo_id: repo.id,
    issue_number: null,
    issue_title: null,
    prompt: null,
    pipeline: "default",
    stage: "in progress",
    stage_result: null,
    tags: "[]",
    pr_number: null,
    pr_url: null,
    branch: null,
    closed_at: null,
    agent_type: null,
    agent_provider: "claude",
    claude_session_id: null,
    activity: "idle",
    activity_changed_at: null,
    unread_at: null,
    port_offset: null,
    display_name: null,
    port_env: null,
    pinned: 0,
    pin_order: null,
    base_ref: null,
    previous_stage: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  return {
    ...base,
    ...overrides,
  };
}

function mountSidebar(pipelineItems: PipelineItem[], selectedItemId: string | null = "task-1") {
  return mount(Sidebar, {
    props: {
      repos: [repo],
      pipelineItems,
      selectedRepoId: repo.id,
      selectedItemId,
      blockerNames: {},
    },
    global: {
      stubs: {
        transition: {
          template: "<div><slot /></div>",
        },
        "transition-group": {
          template: "<div><slot /></div>",
        },
        draggable: draggableStub,
      },
      mocks: {
        $t: translate,
      },
    },
  });
}

describe("Sidebar", () => {
  beforeEach(() => {
    getStageOrder.mockReturnValue(["in progress", "pr", "merge"]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    getStageOrder.mockReset();
    getStageOrder.mockReturnValue(["in progress", "pr", "merge"]);
  });

  it("switches the sidebar into a filtered visual state and shows filtered repo counts", async () => {
    const pipelineItems = [
      item("task-1", {
        prompt: "Fix sidebar search visibility",
        display_name: "Sidebar visibility fix",
        branch: "task-1",
        created_at: "2026-04-13 00:00:00",
        updated_at: "2026-04-13 00:00:00",
        activity_changed_at: "2026-04-13 00:00:00",
      }),
      item("task-2", {
        prompt: "Refine merge queue behavior",
        display_name: "Merge queue polish",
        branch: "task-2",
        stage: "pr",
        created_at: "2026-04-13 00:00:00",
        updated_at: "2026-04-13 00:00:00",
        activity_changed_at: "2026-04-13 00:00:00",
      }),
    ];

    const wrapper = mountSidebar(pipelineItems);

    await wrapper.get(".search-input").setValue("visibility");

    expect(wrapper.get(".sidebar").classes()).toContain("is-filtering");
    expect(wrapper.get(".repo-count").text()).toBe("1/2");
    expect(wrapper.get(".repo-name").classes()).toContain("filtered-label");
    expect(wrapper.get(".section-label").classes()).toContain("filtered-label");
    expect(wrapper.text()).not.toContain('Filtering tasks: "visibility"');
  });

  it("shows a search-aware empty state when no tasks match the search query", async () => {
    const pipelineItems = [
      item("task-1", {
        prompt: "Fix sidebar search visibility",
        display_name: "Sidebar visibility fix",
        branch: "task-1",
      }),
      item("task-2", {
        prompt: "Refine merge queue behavior",
        display_name: "Merge queue polish",
        branch: "task-2",
        stage: "pr",
      }),
    ];

    const wrapper = mountSidebar(pipelineItems);

    await wrapper.get(".search-input").setValue("does-not-match");

    expect(wrapper.text()).toContain('No tasks match "does-not-match"');
    expect(wrapper.text()).not.toContain("No tasks\n");
  });

  it("keeps created_at ordering when search is empty and uses search score ordering when query exists", async () => {
    const pipelineItems = [
      item("task-1", {
        display_name: "Task checklist",
        created_at: "2026-01-01T11:00:00.000Z",
      }),
      item("task-2", {
        display_name: "Other note",
        created_at: "2026-01-01T09:00:00.000Z",
      }),
      item("task-3", {
        display_name: "task",
        created_at: "2026-01-01T10:00:00.000Z",
      }),
    ];

    const wrapper = mountSidebar(pipelineItems, null);

    await flushPromises();
    await flushPromises();

    const vm = wrapper.vm as {
      matchesSearch(item: PipelineItem): boolean;
    };

    expect(wrapper.findAll(".pipeline-item .item-title").map((el) => el.text())).toEqual([
      "Task checklist",
      "task",
      "Other note",
    ]);

    await wrapper.get(".search-input").setValue("task");
    await nextTick();

    expect(wrapper.findAll(".pipeline-item .item-title").map((el) => el.text())).toEqual([
      "task",
      "Task checklist",
    ]);
    expect(vm.matchesSearch(pipelineItems[0])).toBe(true);
    expect(vm.matchesSearch(pipelineItems[2])).toBe(true);
    expect(vm.matchesSearch(pipelineItems[1])).toBe(false);
  });

  it("disables pinned drag interactions while search is active", async () => {
    const pipelineItems = [
      item("task-1", {
        display_name: "Task checklist",
        pinned: 1,
        pin_order: 0,
        created_at: "2026-01-01T11:00:00.000Z",
      }),
      item("task-2", {
        display_name: "Other note",
        pinned: 1,
        pin_order: 1,
        created_at: "2026-01-01T10:00:00.000Z",
      }),
    ];

    const wrapper = mountSidebar(pipelineItems, null);

    await flushPromises();
    await flushPromises();

    const vm = wrapper.vm as {
      onPinnedChange(repoId: string, evt: { moved?: { oldIndex: number; newIndex: number } }): void;
    };

    expect(wrapper.get(".pinned-zone").attributes("data-disabled")).toBe("false");

    await wrapper.get(".search-input").setValue("task");
    await nextTick();

    expect(wrapper.get(".pinned-zone").attributes("data-disabled")).toBe("true");

    vm.onPinnedChange(repo.id, { moved: { oldIndex: 0, newIndex: 0 } });

    expect(wrapper.emitted("reorder-pinned")).toBeUndefined();
  });
});
