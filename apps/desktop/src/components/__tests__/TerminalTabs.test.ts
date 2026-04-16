// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import TerminalTabs from "../TerminalTabs.vue"

describe("TerminalTabs", () => {
  it("passes agentTerminal to PTY agent terminals", () => {
    const wrapper = mount(TerminalTabs, {
      props: {
        sessionId: "agent-1",
        agentType: "pty",
        worktreePath: "/tmp/task",
      },
      global: {
        stubs: {
          TerminalView: {
            name: "TerminalView",
            props: ["agentTerminal"],
            template: "<div class='terminal-view-stub' />",
          },
          AgentView: true,
        },
      },
    })

    expect(wrapper.findComponent({ name: "TerminalView" }).props("agentTerminal")).toBe(true)
  })
})
