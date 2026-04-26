import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../../../..");

function readSource(path: string) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function selectorBlock(source: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

describe("terminal layout CSS", () => {
  it("lets each flex container in the agent terminal chain shrink vertically", () => {
    const app = readSource("apps/desktop/src/App.vue");
    const mainPanel = readSource("apps/desktop/src/components/MainPanel.vue");
    const terminalTabs = readSource("apps/desktop/src/components/TerminalTabs.vue");
    const terminalView = readSource("apps/desktop/src/components/TerminalView.vue");

    expect(selectorBlock(app, ".main-column")).toContain("min-height: 0");
    expect(selectorBlock(mainPanel, ".main-panel")).toContain("min-height: 0");
    expect(selectorBlock(terminalTabs, ".terminal-panel")).toContain("min-height: 0");
    expect(selectorBlock(terminalView, ".terminal-wrapper")).toContain("min-height: 0");
  });
});
