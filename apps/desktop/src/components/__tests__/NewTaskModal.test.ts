// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import NewTaskModal from "../NewTaskModal.vue";
import { clearContextShortcuts, getContextShortcuts } from "../../composables/useShortcutContext";

async function flushPromises() {
  await Promise.resolve();
  await nextTick();
}

vi.mock("../../invoke", () => ({
  invoke: vi.fn(async (command: string, args?: { name?: string }) => {
    if (command === "which_binary" && (args?.name === "claude" || args?.name === "codex")) {
      return true;
    }
    throw new Error("missing");
  }),
}));

describe("NewTaskModal", () => {
  afterEach(() => {
    clearContextShortcuts("newTask");
  });

  it("shows only the selected provider name and updates it when cycling", async () => {
    const wrapper = mount(NewTaskModal, {
      props: { defaultAgentProvider: "claude" },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    await flushPromises();
    await flushPromises();

    expect(wrapper.text()).toContain("Claude");
    expect(wrapper.findAll(".agent-provider")).toHaveLength(1);

    await wrapper.find("textarea").trigger("keydown", {
      key: "]",
      metaKey: true,
      shiftKey: true,
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Codex");
    expect(wrapper.findAll(".agent-provider")).toHaveLength(1);
  });

  it("cycles forward when the agent indicator is clicked", async () => {
    const wrapper = mount(NewTaskModal, {
      props: { defaultAgentProvider: "claude" },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    await flushPromises();
    await flushPromises();

    expect(wrapper.text()).toContain("Claude");

    await wrapper.get(".agent-provider").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Codex");
  });

  it("prevents mouse down default on the agent indicator so focus stays on the prompt", async () => {
    const wrapper = mount(NewTaskModal, {
      props: { defaultAgentProvider: "claude" },
      attachTo: document.body,
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    await flushPromises();
    await flushPromises();

    const textarea = wrapper.get("textarea");
    const agentButton = wrapper.get(".agent-provider");

    await textarea.trigger("focus");
    expect(document.activeElement).toBe(textarea.element);

    const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    agentButton.element.dispatchEvent(mouseDown);
    expect(mouseDown.defaultPrevented).toBe(true);

    await agentButton.trigger("click");
    await flushPromises();

    expect(document.activeElement).toBe(textarea.element);

    wrapper.unmount();
  });

  it("registers the agent switching shortcut in new task context", async () => {
    mount(NewTaskModal, {
      props: { defaultAgentProvider: "claude" },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    await flushPromises();

    expect(getContextShortcuts("newTask")).toContainEqual({
      action: "Switch agent",
      keys: "⇧⌘[ / ⇧⌘]",
    });
  });
});
