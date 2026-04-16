import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import TasksScreen from "./TasksScreen.vue";

describe("TasksScreen", () => {
  it("renders repo sections with stage and preview text", () => {
    const wrapper = mount(TasksScreen, {
      props: {
        groups: [
          {
            repoId: "repo-1",
            repoName: "Kanna",
            tasks: [
              {
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
            ],
          },
        ],
      },
    });

    expect(wrapper.text()).toContain("Kanna");
    expect(wrapper.text()).toContain("Mobile UI");
    expect(wrapper.text()).toContain("in progress");
    expect(wrapper.text()).toContain("Updated rows");
  });
});
