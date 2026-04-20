import { describe, expect, it } from "vitest";
import { buildRealE2eAgentEnv } from "./runEnv";

describe("buildRealE2eAgentEnv", () => {
  it("returns codex and gpt-5.4-mini for real suites by default", () => {
    expect(
      buildRealE2eAgentEnv(
        ["tests/e2e/real/pty-session.test.ts"],
        {},
      ),
    ).toEqual({
      KANNA_E2E_REAL_AGENT_PROVIDER: "codex",
      KANNA_E2E_REAL_AGENT_MODEL: "gpt-5.4-mini",
    });
  });

  it("returns no override for mock suites", () => {
    expect(
      buildRealE2eAgentEnv(
        ["tests/e2e/mock/app-launch.test.ts"],
        {},
      ),
    ).toEqual({});
  });

  it("allows explicit process env to replace the default real-suite values", () => {
    expect(
      buildRealE2eAgentEnv(
        ["tests/e2e/real/pty-session.test.ts"],
        {
          KANNA_E2E_REAL_AGENT_PROVIDER: "copilot",
          KANNA_E2E_REAL_AGENT_MODEL: "gpt-5.4-nano",
        },
      ),
    ).toEqual({
      KANNA_E2E_REAL_AGENT_PROVIDER: "copilot",
      KANNA_E2E_REAL_AGENT_MODEL: "gpt-5.4-nano",
    });
  });
});
