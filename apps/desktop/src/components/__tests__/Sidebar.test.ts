// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import Sidebar from "../Sidebar.vue";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === "sidebar.noTasksMatching") {
        return `No tasks match "${params?.query ?? ""}"`;
      }
      if (key === "sidebar.noTasks") {
        return "No tasks";
      }
      return key;
    },
  }),
}));

vi.mock("../../stores/kanna", () => ({
  useKannaStore: () => ({
    getStageOrder: () => ["merge", "pr", "in progress"],
  }),
}));

const draggableStub = {
  props: ["modelValue", "itemKey"],
  template: `
    <div>
      <slot
        v-for="element in modelValue"
        name="item"
        :element="element"
        :key="element[itemKey]"
      />
    </div>
  `,
};

const repos = [
  {
    id: "repo-1",
    name: "kanna-v2",
    path: "/repo",
    default_branch: "main",
    hidden: 0,
    created_at: "2026-04-13 00:00:00",
    last_opened_at: null,
  },
];

const pipelineItems = [
  {
    id: "task-1",
    repo_id: "repo-1",
    issue_number: null,
    issue_title: null,
    prompt: "Fix sidebar search visibility",
    pipeline: "default",
    stage: "in progress",
    stage_result: null,
    tags: "[]",
    pr_number: null,
    pr_url: null,
    branch: "task-1",
    agent_type: "pty",
    agent_provider: "claude",
    claude_session_id: null,
    port_offset: null,
    port_env: null,
    activity: "idle",
    activity_changed_at: "2026-04-13 00:00:00",
    display_name: "Sidebar visibility fix",
    unread_at: null,
    closed_at: null,
    base_ref: null,
    previous_stage: null,
    pinned: 0,
    pin_order: null,
    created_at: "2026-04-13 00:00:00",
    updated_at: "2026-04-13 00:00:00",
  },
  {
    id: "task-2",
    repo_id: "repo-1",
    issue_number: null,
    issue_title: null,
    prompt: "Refine merge queue behavior",
    pipeline: "default",
    stage: "pr",
    stage_result: null,
    tags: "[]",
    pr_number: null,
    pr_url: null,
    branch: "task-2",
    agent_type: "pty",
    agent_provider: "claude",
    claude_session_id: null,
    port_offset: null,
    port_env: null,
    activity: "idle",
    activity_changed_at: "2026-04-13 00:00:00",
    display_name: "Merge queue polish",
    unread_at: null,
    closed_at: null,
    base_ref: null,
    previous_stage: null,
    pinned: 0,
    pin_order: null,
    created_at: "2026-04-13 00:00:00",
    updated_at: "2026-04-13 00:00:00",
  },
];

function mountSidebar() {
  const translate = (key: string, params?: Record<string, string>) => {
    if (key === "sidebar.noTasksMatching") {
      return `No tasks match "${params?.query ?? ""}"`;
    }
    if (key === "sidebar.noTasks") {
      return "No tasks";
    }
    return key;
  };

  return mount(Sidebar, {
    props: {
      repos,
      pipelineItems,
      selectedRepoId: "repo-1",
      selectedItemId: "task-1",
      blockerNames: {},
    },
    global: {
      stubs: {
        draggable: draggableStub,
      },
      mocks: {
        $t: translate,
      },
    },
  });
}

describe("Sidebar", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("switches the sidebar into a filtered visual state and shows filtered repo counts", async () => {
    const wrapper = mountSidebar();

    await wrapper.get(".search-input").setValue("visibility");

    expect(wrapper.get(".sidebar").classes()).toContain("is-filtering");
    expect(wrapper.get(".repo-count").text()).toBe("1/2");
    expect(wrapper.get(".repo-name").classes()).toContain("filtered-label");
    expect(wrapper.get(".section-label").classes()).toContain("filtered-label");
    expect(wrapper.text()).not.toContain('Filtering tasks: "visibility"');
  });

  it("shows a search-aware empty state when no tasks match the search query", async () => {
    const wrapper = mountSidebar();

    await wrapper.get(".search-input").setValue("does-not-match");

    expect(wrapper.text()).toContain('No tasks match "does-not-match"');
    expect(wrapper.text()).not.toContain("No tasks\n");
  });
});
