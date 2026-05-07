import { describe, expect, it } from "vitest";
import { executeDevDownWithContext, executeDevStatus } from "../src/tasks/registry";
import type { CommandRunner } from "../src/runtime/process";

describe("task executors", () => {
  it("reports no running tmux session as ok status", async () => {
    const runner: CommandRunner = {
      async run(command, args) {
        expect(command).toBe("tmux");
        expect(args).toEqual(["-L", "kanna-task-abc", "has-session", "-t", "kanna-task-abc"]);
        return { exitCode: 1, stdout: "", stderr: "no server running" };
      }
    };

    const result = await executeDevStatus({
      runner,
      context: {
        repoRoot: "/repo/.kanna-worktrees/task-abc",
        tmux: { server: "kanna-task-abc", session: "kanna-task-abc" },
        ports: { KANNA_DEV_PORT: 1421, KANNA_MOBILE_PORT: 8082 },
        env: {}
      }
    });

    expect(result).toEqual({
      ok: true,
      message: "Kanna dev session is not running.",
      data: {
        running: false,
        session: "kanna-task-abc",
        server: "kanna-task-abc"
      }
    });
  });

  it("runs workspace daemon cleanup when dev down asks to kill daemons", async () => {
    const calls: string[] = [];
    const killed: number[] = [];
    const runner: CommandRunner = {
      async run(command, args) {
        calls.push(`${command} ${args.join(" ")}`);
        if (args.includes("has-session")) {
          return { exitCode: 1, stdout: "", stderr: "no server running" };
        }
        if (command === "ps") {
          return { exitCode: 0, stdout: " 123 /repo/.build/debug/kanna-daemon\n", stderr: "" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    };

    const result = await executeDevDownWithContext(
      { killDaemon: true },
      {
        runner,
        context: {
          repoRoot: "/repo",
          tmux: { server: "kanna-task-abc", session: "kanna-task-abc" },
          ports: {},
          env: { KANNA_DAEMON_DIR: "/repo/.kanna-daemon" }
        }
      },
      { killProcess: (pid) => killed.push(pid) }
    );

    expect(result.data).toEqual({
      stopped: false,
      daemonCleanup: {
        orphanedKilled: [{ pid: 123, command: "/repo/.build/debug/kanna-daemon" }]
      }
    });
    expect(killed).toEqual([123]);
    expect(calls).toEqual([
      "tmux -L kanna-task-abc has-session -t kanna-task-abc",
      "ps -axo pid=,command="
    ]);
  });
});
