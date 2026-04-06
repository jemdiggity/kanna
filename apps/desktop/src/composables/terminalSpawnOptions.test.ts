import { describe, expect, it, vi } from "vitest";
import { buildTerminalSpawnOptions } from "./terminalSpawnOptions";

describe("buildTerminalSpawnOptions", () => {
  it("passes the task agent provider into respawn spawns", async () => {
    const spawnPtySession = vi.fn(async () => {});

    const spawnOptions = buildTerminalSpawnOptions(spawnPtySession, {
      worktreePath: "/tmp/task-1",
      prompt: "pizza",
      agentProvider: "codex",
    });

    expect(spawnOptions).toBeDefined();
    await spawnOptions?.spawnFn("task-1", "/tmp/task-1", "pizza", 120, 45);

    expect(spawnPtySession).toHaveBeenCalledWith(
      "task-1",
      "/tmp/task-1",
      "pizza",
      120,
      45,
      { agentProvider: "codex" },
    );
  });

  it("returns undefined when the task terminal cannot be respawned", () => {
    const spawnPtySession = vi.fn(async () => {});

    expect(buildTerminalSpawnOptions(undefined, {
      worktreePath: "/tmp/task-1",
      prompt: "pizza",
      agentProvider: "codex",
    })).toBeUndefined();

    expect(buildTerminalSpawnOptions(spawnPtySession, {
      worktreePath: "/tmp/task-1",
      agentProvider: "codex",
    })).toBeUndefined();
  });
});
