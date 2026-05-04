import { join } from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase, importTestRepo, cleanupWorktrees } from "../helpers/reset";
import { callVueMethod, execDb, queryDb, tauriInvoke } from "../helpers/vue";
import { cleanupFixtureRepos, createFixtureRepo } from "../helpers/fixture-repo";

function isVueCallError(value: unknown): value is { __error: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    "__error" in value &&
    typeof (value as { __error?: unknown }).__error === "string",
  );
}

async function waitForStage(
  client: WebDriverClient,
  taskId: string,
  expectedStage: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = (await queryDb(
      client,
      "SELECT stage FROM pipeline_item WHERE id = ?",
      [taskId],
    )) as Array<{ stage: string | null }>;
    if (rows[0]?.stage === expectedStage) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${taskId} to reach stage ${expectedStage}`);
}

async function hydrateStoreItem(client: WebDriverClient, taskId: string): Promise<void> {
  const rows = (await queryDb(
    client,
    "SELECT * FROM pipeline_item WHERE id = ?",
    [taskId],
  )) as Array<Record<string, unknown>>;
  const item = rows[0];
  if (!item) {
    throw new Error(`seeded task ${taskId} was not found`);
  }

  const result = await client.executeSync<string>(
    `const item = ${JSON.stringify(item)};
     const ctx = window.__KANNA_E2E__.setupState;
     const items = ctx.store?.items?.value ?? ctx.store?.items;
     if (!Array.isArray(items)) return "items-unavailable";
     const index = items.findIndex((candidate) => candidate.id === item.id);
     if (index >= 0) items.splice(index, 1, item);
     else items.push(item);
     return "ok";`,
  );
  if (result !== "ok") {
    throw new Error(`failed to hydrate store item: ${result}`);
  }
}

async function waitForFileSize(path: string, expectedSize: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const size = await stat(path).then((stats) => stats.size).catch(() => 0);
    if (size === expectedSize) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${path} to reach ${expectedSize} bytes`);
}

describe("stage advance", () => {
  const client = new WebDriverClient();
  let repoId = "";
  let fixtureRepoRoot = "";
  let testRepoPath = "";

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
    fixtureRepoRoot = await createFixtureRepo("stage-advance-test");
    testRepoPath = fixtureRepoRoot;

    const pipelineName = "continue-e2e";
    const kannaDir = join(testRepoPath, ".kanna");
    await mkdir(join(kannaDir, "pipelines"), { recursive: true });
    await mkdir(join(kannaDir, "agents", "commit-e2e"), { recursive: true });
    await writeFile(
      join(kannaDir, "pipelines", `${pipelineName}.json`),
      JSON.stringify({
        name: pipelineName,
        stages: [
          { name: "in progress", transition: "manual" },
          {
            name: "commit",
            transition: "auto",
            mode: "continue",
            agent: "commit-e2e",
            prompt: "Commit stage marker for $TASK_PROMPT",
          },
        ],
      }),
    );
    await writeFile(
      join(kannaDir, "agents", "commit-e2e", "AGENT.md"),
      [
        "---",
        "name: Commit E2E",
        "description: Verifies continue-mode stage advancement.",
        "---",
        "Commit agent generated prompt marker.",
        "",
      ].join("\n"),
    );

    repoId = await importTestRepo(client, testRepoPath, "stage-advance-test");
  });

  afterAll(async () => {
    await tauriInvoke(client, "kill_session", { sessionId: "continue-stage-task" }).catch(() => undefined);
    await tauriInvoke(client, "kill_session", { sessionId: "continue-stage-claude-enter-task" }).catch(() => undefined);
    await tauriInvoke(client, "kill_session", { sessionId: "continue-stage-copilot-task" }).catch(() => undefined);
    if (testRepoPath) {
      await cleanupWorktrees(client, testRepoPath);
    }
    await cleanupFixtureRepos(fixtureRepoRoot ? [fixtureRepoRoot] : []);
    await client.deleteSession();
  });

  it("advances a live task into a continue-mode commit stage through the daemon input command", async () => {
    const taskId = "continue-stage-task";
    const inputCapturePath = join(testRepoPath, ".kanna", "continue-stage-input.bin");
    const expectedPrompt = [
      "Commit agent generated prompt marker.",
      "",
      "Commit stage marker for Write the commit",
    ].join("\n");
    const expectedInput = Buffer.from(`\x1b[200~${expectedPrompt}\x1b[201~\r`, "utf8");
    await execDb(
      client,
      `INSERT INTO pipeline_item (
         id, repo_id, prompt, pipeline, stage, stage_result, tags, branch,
         agent_type, agent_provider, activity, display_name, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        taskId,
        repoId,
        "Write the commit",
        "continue-e2e",
        "in progress",
        JSON.stringify({ status: "success", summary: "implemented" }),
        "[]",
        "task-continue-stage",
        "pty",
        "codex",
        "idle",
        null,
      ],
    );
    await hydrateStoreItem(client, taskId);

    await tauriInvoke(client, "spawn_session", {
      sessionId: taskId,
      cwd: testRepoPath,
      executable: "/bin/sh",
      args: [
        "-lc",
        `stty raw -echo; dd bs=1 count=${expectedInput.length} of=.kanna/continue-stage-input.bin 2>/dev/null`,
      ],
      env: {},
      cols: 80,
      rows: 24,
      agentProvider: "codex",
    });

    const advanceResult = await callVueMethod(client, "store.advanceStage", taskId);
    if (isVueCallError(advanceResult)) throw new Error(advanceResult.__error);

    await waitForStage(client, taskId, "commit");
    await waitForFileSize(inputCapturePath, expectedInput.length);
    expect(await readFile(inputCapturePath)).toEqual(expectedInput);
  });

  it("submits a continue-mode Claude stage with the terminal Enter sequence", async () => {
    const taskId = "continue-stage-claude-enter-task";
    const inputCapturePath = join(testRepoPath, ".kanna", "continue-stage-claude-enter-input.bin");
    const expectedPrompt = [
      "Commit agent generated prompt marker.",
      "",
      "Commit stage marker for Write the commit",
    ].join("\n");
    const expectedInput = Buffer.from(`\x1b[200~${expectedPrompt}\x1b[201~\x1b[13u`, "utf8");
    await execDb(
      client,
      `INSERT INTO pipeline_item (
         id, repo_id, prompt, pipeline, stage, stage_result, tags, branch,
         agent_type, agent_provider, activity, display_name, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        taskId,
        repoId,
        "Write the commit",
        "continue-e2e",
        "in progress",
        JSON.stringify({ status: "success", summary: "implemented" }),
        "[]",
        "task-continue-stage-claude-enter",
        "pty",
        "claude",
        "idle",
        null,
      ],
    );
    await hydrateStoreItem(client, taskId);

    await tauriInvoke(client, "spawn_session", {
      sessionId: taskId,
      cwd: testRepoPath,
      executable: "/bin/sh",
      args: [
        "-lc",
        `stty raw -echo; dd bs=1 count=${expectedInput.length} of=.kanna/continue-stage-claude-enter-input.bin 2>/dev/null`,
      ],
      env: {},
      cols: 80,
      rows: 24,
      agentProvider: "claude",
    });

    const advanceResult = await callVueMethod(client, "store.advanceStage", taskId);
    if (isVueCallError(advanceResult)) throw new Error(advanceResult.__error);

    await waitForStage(client, taskId, "commit");
    await waitForFileSize(inputCapturePath, expectedInput.length);
    expect(await readFile(inputCapturePath)).toEqual(expectedInput);
  });

  it("submits a continue-mode Copilot stage with carriage return", async () => {
    const taskId = "continue-stage-copilot-task";
    const inputCapturePath = join(testRepoPath, ".kanna", "continue-stage-copilot-input.bin");
    const expectedPrompt = [
      "Commit agent generated prompt marker.",
      "",
      "Commit stage marker for Write the commit",
    ].join("\n");
    const expectedInput = Buffer.from(`\x1b[200~${expectedPrompt}\x1b[201~\r`, "utf8");
    await execDb(
      client,
      `INSERT INTO pipeline_item (
         id, repo_id, prompt, pipeline, stage, stage_result, tags, branch,
         agent_type, agent_provider, activity, display_name, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        taskId,
        repoId,
        "Write the commit",
        "continue-e2e",
        "in progress",
        JSON.stringify({ status: "success", summary: "implemented" }),
        "[]",
        "task-continue-stage-copilot",
        "pty",
        "copilot",
        "idle",
        null,
      ],
    );
    await hydrateStoreItem(client, taskId);

    await tauriInvoke(client, "spawn_session", {
      sessionId: taskId,
      cwd: testRepoPath,
      executable: "/bin/sh",
      args: [
        "-lc",
        `stty raw -echo; dd bs=1 count=${expectedInput.length} of=.kanna/continue-stage-copilot-input.bin 2>/dev/null`,
      ],
      env: {},
      cols: 80,
      rows: 24,
      agentProvider: "copilot",
    });

    const advanceResult = await callVueMethod(client, "store.advanceStage", taskId);
    if (isVueCallError(advanceResult)) throw new Error(advanceResult.__error);

    await waitForStage(client, taskId, "commit");
    await waitForFileSize(inputCapturePath, expectedInput.length);
    expect(await readFile(inputCapturePath)).toEqual(expectedInput);
  });
});
