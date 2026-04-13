import { describe, expect, it } from "vitest";
import { buildPendingTaskPlaceholder } from "./taskCreationPlaceholder";

describe("buildPendingTaskPlaceholder", () => {
  it("starts new tasks in working activity immediately", () => {
    const item = buildPendingTaskPlaceholder({
      id: "task-1",
      repoId: "repo-1",
      prompt: "ship it",
      branch: "task-task-1",
      agentType: "pty",
      requestedAgentProviders: "copilot",
      nowIso: "2026-04-13T09:00:00.000Z",
    });

    expect(item.activity).toBe("working");
    expect(item.activity_changed_at).toBe("2026-04-13T09:00:00.000Z");
    expect(item.agent_provider).toBe("copilot");
    expect(item.stage).toBe("in progress");
  });

  it("falls back to claude when no provider is known yet", () => {
    const item = buildPendingTaskPlaceholder({
      id: "task-2",
      repoId: "repo-1",
      prompt: "merge",
      branch: "task-task-2",
      agentType: "pty",
      nowIso: "2026-04-13T09:00:00.000Z",
    });

    expect(item.agent_provider).toBe("claude");
    expect(item.pipeline).toBe("default");
  });
});
