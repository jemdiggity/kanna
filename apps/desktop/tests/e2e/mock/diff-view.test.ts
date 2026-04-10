import { dirname, resolve } from "path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "vitest";

setDefaultTimeout(30_000);
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase, importTestRepo, cleanupWorktrees } from "../helpers/reset";
import { callVueMethod, getVueState, tauriInvoke } from "../helpers/vue";

const TEST_REPO_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

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
       const ctx = window.__KANNA_E2E__.setupState;
       const db = ctx.db.value || ctx.db;
       db.execute("INSERT INTO pipeline_item (id, repo_id, prompt, stage, branch, agent_type) VALUES (?, ?, ?, ?, ?, ?)",
         ["${id}", "${repoId}", "Say OK", "in progress", "${branch}", "sdk"])
         .then(function() { return ctx.loadItems("${repoId}"); })
         .then(function() { ctx.handleSelectItem("${id}"); return ctx.refreshAllItems(); })
         .then(function() { cb("ok"); })
         .catch(function(e) { cb("err:" + e); });`
    );
    await client.waitForText(".sidebar", "Say OK");
  });

  afterAll(async () => {
    // Best-effort cleanup — don't block on worktree removal
    cleanupWorktrees(client, TEST_REPO_PATH).catch(() => {});
    await client.deleteSession();
  });

  it("opens the diff modal", async () => {
    await client.executeSync(
      "window.__KANNA_E2E__.setupState.showDiffModal = true;"
    );
    const diffView = await client.waitForElement(".diff-view", 5000);
    expect(diffView).toBeTruthy();
  });

  it("loads diff content after editing a tracked file", async () => {
    // Get the worktree path from the selected item
    const branch = await client.executeSync<string | null>(
      `const ctx = window.__KANNA_E2E__.setupState;
       const item = ctx.selectedItem();
       return item ? (item.branch?.value || item.branch) : null;`
    );
    if (!branch) {
      console.warn("No task selected, skipping diff content test");
      return;
    }

    const worktreePath = `${TEST_REPO_PATH}/.kanna-worktrees/${branch}`;

    // Modify a tracked file in the worktree so the working diff is guaranteed to pick it up.
    await tauriInvoke(client, "run_script", {
      script: "printf '\\n# diff test marker\\n' >> VERSION",
      cwd: worktreePath,
      env: {},
    });

    await client.executeSync(
      "window.__KANNA_E2E__.setupState.showDiffModal = true;"
    );

    const patch = await tauriInvoke(client, "git_diff", {
      repoPath: worktreePath,
      mode: "all",
    });
    expect(typeof patch).toBe("string");
    expect(String(patch)).toContain("# diff test marker");
  });
});
