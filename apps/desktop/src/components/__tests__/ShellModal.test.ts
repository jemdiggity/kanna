// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { defineComponent } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import ShellModal from "../ShellModal.vue"

vi.mock("../../composables/useShortcutContext", () => ({
  useShortcutContext: vi.fn(),
  setContext: vi.fn(),
  resetContext: vi.fn(),
}))

vi.mock("../../composables/useModalZIndex", () => ({
  useModalZIndex: () => ({
    zIndex: 10,
    bringToFront: vi.fn(),
  }),
}))

vi.mock("../../stores/kanna", () => ({
  useKannaStore: () => ({
    spawnShellSession: vi.fn(async () => {}),
  }),
}))

describe("ShellModal", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("does not opt shell terminals into agentTerminal behavior", () => {
    const TerminalViewStub = defineComponent({
      name: "TerminalView",
      props: ["agentTerminal"],
      setup(_, { expose }) {
        expose({
          focus: vi.fn(),
          fit: vi.fn(),
        })
        return {}
      },
      template: "<div class='terminal-view-stub' />",
    })

    const wrapper = mount(ShellModal, {
      props: {
        sessionId: "shell-1",
        cwd: "/tmp/task",
      },
      global: {
        stubs: {
          TerminalView: TerminalViewStub,
        },
      },
    })

    expect(wrapper.findComponent({ name: "TerminalView" }).props("agentTerminal")).toBeUndefined()
  })
})
