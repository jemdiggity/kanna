import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CommandPaletteSheet from "./CommandPaletteSheet.vue";

describe("CommandPaletteSheet", () => {
  it("shows global commands when no task is selected", () => {
    const wrapper = mount(CommandPaletteSheet, {
      props: {
        visible: true,
        title: "More",
        commands: [{ id: "new-task", label: "New Task" }],
      },
    });

    expect(wrapper.text()).toContain("More");
    expect(wrapper.text()).toContain("New Task");
  });

  it("shows task-aware commands when a task is open", () => {
    const wrapper = mount(CommandPaletteSheet, {
      props: {
        visible: true,
        title: "Task Actions",
        commands: [{ id: "promote-stage", label: "Promote Stage" }],
      },
    });

    expect(wrapper.text()).toContain("Task Actions");
    expect(wrapper.text()).toContain("Promote Stage");
  });
});
