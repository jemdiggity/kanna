import { describe, expect, it } from "bun:test";
import {
  normalizeAgentProviderCandidates,
  resolveAgentProvider,
  type AgentProviderAvailability,
} from "./agent-provider";

describe("normalizeAgentProviderCandidates", () => {
  it("returns empty array when providers are missing", () => {
    expect(normalizeAgentProviderCandidates(undefined)).toEqual([]);
  });

  it("wraps a single provider in an array", () => {
    expect(normalizeAgentProviderCandidates("codex")).toEqual(["codex"]);
  });

  it("keeps ordered provider arrays unchanged", () => {
    expect(normalizeAgentProviderCandidates(["codex", "copilot"])).toEqual(["codex", "copilot"]);
  });
});

describe("resolveAgentProvider", () => {
  const allAvailable: AgentProviderAvailability = {
    claude: true,
    copilot: true,
    codex: true,
  };

  it("single available provider resolves", () => {
    expect(resolveAgentProvider("codex", allAvailable)).toBe("codex");
  });

  it("ordered list returns first available", () => {
    expect(resolveAgentProvider(["codex", "copilot"], { claude: true, copilot: true, codex: false })).toBe("copilot");
  });

  it("missing providers throws No agent provider configured for this task or stage.", () => {
    expect(() => resolveAgentProvider(undefined, allAvailable)).toThrow(
      "No agent provider configured for this task or stage.",
    );
  });

  it("unavailable providers throws None of the configured agent providers are available: codex, copilot.", () => {
    expect(() =>
      resolveAgentProvider(["codex", "copilot"], { claude: true, copilot: false, codex: false }),
    ).toThrow("None of the configured agent providers are available: codex, copilot.");
  });
});
