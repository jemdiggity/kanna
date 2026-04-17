import { describe, expect, it, vi } from "vitest";
import {
  createLanTransport,
  type FetchLike,
  type WebSocketLike
} from "./lanTransport";

describe("createLanTransport", () => {
  it("calls the shared LAN API routes for task listing, repo listing, and task creation", async () => {
    const fetchImpl = vi.fn<FetchLike>()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{
          id: "task-1",
          repoId: "repo-1",
          title: "Refactor mobile shell",
          stage: "in progress",
          snippet: "Latest agent output preview"
        }]
      })
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
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          taskId: "task-3"
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => undefined
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => undefined
      });

    const transport = createLanTransport("http://127.0.0.1:48120", fetchImpl);

    await expect(transport.listRecentTasks()).resolves.toEqual([
      {
        id: "task-1",
        repoId: "repo-1",
        title: "Refactor mobile shell",
        stage: "in progress",
        snippet: "Latest agent output preview"
      }
    ]);
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
    await expect(transport.advanceTaskStage("task-1")).resolves.toEqual({
      taskId: "task-3"
    });
    await expect(transport.closeTask("task-1")).resolves.toBeUndefined();
    await expect(transport.sendTaskInput("task-1", "continue")).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:48120/v1/tasks/recent",
      undefined
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:48120/v1/repos",
      undefined
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
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
      4,
      "http://127.0.0.1:48120/v1/tasks/task-1/actions/run-merge-agent",
      {
        method: "POST"
      }
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      "http://127.0.0.1:48120/v1/tasks/task-1/actions/advance-stage",
      {
        method: "POST"
      }
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      6,
      "http://127.0.0.1:48120/v1/tasks/task-1/actions/close",
      {
        method: "POST"
      }
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      7,
      "http://127.0.0.1:48120/v1/tasks/task-1/input",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: "continue"
        })
      }
    );
  });

  it("observes task terminal output over the LAN websocket route", () => {
    const fetchImpl = vi.fn<FetchLike>();
    const socket: WebSocketLike = {
      close: vi.fn(),
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null
    };
    const socketFactory = vi.fn(() => socket);
    const transport = createLanTransport(
      "http://127.0.0.1:48120",
      fetchImpl,
      socketFactory
    );
    const events: unknown[] = [];

    const subscription = transport.observeTaskTerminal("task-1", (event) => {
      events.push(event);
    });

    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({
        type: "output",
        taskId: "task-1",
        text: "hello from daemon"
      })
    });
    socket.onmessage?.({
      data: JSON.stringify({
        type: "exit",
        taskId: "task-1",
        code: 0
      })
    });
    socket.onclose?.();
    subscription.close();

    expect(socketFactory).toHaveBeenCalledWith(
      "ws://127.0.0.1:48120/v1/tasks/task-1/terminal"
    );
    expect(events).toEqual([
      { type: "ready", taskId: "task-1" },
      { type: "output", taskId: "task-1", text: "hello from daemon" },
      { type: "exit", taskId: "task-1", code: 0 }
    ]);
    expect(socket.close).toHaveBeenCalledTimes(1);
  });
});
