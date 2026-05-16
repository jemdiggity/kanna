import { setTimeout as sleep } from "node:timers/promises";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebDriverClient } from "../helpers/webdriver";
import { cleanupWorktrees, importTestRepo, resetDatabase } from "../helpers/reset";
import { cleanupFixtureRepos, createSeedFixtureRepo } from "../helpers/fixture-repo";
import { tauriInvoke } from "../helpers/vue";

interface DaemonSessionInfo {
  session_id?: string;
}

interface AppMetricsSnapshot {
  invokeCounts: Record<string, number>;
  listenCounts: Record<string, number>;
  unlistenCounts: Record<string, number>;
  activeListenCounts: Record<string, number>;
}

interface PerfTask {
  id: string;
  prompt: string;
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
}

interface DaemonSnapshotStats {
  matchCount: number;
  firstMatchingLine: string | null;
  lastMatchingLine: string | null;
  lastMatchingLineNumber: number;
}

function buildStreamingSetupCommand(label: string): string {
  return [
    "i=1",
    "while true; do",
    `  printf '${label} live output %05d\\n' \"$i\"`,
    "  i=$((i+1))",
    "  sleep 0.05",
    "done",
  ].join("; ");
}

function requireCreatedTaskId(value: string, label: string): string {
  if (/^[0-9a-f]{8}$/.test(value)) {
    return value;
  }
  throw new Error(`${label} task creation failed: ${value}`);
}

async function createStreamingTask(
  client: WebDriverClient,
  options: {
    repoId: string;
    repoPath: string;
    prompt: string;
  },
): Promise<PerfTask> {
  const setupCmd = buildStreamingSetupCommand(options.prompt);
  const taskId = await client.executeAsync<string>(
    `const cb = arguments[arguments.length - 1];
     const ctx = window.__KANNA_E2E__.setupState;
     Promise.resolve(
       ctx.createItem(${JSON.stringify(options.repoId)}, ${JSON.stringify(options.repoPath)}, ${JSON.stringify(options.prompt)}, "pty", {
         selectOnCreate: false,
         agentProvider: "claude",
         customTask: {
           executionMode: "pty",
           agentProvider: "claude",
           setup: [${JSON.stringify(setupCmd)}],
         },
       })
     ).then((id) => cb(id)).catch((error) => cb(String(error)));`,
  );
  return {
    id: requireCreatedTaskId(taskId, options.prompt),
    prompt: options.prompt,
  };
}

async function waitForSessions(
  client: WebDriverClient,
  expectedSessionIds: string[],
  timeoutMs = 10_000,
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
      if (expectedSessionIds.every((sessionId) => sessionIds.has(sessionId))) {
        return;
      }
    }
    await sleep(100);
  }
  throw new Error(`timed out waiting for PTY sessions: ${expectedSessionIds.join(", ")}`);
}

async function selectTask(client: WebDriverClient, task: PerfTask): Promise<void> {
  const result = await client.executeAsync<string>(
    `const cb = arguments[arguments.length - 1];
     const ctx = window.__KANNA_E2E__.setupState;
     Promise.resolve(ctx.store.selectItem(${JSON.stringify(task.id)}))
       .then(() => cb("ok"))
       .catch((error) => cb("__error:" + (error?.message || String(error))));`,
  );
  if (result !== "ok") {
    throw new Error(`select task failed: ${result}`);
  }
  await client.waitForText(".pipeline-item.selected", task.prompt);
}

async function readMetrics(client: WebDriverClient): Promise<AppMetricsSnapshot> {
  const snapshot = await client.executeSync(
    `const metrics = window.__KANNA_E2E__?.appMetrics;
     if (!metrics) return { __error: "missing appMetrics" };
     return metrics.snapshot();`,
  );
  if (!snapshot || typeof snapshot !== "object" || "__error" in snapshot) {
    throw new Error(String((snapshot as { __error?: string } | null)?.__error ?? "invalid appMetrics snapshot"));
  }
  return snapshot as AppMetricsSnapshot;
}

async function waitForMetrics(
  client: WebDriverClient,
  predicate: (snapshot: AppMetricsSnapshot) => boolean,
  label: string,
  timeoutMs = 10_000,
): Promise<AppMetricsSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let latest: AppMetricsSnapshot | null = null;
  while (Date.now() < deadline) {
    latest = await readMetrics(client);
    if (predicate(latest)) return latest;
    await sleep(100);
  }
  throw new Error(`timed out waiting for app metrics ${label}; latest=${JSON.stringify(latest)}`);
}

async function clearMetrics(client: WebDriverClient): Promise<void> {
  const result = await client.executeSync(
    `const metrics = window.__KANNA_E2E__?.appMetrics;
     if (!metrics) return "__error:missing appMetrics";
     metrics.clear();
     return "ok";`,
  );
  if (result !== "ok") {
    throw new Error(String(result));
  }
}

async function readTerminalBufferStats(
  client: WebDriverClient,
  sessionId: string,
  matcherSource: string,
): Promise<TerminalBufferStats> {
  return await client.executeSync<TerminalBufferStats>(
    `const hook = window.__KANNA_E2E__?.terminalBuffers;
     if (!hook) throw new Error("terminalBuffers E2E hook is not available");
     return hook.stats(${JSON.stringify(sessionId)}, new RegExp(${JSON.stringify(matcherSource)}));`,
  );
}

async function waitForTerminalMatchCount(
  client: WebDriverClient,
  options: {
    sessionId: string;
    matcherSource: string;
    minMatches: number;
    timeoutMs: number;
  },
): Promise<TerminalBufferStats> {
  const deadline = Date.now() + options.timeoutMs;
  let latest: TerminalBufferStats | null = null;
  while (Date.now() < deadline) {
    latest = await readTerminalBufferStats(client, options.sessionId, options.matcherSource);
    if (latest.matchingLineCount >= options.minMatches) return latest;
    await sleep(100);
  }
  throw new Error(`timed out waiting for terminal buffer matches; latest=${JSON.stringify(latest)}`);
}

async function waitForTerminalLastLineAtLeast(
  client: WebDriverClient,
  options: {
    sessionId: string;
    matcherSource: string;
    minLineNumber: number;
    timeoutMs: number;
  },
): Promise<TerminalBufferStats> {
  const deadline = Date.now() + options.timeoutMs;
  let latest: TerminalBufferStats | null = null;
  while (Date.now() < deadline) {
    latest = await readTerminalBufferStats(client, options.sessionId, options.matcherSource);
    if (parseStreamingLineNumber(latest.lastMatchingLine) >= options.minLineNumber) return latest;
    await sleep(100);
  }
  throw new Error(`timed out waiting for focused terminal catch-up; latest=${JSON.stringify(latest)}`);
}

async function waitForDaemonSnapshotLineAfter(
  client: WebDriverClient,
  options: {
    sessionId: string;
    matcherSource: string;
    minLineNumber: number;
    timeoutMs: number;
  },
): Promise<DaemonSnapshotStats> {
  const deadline = Date.now() + options.timeoutMs;
  let latest: DaemonSnapshotStats | null = null;
  while (Date.now() < deadline) {
    const snapshot = await tauriInvoke(client, "get_session_recovery_state", {
      sessionId: options.sessionId,
    }).catch(() => null) as { serialized?: string } | null;
    const serialized = snapshot?.serialized ?? "";
    const matches = serialized.match(new RegExp(options.matcherSource, "g")) ?? [];
    const lastMatchingLine = matches.at(-1) ?? null;
    latest = {
      matchCount: matches.length,
      firstMatchingLine: matches[0] ?? null,
      lastMatchingLine,
      lastMatchingLineNumber: parseStreamingLineNumber(lastMatchingLine),
    };
    if (latest.lastMatchingLineNumber >= options.minLineNumber) return latest;
    await sleep(100);
  }
  throw new Error(`timed out waiting for daemon snapshot catch-up; latest=${JSON.stringify(latest)}`);
}

function parseStreamingLineNumber(line: string | null): number {
  const match = /(\d{5})$/.exec(line ?? "");
  return match ? Number.parseInt(match[1], 10) : Number.NEGATIVE_INFINITY;
}

describe("terminal output performance", () => {
  const client = new WebDriverClient();
  let fixtureRepoRoot = "";
  let testRepoPath = "";
  let repoId = "";
  const taskIds: string[] = [];

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
    fixtureRepoRoot = await createSeedFixtureRepo("task-switch-minimal");
    testRepoPath = fixtureRepoRoot;
    repoId = await importTestRepo(client, testRepoPath, "terminal-output-perf");
  });

  afterAll(async () => {
    await Promise.all(
      taskIds.map((sessionId) =>
        tauriInvoke(client, "kill_session", { sessionId }).catch(() => null),
      ),
    );
    if (testRepoPath) {
      await cleanupWorktrees(client, testRepoPath);
    }
    await cleanupFixtureRepos(fixtureRepoRoot ? [fixtureRepoRoot] : []);
    await client.deleteSession();
  });

  it("does not poll daemon sessions or multiply terminal output listeners while warm PTY tasks stream", async () => {
    const tasks = await Promise.all([
      createStreamingTask(client, { repoId, repoPath: testRepoPath, prompt: "Output Perf A" }),
      createStreamingTask(client, { repoId, repoPath: testRepoPath, prompt: "Output Perf B" }),
      createStreamingTask(client, { repoId, repoPath: testRepoPath, prompt: "Output Perf C" }),
    ]);
    taskIds.push(...tasks.map((task) => task.id));

    await waitForSessions(client, taskIds);

    for (const task of tasks) {
      await selectTask(client, task);
      await sleep(250);
    }

    await clearMetrics(client);
    await sleep(1250);

    const snapshot = await readMetrics(client);
    console.log("[e2e][terminal-output-perf]", JSON.stringify(snapshot));

    expect(snapshot.invokeCounts.list_sessions ?? 0).toBe(0);
    expect(snapshot.activeListenCounts.terminal_output ?? 0).toBe(1);
    expect(snapshot.listenCounts.terminal_output ?? 0).toBe(0);
  });

  it("pauses live PTY output on window blur and catches up from daemon snapshot on focus", async () => {
    const task = await createStreamingTask(client, {
      repoId,
      repoPath: testRepoPath,
      prompt: "Blur Pause",
    });
    taskIds.push(task.id);

    await waitForSessions(client, [task.id]);
    await selectTask(client, task);
    await client.waitForElement(".main-panel .terminal-container", 15_000);

    const matcherSource = "^Blur Pause live output \\d{5}$";
    const visibleStats = await waitForTerminalMatchCount(client, {
      sessionId: task.id,
      matcherSource,
      minMatches: 3,
      timeoutMs: 10_000,
    });
    expect(parseStreamingLineNumber(visibleStats.lastMatchingLine)).toBeGreaterThanOrEqual(3);

    await clearMetrics(client);
    await client.executeSync("window.dispatchEvent(new Event('blur'))");
    await waitForMetrics(
      client,
      (snapshot) => (snapshot.activeListenCounts.terminal_output ?? 0) === 0,
      "terminal_output listener removal after blur",
    );

    const hiddenBaseline = await readTerminalBufferStats(client, task.id, matcherSource);
    await sleep(500);
    const hiddenAfterWait = await readTerminalBufferStats(client, task.id, matcherSource);
    expect(hiddenAfterWait.matchingLineCount).toBe(hiddenBaseline.matchingLineCount);
    expect(hiddenAfterWait.lastMatchingLine).toBe(hiddenBaseline.lastMatchingLine);

    const hiddenLineNumber = parseStreamingLineNumber(hiddenBaseline.lastMatchingLine);
    const daemonSnapshot = await waitForDaemonSnapshotLineAfter(client, {
      sessionId: task.id,
      matcherSource: "Blur Pause live output \\d{5}",
      minLineNumber: hiddenLineNumber + 3,
      timeoutMs: 10_000,
    });

    await clearMetrics(client);
    await client.executeSync("window.dispatchEvent(new Event('focus'))");
    await waitForMetrics(
      client,
      (snapshot) => (snapshot.activeListenCounts.terminal_output ?? 0) === 1,
      "terminal_output listener registration after focus",
    );

    const refocusedStats = await waitForTerminalLastLineAtLeast(client, {
      sessionId: task.id,
      matcherSource,
      minLineNumber: daemonSnapshot.lastMatchingLineNumber,
      timeoutMs: 10_000,
    });

    expect(parseStreamingLineNumber(refocusedStats.lastMatchingLine))
      .toBeGreaterThanOrEqual(daemonSnapshot.lastMatchingLineNumber);
  });
});
