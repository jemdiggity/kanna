import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
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
    if (testRepoPath) {
      await cleanupWorktrees(client, testRepoPath);
    }
    await cleanupFixtureRepos(fixtureRepoRoot ? [fixtureRepoRoot] : []);
    await client.deleteSession();
  });

  it("advances a live task into a continue-mode commit stage through the daemon input command", async () => {
    const taskId = "continue-stage-task";
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
        "claude",
        "idle",
        null,
      ],
    );
    await hydrateStoreItem(client, taskId);

    await tauriInvoke(client, "spawn_session", {
      sessionId: taskId,
      cwd: testRepoPath,
      executable: "/bin/cat",
      args: [],
      env: {},
      cols: 80,
      rows: 24,
      agentProvider: "claude",
    });

    const advanceResult = await callVueMethod(client, "store.advanceStage", taskId);
    if (isVueCallError(advanceResult)) throw new Error(advanceResult.__error);

    await waitForStage(client, taskId, "commit");
  });
});
