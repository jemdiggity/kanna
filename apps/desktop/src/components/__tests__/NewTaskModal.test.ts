// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
import NewTaskModal from "../NewTaskModal.vue";

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
    expect(wrapper.findAll("button").map((button) => button.text())).not.toContain("Claude");
    expect(wrapper.findAll("button").map((button) => button.text())).not.toContain("Codex");

    await wrapper.find("textarea").trigger("keydown", {
      key: "]",
      metaKey: true,
      shiftKey: true,
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Codex");
    expect(wrapper.findAll("button").map((button) => button.text())).not.toContain("Codex");
  });
});
