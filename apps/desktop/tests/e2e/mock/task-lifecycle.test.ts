import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase, importTestRepo, cleanupWorktrees } from "../helpers/reset";
import { queryDb, tauriInvoke } from "../helpers/vue";
import { cleanupFixtureRepos, createFixtureRepo } from "../helpers/fixture-repo";
import { buildGlobalKeydownScript } from "../helpers/keyboard";

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
    // Internal setup only: lifecycle assertions need deterministic SDK-mode
    // tasks so closing behavior can be tested without launching a real agent.
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

  it("closes into teardown and stays visible when teardown commands exist", async () => {
    const rows = (await queryDb(
      client,
      "SELECT branch FROM pipeline_item WHERE repo_id = ? AND prompt = ? ORDER BY created_at DESC LIMIT 1",
      [repoId, "Say OK"],
    )) as Array<{ branch: string }>;
    const branch = rows[0]?.branch;
    expect(branch).toBeTruthy();
    if (!branch) {
      throw new Error("expected the created task to have a branch");
    }

    await tauriInvoke(client, "write_text_file", {
      path: `${testRepoPath}/.kanna-worktrees/${branch}/.kanna/config.json`,
      content: JSON.stringify({
        setup: [],
        teardown: ["printf 'teardown\\n' && sleep 2"],
      }),
    });

    await client.executeSync(buildGlobalKeydownScript({
      key: "Delete",
      meta: true,
      shift: true,
    }));

    await sleep(300);
    const stageRows = (await queryDb(
      client,
      "SELECT stage FROM pipeline_item WHERE repo_id = ? AND prompt = ? ORDER BY created_at DESC LIMIT 1",
      [repoId, "Say OK"],
    )) as Array<{ stage: string }>;
    expect(stageRows[0]?.stage).toBe("teardown");

    const sidebarText = await client.executeSync<string>(
      `return document.querySelector(".sidebar")?.textContent || "";`
    );
    expect(sidebarText).toContain("Say OK");
  });

  it("closes directly to done and disappears when teardown commands do not exist", async () => {
    // Internal setup only: this creates a second inert task to isolate close
    // behavior from terminal and agent process startup.
    const createResult = await client.executeAsync<string>(
      `const cb = arguments[arguments.length - 1];
       const ctx = window.__KANNA_E2E__.setupState;
       ctx.createItem(${JSON.stringify(repoId)}, ${JSON.stringify(testRepoPath)}, "Close Fast", "sdk")
         .then(() => cb("ok"))
         .catch((error) => cb("err:" + error));`
    );
    expect(createResult).toBe("ok");

    const header = await client.waitForText(".task-header", "Close Fast");
    expect(header).toBeTruthy();

    const rows = (await queryDb(
      client,
      "SELECT id, branch FROM pipeline_item WHERE repo_id = ? AND prompt = ? ORDER BY created_at DESC LIMIT 1",
      [repoId, "Close Fast"],
    )) as Array<{ id: string; branch: string }>;
    const branch = rows[0]?.branch;
    expect(branch).toBeTruthy();
    if (!branch) {
      throw new Error("expected the close-fast task to have a branch");
    }

    await tauriInvoke(client, "write_text_file", {
      path: `${testRepoPath}/.kanna-worktrees/${branch}/.kanna/config.json`,
      content: JSON.stringify({ setup: [] }),
    });

    await client.executeSync(buildGlobalKeydownScript({
      key: "Delete",
      meta: true,
      shift: true,
    }));

    await sleep(500);
    const stageRows = (await queryDb(
      client,
      "SELECT stage FROM pipeline_item WHERE repo_id = ? AND prompt = ? ORDER BY created_at DESC LIMIT 1",
      [repoId, "Close Fast"],
    )) as Array<{ stage: string }>;
    expect(stageRows[0]?.stage).toBe("done");

    const sidebarText = await client.executeSync<string>(
      `return document.querySelector(".sidebar")?.textContent || "";`
    );
    expect(sidebarText).not.toContain("Close Fast");
  });
});
