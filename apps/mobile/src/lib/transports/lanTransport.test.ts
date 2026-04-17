import { describe, expect, it, vi } from "vitest";
import { createLanTransport, type FetchLike } from "./lanTransport";

describe("createLanTransport", () => {
  it("calls the shared LAN API routes for repo listing and task creation", async () => {
    const fetchImpl = vi.fn<FetchLike>()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ id: "repo-1", name: "Repo One" }]
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          taskId: "task-1",
          repoId: "repo-1",
          title: "Ship it",
          stage: "in progress"
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          taskId: "task-2"
        })
      });

    const transport = createLanTransport("http://127.0.0.1:48120", fetchImpl);

    await expect(transport.listRepos()).resolves.toEqual([
      { id: "repo-1", name: "Repo One" }
    ]);
    await expect(transport.createTask({
      repoId: "repo-1",
      prompt: "Ship it"
    })).resolves.toEqual({
      taskId: "task-1",
      repoId: "repo-1",
      title: "Ship it",
      stage: "in progress"
    });
    await expect(transport.runMergeAgent("task-1")).resolves.toEqual({
      taskId: "task-2"
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48120/v1/repos",
      undefined
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48120/v1/tasks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoId: "repo-1",
          prompt: "Ship it"
        })
      }
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:48120/v1/tasks/task-1/actions/run-merge-agent",
      {
        method: "POST"
      }
    );
  });
});
