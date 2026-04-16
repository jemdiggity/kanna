import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import RecentScreen from "./RecentScreen.vue";

describe("RecentScreen", () => {
  it("renders cross-repo rows with repo context and preview text", () => {
    const wrapper = mount(RecentScreen, {
      props: {
        tasks: [
          {
            id: "task-1",
            repo_id: "repo-1",
            title: "Mobile UI",
            repoName: "Kanna",
            stage: "pr",
            branch: null,
            displayName: null,
            prompt: null,
            prNumber: 42,
            pinned: false,
            pinOrder: null,
            updatedAt: "2026-04-16T10:00:00Z",
            createdAt: "2026-04-16T09:00:00Z",
            lastOutputPreview: "Opened PR",
          },
        ],
      },
    });

    expect(wrapper.text()).toContain("Kanna");
    expect(wrapper.text()).toContain("Mobile UI");
    expect(wrapper.text()).toContain("pr");
    expect(wrapper.text()).toContain("Opened PR");
  });
});
