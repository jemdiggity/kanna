import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase, importTestRepo } from "../helpers/reset";
import { getVueState } from "../helpers/vue";
import { cleanupFixtureRepos, createFixtureRepo } from "../helpers/fixture-repo";

describe("action bar", () => {
  const client = new WebDriverClient();
  let fixtureRepoRoot = "";
  let testRepoPath = "";

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
    fixtureRepoRoot = await createFixtureRepo("action-test");
    testRepoPath = join(fixtureRepoRoot, "apps");
    await importTestRepo(client, testRepoPath, "action-test");
    // Insert task directly into DB — no Claude session needed for action bar tests
    const repoId = await getVueState(client, "selectedRepoId") as string;
    await client.executeAsync<string>(
      `const cb = arguments[arguments.length - 1];
       const ctx = window.__KANNA_E2E__.setupState;
       const db = ctx.db.value || ctx.db;
       var id = crypto.randomUUID();
       db.execute("INSERT INTO pipeline_item (id, repo_id, prompt, stage, agent_type) VALUES (?, ?, ?, ?, ?)",
         [id, "${repoId}", "Say OK", "in progress", "sdk"])
         .then(function() { return ctx.loadItems("${repoId}"); })
         .then(function() { ctx.handleSelectItem(id); return ctx.refreshAllItems(); })
         .then(function() { cb("ok"); })
         .catch(function(e) { cb("err:" + e); });`
    );
    await client.waitForText(".sidebar", "Say OK");
  });

  afterAll(async () => {
    await cleanupFixtureRepos(fixtureRepoRoot ? [fixtureRepoRoot] : []);
    await client.deleteSession();
  });

  it("shows the selected task header", async () => {
    const el = await client.waitForText(".task-header", "Say OK");
    expect(el).toBeTruthy();
  });

  it("hides the task after it is marked done", async () => {
    // Transition to done
    await client.executeAsync<string>(
      `const cb = arguments[arguments.length - 1];
       const ctx = window.__KANNA_E2E__.setupState;
       const db = ctx.db.value || ctx.db;
       const item = ctx.selectedItem();
       db.execute("UPDATE pipeline_item SET stage = 'done' WHERE id = ?", [item.id])
         .then(function() { return ctx.loadItems(ctx.selectedRepoId.value); })
         .then(function() { return ctx.refreshAllItems(); })
         .then(function() { cb("ok"); })
         .catch(function(e) { cb("err:" + e); });`
    );
    await sleep(300);
    const sidebarText = await client.executeSync<string>(
      `return document.querySelector(".sidebar")?.textContent || "";`
    );
    expect(sidebarText).not.toContain("Say OK");
  });
});
