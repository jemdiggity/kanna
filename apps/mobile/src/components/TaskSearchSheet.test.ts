import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import TaskSearchSheet from "./TaskSearchSheet.vue";

const tasks = [
  {
    id: "task-1",
    repo_id: "repo-1",
    title: "Mobile UI polish",
    repoName: "Kanna",
    stage: "in progress",
    branch: null,
    displayName: "Mobile UI polish",
    prompt: "Improve the mobile app UI",
    prNumber: null,
    pinned: false,
    pinOrder: null,
    updatedAt: "2026-04-16T10:00:00Z",
    createdAt: "2026-04-16T09:00:00Z",
    lastOutputPreview: "Updated task rows",
  },
  {
    id: "task-2",
    repo_id: "repo-2",
    title: "Relay auth fix",
    repoName: "Relay",
    stage: "pr",
    branch: null,
    displayName: "Relay auth fix",
    prompt: "Fix relay auth flow",
    prNumber: null,
    pinned: false,
    pinOrder: null,
    updatedAt: "2026-04-16T08:00:00Z",
    createdAt: "2026-04-16T07:00:00Z",
    lastOutputPreview: "Opened PR",
  },
];

describe("TaskSearchSheet", () => {
  it("filters tasks by title and repo name", async () => {
    const wrapper = mount(TaskSearchSheet, {
      props: {
        visible: true,
        tasks,
      },
    });

    await wrapper.get("input").setValue("relay");

    expect(wrapper.text()).toContain("Relay auth fix");
    expect(wrapper.text()).not.toContain("Mobile UI polish");
  });

  it("emits the selected task when a result is tapped", async () => {
    const wrapper = mount(TaskSearchSheet, {
      props: {
        visible: true,
        tasks,
      },
    });

    await wrapper.get("input").setValue("mobile");
    await wrapper.get("[data-task-id='task-1']").trigger("click");

    expect(wrapper.emitted("select")).toEqual([[tasks[0]]]);
  });
});
