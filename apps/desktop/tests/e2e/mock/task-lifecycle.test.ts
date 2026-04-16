import { dirname, resolve } from "path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase, importTestRepo, cleanupWorktrees } from "../helpers/reset";
import { queryDb, tauriInvoke } from "../helpers/vue";

const TEST_REPO_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("task lifecycle", () => {
  const client = new WebDriverClient();
  let repoId = "";

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
    repoId = await importTestRepo(client, TEST_REPO_PATH, "lifecycle-test");
  });

  afterAll(async () => {
    await cleanupWorktrees(client, TEST_REPO_PATH);
    await client.deleteSession();
  });

  it("creates a task that appears in sidebar", async () => {
    const result = await client.executeAsync<string>(
      `const cb = arguments[arguments.length - 1];
       try {
         const ctx = window.__KANNA_E2E__.setupState;
         ctx.createItem(${JSON.stringify(repoId)}, ${JSON.stringify(TEST_REPO_PATH)}, "Say OK", "sdk")
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
      path: `${TEST_REPO_PATH}/.kanna-worktrees/${branch}`,
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
      path: `${TEST_REPO_PATH}/.kanna-worktrees/${branch}/.kanna/config.json`,
      content: JSON.stringify({
        setup: [],
        teardown: ["printf 'teardown\\n' && sleep 2"],
      }),
    });

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
    const createResult = await client.executeAsync<string>(
      `const cb = arguments[arguments.length - 1];
       const ctx = window.__KANNA_E2E__.setupState;
       ctx.createItem(${JSON.stringify(repoId)}, ${JSON.stringify(TEST_REPO_PATH)}, "Close Fast", "sdk")
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
      path: `${TEST_REPO_PATH}/.kanna-worktrees/${branch}/.kanna/config.json`,
      content: JSON.stringify({ setup: [] }),
    });

    const closeResult = await client.executeAsync<string>(
      `const cb = arguments[arguments.length - 1];
       const ctx = window.__KANNA_E2E__.setupState;
       const item = ctx.selectedItem();
       if (!item) { cb("no item"); return; }
       Promise.resolve(ctx.store.closeTask(item.id))
         .then(() => cb("ok"))
         .catch((error) => cb("err:" + error));`
    );
    expect(closeResult).toBe("ok");

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
