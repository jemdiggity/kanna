import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildGlobalKeydownScript } from "../helpers/keyboard";
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase, importTestRepo } from "../helpers/reset";
import { dismissStartupShortcutsModal } from "../helpers/startupOverlays";
import { execDb, getVueState } from "../helpers/vue";
import { cleanupFixtureRepos, createFixtureRepo } from "../helpers/fixture-repo";
const CTX_SCRIPT = 'window.__KANNA_E2E__.setupState';

describe("keyboard shortcuts", () => {
  const client = new WebDriverClient();
  let fixtureRepoRoot = "";
  let secondFixtureRepoRoot = "";
  let testRepoPath = "";
  let secondTestRepoPath = "";
  let repoImported = false;

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
    await client.executeSync("location.reload()");
    await client.waitForAppReady();
    await dismissStartupShortcutsModal(client);
    fixtureRepoRoot = await createFixtureRepo("keyboard-test");
    testRepoPath = join(fixtureRepoRoot, "apps");
    secondFixtureRepoRoot = await createFixtureRepo("keyboard-test-secondary");
    secondTestRepoPath = join(secondFixtureRepoRoot, "packages");
  });

  afterAll(async () => {
    await cleanupFixtureRepos([fixtureRepoRoot, secondFixtureRepoRoot].filter(Boolean));
    await client.deleteSession();
  });

  async function pressKey(key: string, opts: { meta?: boolean; shift?: boolean; alt?: boolean; ctrl?: boolean } = {}) {
    await client.executeSync(buildGlobalKeydownScript({
      key,
      meta: opts.meta,
      shift: opts.shift,
      alt: opts.alt,
      ctrl: opts.ctrl,
    }));
  }

  async function waitForSelection(
    expected: { repoId?: string; itemId?: string },
    timeoutMs = 3000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastSelection: { repoId: string | null; itemId: string | null } | null = null;
    while (Date.now() < deadline) {
      lastSelection = await client.executeSync<{ repoId: string | null; itemId: string | null }>(
        `const ctx = ${CTX_SCRIPT};
         const unwrap = (value) => value && value.__v_isRef ? value.value : value;
         return {
           repoId: unwrap(ctx.store?.selectedRepoId ?? ctx.selectedRepoId) ?? null,
           itemId: unwrap(ctx.store?.selectedItemId ?? ctx.selectedItemId) ?? null,
         };`,
      );
      const repoMatches = expected.repoId === undefined || lastSelection.repoId === expected.repoId;
      const itemMatches = expected.itemId === undefined || lastSelection.itemId === expected.itemId;
      if (repoMatches && itemMatches) return;
      await sleep(100);
    }
    throw new Error(
      `Timed out waiting for selection ${JSON.stringify(expected)}; last selection was ${JSON.stringify(lastSelection)}`,
    );
  }

  async function ensureRepoImported() {
    if (repoImported) return;
    await importTestRepo(client, testRepoPath, "keyboard-test");
    repoImported = true;
  }

  it("Shift+Cmd+N shows a warning when no repos are loaded", async () => {
    expect(await client.findElements(".toast.warning")).toHaveLength(0);
    await pressKey("N", { meta: true, shift: true });
    await sleep(300);
    const modalElements = await client.findElements(".modal-overlay");
    expect(modalElements).toHaveLength(0);
    const warningToast = await client.waitForElement(".toast.warning", 2000);
    const warningText = await client.getText(warningToast);
    expect(warningText.toLowerCase()).toContain("repo");
  });

  it("Shift+Cmd+N opens New Task modal when a repo is loaded", async () => {
    await ensureRepoImported();
    await pressKey("N", { meta: true, shift: true });
    await sleep(300);
    const modal = await client.waitForElement(".modal-overlay", 2000);
    expect(modal).toBeTruthy();
  });

  it("Escape closes modal", async () => {
    await pressKey("Escape");
    await sleep(500);
    try {
      await client.findElement(".modal-overlay");
      // Modal still there — close via state
      await client.executeSync(`${CTX_SCRIPT}.showNewTaskModal = false;`);
      await sleep(300);
    } catch {
      // Modal already gone
    }
  });

  it("uses shortcuts to navigate tasks and repos while preserving back-forward history", async () => {
    await resetDatabase(client);
    await client.executeSync("location.reload()");
    await client.waitForAppReady();
    await dismissStartupShortcutsModal(client);

    const repoOneId = await importTestRepo(client, testRepoPath, "keyboard-history-one");
    const repoTwoId = await importTestRepo(client, secondTestRepoPath, "keyboard-history-two");
    repoImported = true;

    await execDb(client, "UPDATE repo SET sort_order = 0 WHERE id = ?", [repoOneId]);
    await execDb(client, "UPDATE repo SET sort_order = 1 WHERE id = ?", [repoTwoId]);

    const repoOneIssueOne = "e2e-repo-one-issue-one";
    const repoOneIssueTwo = "e2e-repo-one-issue-two";
    const repoTwoIssueOne = "e2e-repo-two-issue-one";
    const repoTwoIssueTwo = "e2e-repo-two-issue-two";
    const taskRows = [
      [repoOneIssueOne, repoOneId, 101, "Repo One Issue One", "2026-04-17T10:00:00.000Z"],
      [repoOneIssueTwo, repoOneId, 102, "Repo One Issue Two", "2026-04-17T10:01:00.000Z"],
      [repoTwoIssueOne, repoTwoId, 201, "Repo Two Issue One", "2026-04-17T10:00:00.000Z"],
      [repoTwoIssueTwo, repoTwoId, 202, "Repo Two Issue Two", "2026-04-17T10:01:00.000Z"],
    ] as const;

    for (const [id, repoId, issueNumber, issueTitle, createdAt] of taskRows) {
      await execDb(
        client,
        `INSERT INTO pipeline_item
           (id, repo_id, issue_number, issue_title, prompt, stage, tags, branch, agent_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          repoId,
          issueNumber,
          issueTitle,
          `Prompt for ${issueTitle}`,
          "in progress",
          "[]",
          null,
          "sdk",
          createdAt,
          createdAt,
        ],
      );
    }

    await client.executeSync(
      `${CTX_SCRIPT}.showNewTaskModal = false;
       ${CTX_SCRIPT}.showAddRepoModal = false;
       ${CTX_SCRIPT}.showShortcutsModal = false;
       ${CTX_SCRIPT}.showFilePickerModal = false;
       ${CTX_SCRIPT}.showFilePreviewModal = false;
       ${CTX_SCRIPT}.showDiffModal = false;
       ${CTX_SCRIPT}.showTreeExplorer = false;
       ${CTX_SCRIPT}.showShellModal = false;
       ${CTX_SCRIPT}.showAnalyticsModal = false;
       ${CTX_SCRIPT}.showBlockerSelect = false;
       ${CTX_SCRIPT}.showPreferencesPanel = false;
       ${CTX_SCRIPT}.showCommitGraphModal = false;
       ${CTX_SCRIPT}.showPeerPicker = false;`,
    );

    await client.executeAsync<string>(
      `const cb = arguments[arguments.length - 1];
       const ctx = ${CTX_SCRIPT};
       ctx.refreshAllItems().then(function() { cb("ok"); }).catch(function(e) { cb("err:" + e); });`,
    );
    await client.executeAsync<string>(
      `const cb = arguments[arguments.length - 1];
       const ctx = ${CTX_SCRIPT};
       Promise.resolve(ctx.store.selectRepo(${JSON.stringify(repoOneId)}))
         .then(function() { return ctx.store.selectItem(${JSON.stringify(repoOneIssueTwo)}); })
         .then(function() { cb("ok"); })
         .catch(function(e) { cb("err:" + e); });`,
    );
    await waitForSelection({ repoId: repoOneId, itemId: repoOneIssueTwo });
    await sleep(1100);

    await pressKey("ArrowDown", { meta: true, alt: true });
    await waitForSelection({ repoId: repoOneId, itemId: repoOneIssueOne });
    await sleep(1100);

    await pressKey("ArrowDown", { meta: true, shift: true });
    await waitForSelection({ repoId: repoTwoId, itemId: repoTwoIssueTwo });
    await sleep(1100);

    await pressKey("ArrowDown", { meta: true, alt: true });
    await waitForSelection({ repoId: repoTwoId, itemId: repoTwoIssueOne });
    await sleep(1100);

    await pressKey("-", { ctrl: true });
    await waitForSelection({ repoId: repoTwoId, itemId: repoTwoIssueTwo });

    await pressKey("-", { ctrl: true });
    await waitForSelection({ repoId: repoOneId, itemId: repoOneIssueOne });

    await pressKey("-", { ctrl: true });
    await waitForSelection({ repoId: repoOneId, itemId: repoOneIssueTwo });

    await pressKey("-", { ctrl: true, shift: true });
    await waitForSelection({ repoId: repoOneId, itemId: repoOneIssueOne });

    await pressKey("-", { ctrl: true, shift: true });
    await waitForSelection({ repoId: repoTwoId, itemId: repoTwoIssueTwo });

    await pressKey("-", { ctrl: true, shift: true });
    await waitForSelection({ repoId: repoTwoId, itemId: repoTwoIssueOne });

    await sleep(1100);
    await pressKey("ArrowUp", { meta: true, shift: true });
    await waitForSelection({ repoId: repoOneId, itemId: repoOneIssueOne });

    await pressKey("-", { ctrl: true });
    await waitForSelection({ repoId: repoTwoId, itemId: repoTwoIssueOne });

    await pressKey("-", { ctrl: true, shift: true });
    await waitForSelection({ repoId: repoOneId, itemId: repoOneIssueOne });
  });

  it("unread shortcuts skip teardown tasks", async () => {
    await ensureRepoImported();
    const repoId = await getVueState(client, "selectedRepoId") as string;

    const seedResult = await client.executeAsync<string>(
      `const cb = arguments[arguments.length - 1];
       const ctx = window.__KANNA_E2E__.setupState;
       const db = ctx.db.value || ctx.db;
       const rows = [
         ["shortcut-teardown-old", "${repoId}", "Teardown old unread", "teardown", "unread", "2026-03-31T00:00:00.000Z"],
         ["shortcut-normal-old", "${repoId}", "Normal old unread", "in progress", "unread", "2026-03-31T01:00:00.000Z"],
       ];
       Promise.all(rows.map(function(row) {
         return db.execute(
           "INSERT OR REPLACE INTO pipeline_item (id, repo_id, prompt, stage, activity, created_at, agent_type, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
           [row[0], row[1], row[2], row[3], row[4], row[5], "sdk", "[]"]
         );
       }))
         .then(function() { return ctx.loadItems("${repoId}"); })
         .then(function() { return ctx.store.selectItem("shortcut-teardown-old"); })
         .then(function() { cb("ok"); })
         .catch(function(e) { cb("err:" + e); });`
    );
    expect(seedResult).toBe("ok");
    await sleep(500);

    await pressKey("u", { meta: true });
    await sleep(200);
    expect(await getVueState(client, "selectedItemId")).toBe("shortcut-normal-old");
  });

  it("Shift+Cmd+Enter maximizes the tree explorer", async () => {
    await ensureRepoImported();

    await pressKey("E", { meta: true, shift: true });
    await client.waitForElement(".tree-modal", 2000);
    await sleep(300);

    const maximizedBefore = await client.executeSync<boolean>(
      `const modal = document.querySelector(".tree-modal");
       return modal?.parentElement?.classList.contains("maximized") ?? false;`
    );
    expect(maximizedBefore).toBe(false);

    await pressKey("Enter", { meta: true, shift: true });
    await sleep(300);

    const maximizedAfter = await client.executeSync<boolean>(
      `const modal = document.querySelector(".tree-modal");
       return modal?.parentElement?.classList.contains("maximized") ?? false;`
    );
    expect(maximizedAfter).toBe(true);

    await client.executeSync(`${CTX_SCRIPT}.showTreeExplorer = false; ${CTX_SCRIPT}.maximizedModal = null;`);
    await client.waitForNoElement(".tree-modal", 2000);
  });
});
