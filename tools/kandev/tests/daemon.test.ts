import { describe, expect, it } from "vitest";
import { findWorkspaceDaemonProcesses, killWorkspaceDaemons } from "../src/runtime/daemon";
import type { CommandRunner } from "../src/runtime/process";

describe("daemon cleanup", () => {
  it("finds orphaned workspace daemon processes from ps output", () => {
    expect(
      findWorkspaceDaemonProcesses(
        "/repo/worktree",
        [
          " 111 /repo/worktree/.build/aarch64/debug/kanna-daemon",
          " 222 /repo/worktree/.build/aarch64/debug/kanna-terminal-recovery",
          " 333 /other/.build/aarch64/debug/kanna-daemon",
          " 444 /repo/worktree/node_modules/.bin/not-kanna-daemon"
        ].join("\n")
      )
    ).toEqual([
      { pid: 111, command: "/repo/worktree/.build/aarch64/debug/kanna-daemon" },
      { pid: 222, command: "/repo/worktree/.build/aarch64/debug/kanna-terminal-recovery" }
    ]);
  });

  it("kills pid-file and orphaned workspace daemon processes", async () => {
    const killed: number[] = [];
    const runner: CommandRunner = {
      async run(command, args) {
        expect(command).toBe("ps");
        expect(args).toEqual(["-axo", "pid=,command="]);
        return {
          exitCode: 0,
          stdout: " 222 /repo/worktree/.build/debug/kanna-daemon\n",
          stderr: ""
        };
      }
    };

    const result = await killWorkspaceDaemons({
      repoRoot: "/repo/worktree",
      daemonDir: "/repo/worktree/.kanna-daemon",
      runner,
      readPidFile: () => 111,
      killProcess: (pid) => killed.push(pid)
    });

    expect(result).toEqual({
      pidFileKilled: 111,
      orphanedKilled: [{ pid: 222, command: "/repo/worktree/.build/debug/kanna-daemon" }]
    });
    expect(killed).toEqual([111, 222]);
  });
});
