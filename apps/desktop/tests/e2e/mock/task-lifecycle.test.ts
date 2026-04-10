import { dirname, resolve } from "path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "vitest";
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase, importTestRepo, cleanupWorktrees } from "../helpers/reset";
import { queryDb, tauriInvoke } from "../helpers/vue";

setDefaultTimeout(65_000);

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

  it("closes task and removes it from the sidebar", async () => {
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

    // Closed tasks are hidden from the sidebar.
    await sleep(500);
    const sidebarText = await client.executeSync<string>(
      `return document.querySelector(".sidebar")?.textContent || "";`
    );
    expect(sidebarText).not.toContain("Say OK");
  });
});
