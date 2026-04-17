import { describe, expect, it } from "vitest";
import { buildTerminalDocument, buildTerminalUpdateScript } from "./buildTerminalDocument";

describe("buildTerminalDocument", () => {
  it("builds a terminal shell with sticky scroll behavior and bottom inset", () => {
    const html = buildTerminalDocument({
      bottomInset: 132
    });

    expect(html).toContain('charset="utf-8"');
    expect(html).toContain('id="viewport"');
    expect(html).toContain('id="terminal"');
    expect(html).toContain("padding: 14px 14px 132px 14px;");
    expect(html).toContain("window.__setTerminalState");
    expect(html).toContain("viewport.scrollTop = viewport.scrollHeight");
  });

  it("repairs utf-8 box drawing text that arrived as latin-1 mojibake", () => {
    const script = buildTerminalUpdateScript({
      output: "â­ââ Claude Code âââ®",
      status: "live"
    });

    expect(script).toContain("╭── Claude Code ──╮");
    expect(script).not.toContain("â­");
  });

  it("renders terminal status copy when no output is available", () => {
    const connectingScript = buildTerminalUpdateScript({
      output: "",
      status: "connecting"
    });
    const idleScript = buildTerminalUpdateScript({
      output: "   ",
      status: "idle"
    });

    expect(connectingScript).toContain("Connecting to desktop daemon...");
    expect(idleScript).toContain("Waiting for terminal output...");
  });
});
