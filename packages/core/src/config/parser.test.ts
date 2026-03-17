import { describe, it, expect } from "vitest";
import { parseKannaConfig } from "./parser.js";

describe("parseKannaConfig", () => {
  it("parses a tasks section", () => {
    const toml = `
[tasks]
auto_assign = true
labels = ["kn:claimed", "kn:wip"]
branch_prefix = "kanna/"
`;
    const config = parseKannaConfig(toml);
    expect(config.tasks).toEqual({
      auto_assign: true,
      labels: ["kn:claimed", "kn:wip"],
      branch_prefix: "kanna/",
    });
  });

  it("parses a team section", () => {
    const toml = `
[team]
slack_channel = "#eng"
discord_channel = "123456789"
notify_on_pr = true
notify_on_merge = false
`;
    const config = parseKannaConfig(toml);
    expect(config.team).toEqual({
      slack_channel: "#eng",
      discord_channel: "123456789",
      notify_on_pr: true,
      notify_on_merge: false,
    });
  });

  it("parses agents section", () => {
    const toml = `
[agents.reviewer]
enabled = true
model = "claude-opus-4"
max_tokens = 4096
`;
    const config = parseKannaConfig(toml);
    expect(config.agents?.reviewer).toEqual({
      enabled: true,
      model: "claude-opus-4",
      max_tokens: 4096,
    });
  });

  it("returns empty config for empty TOML", () => {
    const config = parseKannaConfig("");
    expect(config).toEqual({});
  });

  it("ignores unknown top-level keys", () => {
    const toml = `
[unknown_section]
foo = "bar"
`;
    const config = parseKannaConfig(toml);
    expect(config.tasks).toBeUndefined();
    expect(config.team).toBeUndefined();
    expect(config.agents).toBeUndefined();
  });

  it("parses a full config", () => {
    const toml = `
[tasks]
auto_assign = false

[team]
slack_channel = "#kanna"
notify_on_pr = true

[agents.pm]
enabled = true
`;
    const config = parseKannaConfig(toml);
    expect(config.tasks?.auto_assign).toBe(false);
    expect(config.team?.slack_channel).toBe("#kanna");
    expect(config.agents?.pm?.enabled).toBe(true);
  });
});
