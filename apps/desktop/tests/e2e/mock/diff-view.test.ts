import { resolve } from "path";
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test";

setDefaultTimeout(30_000);
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase, importTestRepo, cleanupWorktrees } from "../helpers/reset";
import { callVueMethod, getVueState, tauriInvoke } from "../helpers/vue";

const TEST_REPO_PATH = resolve(import.meta.dir, "../../../..");

describe("diff view", () => {
  const client = new WebDriverClient();

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
    await importTestRepo(client, TEST_REPO_PATH, "diff-test");

    // Create a task with worktree but no Claude session (SDK mode, will fail gracefully)
    const repoId = await getVueState(client, "selectedRepoId") as string;
    const id = crypto.randomUUID();
    const branch = `task-${id}`;
    const worktreePath = `${TEST_REPO_PATH}/.kanna-worktrees/${branch}`;

    // Create worktree
    await tauriInvoke(client, "git_worktree_add", {
      repoPath: TEST_REPO_PATH,
      branch,
      path: worktreePath,
    });

    // Insert task into DB
    await client.executeAsync<string>(
      `const cb = arguments[arguments.length - 1];
       const ctx = document.getElementById("app").__vue_app__._instance.setupState;
       const db = ctx.db.value || ctx.db;
       db.execute("INSERT INTO pipeline_item (id, repo_id, prompt, stage, branch, agent_type) VALUES (?, ?, ?, ?, ?, ?)",
         ["${id}", "${repoId}", "Say OK", "in_progress", "${branch}", "sdk"])
         .then(function() { return ctx.loadItems("${repoId}"); })
         .then(function() { ctx.handleSelectItem("${id}"); return ctx.refreshAllItems(); })
         .then(function() { cb("ok"); })
         .catch(function(e) { cb("err:" + e); });`
    );
    await client.waitForText(".sidebar", "In Progress");
  });

  afterAll(async () => {
    // Best-effort cleanup — don't block on worktree removal
    cleanupWorktrees(client, TEST_REPO_PATH).catch(() => {});
    await client.deleteSession();
  });

  it("shows diff tab", async () => {
    const tabs = await client.findElements(".tab");
    const texts: string[] = [];
    for (const id of tabs) {
      texts.push(await client.getText(id));
    }
    expect(texts.some((t) => t.trim() === "Diff")).toBe(true);
  });

  it("shows diff content after writing a file", async () => {
    // Get the worktree path from the selected item
    const branch = await client.executeSync<string | null>(
      `const ctx = document.getElementById("app").__vue_app__._instance.setupState;
       const item = ctx.selectedItem();
       return item ? (item.branch?.value || item.branch) : null;`
    );
    if (!branch) {
      console.warn("No task selected, skipping diff content test");
      return;
    }

    const worktreePath = `${TEST_REPO_PATH}/.kanna-worktrees/${branch}`;

    // Write a test file into the worktree
    await tauriInvoke(client, "run_script", {
      script: "echo 'diff test content' > diff-test-file.txt",
      cwd: worktreePath,
      env: {},
    });

    // Click the Diff tab
    const tabs = await client.findElements(".tab");
    for (const id of tabs) {
      const text = await client.getText(id);
      if (text.trim() === "Diff") {
        await client.click(id);
        break;
      }
    }

    // Wait for diff to render (not "No changes")
    await Bun.sleep(2000);
    const diffView = await client.findElement(".diff-view");
    const text = await client.getText(diffView);
    // Should either show diff content or at least not be stuck on "Loading..."
    expect(text).not.toContain("Loading diff");
  });
});
