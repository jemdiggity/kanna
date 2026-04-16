import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase, importTestRepo, cleanupWorktrees } from "../helpers/reset";
import { queryDb, tauriInvoke } from "../helpers/vue";
import { cleanupFixtureRepos, createFixtureRepo } from "../helpers/fixture-repo";

describe("task lifecycle", () => {
  const client = new WebDriverClient();
  let repoId = "";
  let fixtureRepoRoot = "";
  let testRepoPath = "";

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
    fixtureRepoRoot = await createFixtureRepo("lifecycle-test");
    testRepoPath = join(fixtureRepoRoot, "apps");
    repoId = await importTestRepo(client, testRepoPath, "lifecycle-test");
  });

  afterAll(async () => {
    if (testRepoPath) {
      await cleanupWorktrees(client, testRepoPath);
    }
    await cleanupFixtureRepos(fixtureRepoRoot ? [fixtureRepoRoot] : []);
    await client.deleteSession();
  });

  it("creates a task that appears in sidebar", async () => {
    const result = await client.executeAsync<string>(
      `const cb = arguments[arguments.length - 1];
       try {
         const ctx = window.__KANNA_E2E__.setupState;
         ctx.createItem(${JSON.stringify(repoId)}, ${JSON.stringify(testRepoPath)}, "Say OK", "sdk")
           .then(function() { cb("ok"); })
           .catch(function(e) { cb("err:" + e); });
       } catch(e) { cb("outer:" + e); }`
    );
    expect(result).toBe("ok");

    // Task should appear in the sidebar.
    const el = await client.waitForText(".sidebar", "Say OK");
    expect(el).toBeTruthy();
  });

  it("shows task header with prompt text", async () => {
    const el = await client.waitForText(".task-header", "Say OK");
    expect(el).toBeTruthy();
  });

  it("creates the task worktree", async () => {
    const rows = (await queryDb(
      client,
      "SELECT branch FROM pipeline_item WHERE repo_id = ? AND prompt = ? ORDER BY created_at DESC LIMIT 1",
      [repoId, "Say OK"],
    )) as Array<{ branch: string | null }>;
    const branch = rows[0]?.branch ?? null;
    expect(branch).toBeTruthy();
    if (!branch) {
      throw new Error("expected the created task to have a branch");
    }

    const exists = await tauriInvoke(client, "file_exists", {
      path: `${testRepoPath}/.kanna-worktrees/${branch}`,
    });
    expect(exists).toBe(true);
  });

  it("moves the task into teardown when closed", async () => {
    const result = await client.executeAsync<string>(
      `const cb = arguments[arguments.length - 1];
       const ctx = window.__KANNA_E2E__.setupState;
       const item = ctx.selectedItem();
       if (!item) { cb("no item"); return; }
       Promise.resolve(ctx.store.closeTask(item.id))
         .then(() => cb("ok"))
         .catch((error) => cb("err:" + error));`
    );
    expect(result).toBe("ok");

    await sleep(500);
    const rows = (await queryDb(
      client,
      "SELECT stage FROM pipeline_item WHERE repo_id = ? AND prompt = ? ORDER BY created_at DESC LIMIT 1",
      [repoId, "Say OK"],
    )) as Array<{ stage: string | null }>;
    expect(rows[0]?.stage).toBe("teardown");
  });
});
