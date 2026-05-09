import { setTimeout as sleep } from "node:timers/promises";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase, importTestRepo, cleanupWorktrees } from "../helpers/reset";
import { cleanupFixtureRepos, createFixtureRepo } from "../helpers/fixture-repo";
import { tauriInvoke } from "../helpers/vue";

interface DaemonSessionInfo {
  session_id?: string;
}

interface TerminalBufferStats {
  sessionId: string;
  lineCount: number;
  baseY: number;
  viewportY: number;
  matchingLineCount: number;
  firstMatchingLine: string | null;
  lastMatchingLine: string | null;
  hasEndMarker: boolean;
  tailLines?: string[];
}

describe("terminal recovery", () => {
  const client = new WebDriverClient();
  let testRepoPath = "";
  let repoId = "";
  const taskIds: string[] = [];

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
    await client.executeSync("location.reload()");
    await client.waitForAppReady();
    testRepoPath = await createFixtureRepo("terminal-recovery-test");
    await configureTerminalRecoveryFixture(testRepoPath);
    repoId = await importTestRepo(client, testRepoPath, "terminal-recovery-test");
  });

  afterAll(async () => {
    await Promise.all(
      taskIds.map((sessionId) =>
        tauriInvoke(client, "kill_session", { sessionId }).catch(() => null),
      ),
    );
    if (testRepoPath) {
      await cleanupWorktrees(client, testRepoPath);
      await cleanupFixtureRepos([testRepoPath]);
    }
    await client.deleteSession();
  });

  it("replays recovery scrollback and respawns a task terminal after daemon_ready", async () => {
    const taskId = await createRecoverableTask(client, {
      repoId,
      repoPath: testRepoPath,
      prompt: "Recover a missing PTY session",
    });
    taskIds.push(taskId);

    await waitForSessionPresence(client, taskId, true);
    await selectTask(client, taskId);
    await client.waitForElement(".main-panel .terminal-container", 15_000);
    await waitForTerminalEndMarker(client, taskId, "ORIGINAL_READY", "^ORIGINAL_READY$", 15_000);

    await strictTauriInvoke(client, "kill_session", { sessionId: taskId });
    await waitForSessionPresence(client, taskId, false);
    await strictTauriInvoke(client, "detach_session", { sessionId: taskId });
    await emitTauriEvent(client, "session_exit", { session_id: taskId, code: 0 });
    await waitForTerminalEndMarker(client, taskId, "[Process exited with code 0]", "\\[Process exited", 15_000);

    const recoverySnapshot = buildRecoverySnapshot(2_000);
    await strictTauriInvoke(client, "seed_session_recovery_state", {
      sessionId: taskId,
      serialized: recoverySnapshot,
      cols: 80,
      rows: 24,
      cursorRow: 23,
      cursorCol: 0,
      cursorVisible: true,
    });

    await emitTauriEvent(client, "daemon_ready");

    await waitForSessionPresence(client, taskId, true, 20_000);
    const recoveredStats = await waitForTerminalEndMarker(
      client,
      taskId,
      "RECOVERY_DONE",
      "^RECOVERY_LINE\\d{4}$",
      20_000,
    );
    const respawnStats = await waitForTerminalEndMarker(
      client,
      taskId,
      "RESPAWN_READY",
      "^RESPAWN_READY$",
      20_000,
    );

    expect(recoveredStats.matchingLineCount).toBeGreaterThanOrEqual(2_000);
    expect(recoveredStats.firstMatchingLine).toBe("RECOVERY_LINE0001");
    expect(recoveredStats.lastMatchingLine).toBe("RECOVERY_LINE2000");
    expect(respawnStats.hasEndMarker).toBe(true);
  });
});

async function createRecoverableTask(
  client: WebDriverClient,
  options: {
    repoId: string;
    repoPath: string;
    prompt: string;
  },
): Promise<string> {
  const taskId = await client.executeAsync<string>(
    `const cb = arguments[arguments.length - 1];
     const ctx = window.__KANNA_E2E__.setupState;
     Promise.resolve(
       ctx.createItem(${JSON.stringify(options.repoId)}, ${JSON.stringify(options.repoPath)}, ${JSON.stringify(options.prompt)}, "pty", {
         selectOnCreate: false,
         agentProvider: "claude",
       })
     ).then((id) => cb(id)).catch((error) => cb("__error:" + (error?.message || String(error))));`,
  );
  if (!/^[0-9a-f]{8}$/.test(taskId)) {
    throw new Error(`recoverable task creation failed: ${taskId}`);
  }
  return taskId;
}

async function configureTerminalRecoveryFixture(repoPath: string): Promise<void> {
  const setupCommand = [
    "if [ -f .kanna/terminal-recovery-respawn.ready ]; then",
    "printf 'RESPAWN_READY\\n';",
    "else",
    "touch .kanna/terminal-recovery-respawn.ready;",
    "printf 'ORIGINAL_READY\\n';",
    "fi;",
    "while true; do sleep 60; done",
  ].join(" ");

  await writeFile(
    `${repoPath}/.kanna/config.json`,
    JSON.stringify({ setup: [setupCommand] }, null, 2),
  );
  await runCommand(["git", "add", ".kanna/config.json"], repoPath);
  await runCommand(["git", "commit", "-m", "configure terminal recovery fixture"], repoPath);
  await runCommand(["git", "push", "origin", "main"], repoPath);
}

async function runCommand(command: string[], cwd: string): Promise<void> {
  const [file, ...args] = command;
  const proc = spawn(file, args, { cwd, stdio: "pipe" });
  let stderr = "";
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  await new Promise<void>((resolve, reject) => {
    proc.once("error", reject);
    proc.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (signal) {
        reject(new Error(`${command.join(" ")} exited with signal ${signal}`));
        return;
      }
      const details = stderr.trim();
      reject(new Error(
        details.length > 0
          ? `${command.join(" ")} failed: ${details}`
          : `${command.join(" ")} exited with code ${code ?? "unknown"}`,
      ));
    });
  });
}

async function selectTask(client: WebDriverClient, taskId: string): Promise<void> {
  const result = await client.executeAsync<string>(
    `const cb = arguments[arguments.length - 1];
     const ctx = window.__KANNA_E2E__.setupState;
     Promise.resolve(ctx.store.selectItem(${JSON.stringify(taskId)}))
       .then(() => cb("ok"))
       .catch((error) => cb("__error:" + (error?.message || String(error))));`,
  );
  if (result !== "ok") {
    throw new Error(`select task failed: ${result}`);
  }
}

function buildRecoverySnapshot(lineCount: number): string {
  const lines: string[] = [];
  for (let i = 1; i <= lineCount; i += 1) {
    lines.push(`RECOVERY_LINE${String(i).padStart(4, "0")}`);
  }
  lines.push("RECOVERY_DONE");
  return `${lines.join("\r\n")}\r\n`;
}

async function waitForSessionPresence(
  client: WebDriverClient,
  sessionId: string,
  expectedPresent: boolean,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sessions = await tauriInvoke(client, "list_sessions");
    if (Array.isArray(sessions)) {
      const sessionIds = new Set(
        sessions
          .map((session) =>
            typeof session === "object" && session !== null
              ? (session as DaemonSessionInfo).session_id
              : undefined)
          .filter((value): value is string => typeof value === "string"),
      );
      if (sessionIds.has(sessionId) === expectedPresent) return;
    }
    await sleep(100);
  }

  throw new Error(
    `timed out waiting for session ${sessionId} to be ${expectedPresent ? "present" : "absent"}`,
  );
}

async function waitForTerminalEndMarker(
  client: WebDriverClient,
  sessionId: string,
  endMarker: string,
  matcherSource: string,
  timeoutMs: number,
): Promise<TerminalBufferStats> {
  const deadline = Date.now() + timeoutMs;
  let latest: TerminalBufferStats | null = null;
  while (Date.now() < deadline) {
    latest = await readTerminalStats(client, sessionId, matcherSource, endMarker);
    if (latest.hasEndMarker) return latest;
    await sleep(100);
  }
  throw new Error(
    `timed out waiting for terminal marker ${endMarker} in ${sessionId}; latest=${JSON.stringify(latest)}`,
  );
}

async function readTerminalStats(
  client: WebDriverClient,
  sessionId: string,
  matcherSource: string,
  endMarker: string,
): Promise<TerminalBufferStats> {
  return await client.executeSync<TerminalBufferStats>(
    `const hook = window.__KANNA_E2E__?.terminalBuffers;
     if (!hook) throw new Error("terminalBuffers E2E hook is not available");
     const stats = hook.stats(${JSON.stringify(sessionId)}, new RegExp(${JSON.stringify(matcherSource)}), ${JSON.stringify(endMarker)});
     const tailLines = Array.from(document.querySelectorAll(".main-panel .xterm-rows > div"))
       .map((el) => el.textContent || "")
       .slice(-20);
     return { ...stats, tailLines };`,
  );
}

async function strictTauriInvoke(
  client: WebDriverClient,
  cmd: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const result = await tauriInvoke(client, cmd, args);
  if (
    result &&
    typeof result === "object" &&
    "__error" in result &&
    typeof (result as { __error?: unknown }).__error === "string"
  ) {
    throw new Error(`${cmd} failed: ${(result as { __error: string }).__error}`);
  }
  return result;
}

async function emitTauriEvent(
  client: WebDriverClient,
  event: string,
  payload: unknown = null,
): Promise<void> {
  const result = await client.executeAsync<string>(
    `const cb = arguments[arguments.length - 1];
     const event = ${JSON.stringify(event)};
     const payload = ${JSON.stringify(payload)};
     window.__TAURI_INTERNALS__.invoke("plugin:event|emit", { event, payload })
       .then(() => cb("ok"))
       .catch(() => {
         window.__TAURI_INTERNALS__.invoke("plugin:event|emit_to", {
           target: { kind: "WebviewWindow", label: "main" },
           event,
           payload,
         }).then(() => cb("ok")).catch((error) => cb("__error:" + (error?.message || String(error))));
       });`,
  );
  if (result !== "ok") {
    throw new Error(`emit ${event} failed: ${result}`);
  }
}
