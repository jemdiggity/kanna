import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import TaskScreen from "./TaskScreen.vue";

describe("TaskScreen", () => {
  it("shows task title, repo name, and stage above the terminal", () => {
    const wrapper = mount(TaskScreen, {
      props: {
        task: {
          id: "task-1",
          repo_id: "repo-1",
          title: "Mobile UI",
          repoName: "Kanna",
          stage: "in progress",
          branch: null,
          displayName: null,
          prompt: null,
          prNumber: null,
          pinned: false,
          pinOrder: null,
          updatedAt: "2026-04-16T10:00:00Z",
          createdAt: "2026-04-16T09:00:00Z",
          lastOutputPreview: "Updated rows",
        },
      },
      global: {
        stubs: {
          TerminalView: {
            template: "<div class='terminal-stub'>terminal</div>",
          },
        },
      },
    });

    expect(wrapper.text()).toContain("Mobile UI");
    expect(wrapper.text()).toContain("Kanna");
    expect(wrapper.text()).toContain("in progress");
    expect(wrapper.text()).toContain("terminal");
  });
});
