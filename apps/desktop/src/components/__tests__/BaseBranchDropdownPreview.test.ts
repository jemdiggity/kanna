// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, it } from "vitest";
import BaseBranchDropdownPreview from "../BaseBranchDropdownPreview.vue";

async function flushPromises() {
  await Promise.resolve();
  await nextTick();
}

describe("BaseBranchDropdownPreview", () => {
  it("opens a compact dropdown with a fixed scroll height instead of expanding the page", async () => {
    const wrapper = mount(BaseBranchDropdownPreview, {
      props: {
        defaultBranchName: "main",
        baseBranches: [
          "origin/main",
          "main",
          "feature/agent-terminal-redraw",
          "feature/sidebar-metrics",
          "feature/task-list-density",
          "feature/base-branch-dropdown",
          "feature/worktree-cleanup",
          "feature/command-palette-filtering",
          "fix/shell-reconnect",
          "fix/dropdown-overflow",
          "release/2026.04",
        ],
      },
    });

    await wrapper.get('[data-testid="base-branch-dropdown-trigger"]').trigger("click");

    const options = wrapper.get('[data-testid="base-branch-options"]');
    expect(wrapper.get('[data-testid="base-branch-search"]').exists()).toBe(true);
    expect(options.attributes("style")).toContain("max-height");
  });

  it("updates the selected branch from the dropdown search results", async () => {
    const wrapper = mount(BaseBranchDropdownPreview, {
      props: {
        defaultBranchName: "main",
        baseBranches: [
          "origin/main",
          "main",
          "feature/base-branch-dropdown",
          "fix/dropdown-overflow",
          "release/2026.04",
        ],
      },
    });

    await wrapper.get('[data-testid="base-branch-dropdown-trigger"]').trigger("click");
    await wrapper.get('[data-testid="base-branch-search"]').setValue("release");
    await flushPromises();
    await wrapper.get('[data-testid="base-branch-search"]').trigger("keydown", { key: "Enter" });

    expect(wrapper.get('[data-testid="selected-base-branch"]').text()).toContain("release/2026.04");
    expect(wrapper.find('[data-testid="base-branch-dropdown"]').exists()).toBe(false);
  });

  it("does not use an arbitrary feature branch as the default selection", async () => {
    const wrapper = mount(BaseBranchDropdownPreview, {
      props: {
        defaultBranchName: "main",
        baseBranches: ["feature/a", "feature/b"],
      },
    });

    expect(wrapper.get('[data-testid="selected-base-branch"]').text()).toBe("");
  });
});
