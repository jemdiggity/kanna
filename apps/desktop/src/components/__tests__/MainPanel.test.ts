// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("MainPanel", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("__KANNA_MOBILE__", false);
    localStorage.clear();
  });

  it("shows a dismissible command hint at the bottom even without repos or tasks and keeps it hidden after dismissal", async () => {
    const { default: MainPanel } = await import("../MainPanel.vue");

    const mountPanel = () => mount(MainPanel, {
      props: {
        item: null,
        hasRepos: false,
      },
      global: {
        mocks: {
          $t: (key: string) =>
            key === "mainPanel.commandHintPrefix"
              ? "Use"
              : key === "mainPanel.commandHintSuffix"
                ? "to see available commands."
                : key === "actions.dismiss"
                  ? "Dismiss"
                  : key,
        },
        stubs: {
          TaskHeader: { template: '<div data-testid="task-header" />' },
          TerminalTabs: { template: '<div data-testid="terminal-tabs" />' },
        },
      },
    });

    const wrapper = mountPanel();

    expect(wrapper.find('[data-testid="terminal-tabs"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="command-hint"]').text().replace(/\s+/g, "")).toContain("Use⌘/toseeavailablecommands.");
    expect(wrapper.findAll('[data-testid="command-hint"] kbd')).toHaveLength(2);

    await wrapper.get('[data-testid="command-hint-dismiss"]').trigger("click");

    expect(wrapper.find('[data-testid="command-hint"]').exists()).toBe(false);
    expect(localStorage.getItem("kanna:hide-command-hint")).toBe("1");

    wrapper.unmount();

    const remounted = mountPanel();

    expect(remounted.find('[data-testid="command-hint"]').exists()).toBe(false);
  });
});
