import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cleanupFixtureRepos, createFixtureRepo } from "../helpers/fixture-repo";
import { cleanupWorktrees, importTestRepo, resetDatabase } from "../helpers/reset";
import { dismissStartupShortcutsModal } from "../helpers/startupOverlays";
import { callVueMethod, queryDb, tauriInvoke } from "../helpers/vue";
import { WebDriverClient } from "../helpers/webdriver";
import { waitForFile } from "../helpers/worktreeFs";

const execFileAsync = promisify(execFile);

function isVueCallError(value: unknown): value is { __error: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    "__error" in value &&
    typeof (value as { __error?: unknown }).__error === "string",
  );
}

async function git(repoPath: string, args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", repoPath, ...args]);
}

async function waitForTaskBranch(
  client: WebDriverClient,
  taskId: string,
  timeoutMs = 20_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = (await queryDb(
      client,
      "SELECT branch FROM pipeline_item WHERE id = ?",
      [taskId],
    )) as Array<{ branch?: string | null }>;
    const branch = rows[0]?.branch;
    if (branch) return branch;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for task branch: ${taskId}`);
}

describe("kanna-cli PATH in spawned tasks", () => {
  const client = new WebDriverClient();
  let testRepoPath = "";
  let taskId = "";

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
    await client.executeSync("location.reload()");
    await client.waitForAppReady();
    await dismissStartupShortcutsModal(client);

    testRepoPath = await createFixtureRepo("kanna-cli-path-real-test");
    await mkdir(join(testRepoPath, ".kanna"), { recursive: true });
    await writeFile(
      join(testRepoPath, ".kanna", "config.json"),
      JSON.stringify({
        setup: [
          "set -eu; resolved=$(command -v kanna-cli); test -n \"$resolved\"; printf '%s\\n' \"$resolved\" > .kanna-cli-from-path",
        ],
      }),
    );
    await git(testRepoPath, ["add", ".kanna/config.json"]);
    await git(testRepoPath, ["commit", "-m", "test: add kanna-cli path setup"]);
    await git(testRepoPath, ["push", "origin", "main"]);

    await importTestRepo(client, testRepoPath, "kanna-cli-path-real-test");
  });

  afterAll(async () => {
    if (taskId) {
      await tauriInvoke(client, "kill_session", { sessionId: taskId }).catch(() => undefined);
    }
    if (testRepoPath) {
      await cleanupWorktrees(client, testRepoPath).catch(() => undefined);
      await cleanupFixtureRepos([testRepoPath]).catch(() => undefined);
    }
    await client.deleteSession();
  });

  it("prepends the instance-local kanna-cli directory for task setup commands", async () => {
    const rows = (await queryDb(
      client,
      "SELECT id FROM repo WHERE path = ?",
      [testRepoPath],
    )) as Array<{ id: string }>;
    const repoId = rows[0]?.id;
    if (!repoId) throw new Error("fixture repo was not imported");

    const expectedKannaCliPath = await tauriInvoke(client, "which_binary", { name: "kanna-cli" });
    if (typeof expectedKannaCliPath !== "string" || expectedKannaCliPath.length === 0) {
      throw new Error(`unexpected kanna-cli path: ${JSON.stringify(expectedKannaCliPath)}`);
    }

    const createResult = await callVueMethod(
      client,
      "store.createItem",
      repoId,
      testRepoPath,
      "",
      "pty",
      { agentProvider: "codex", permissionMode: "dontAsk", selectOnCreate: false },
    );
    if (isVueCallError(createResult)) throw new Error(createResult.__error);
    if (typeof createResult !== "string") {
      throw new Error(`unexpected createItem result: ${JSON.stringify(createResult)}`);
    }
    taskId = createResult;

    const branch = await waitForTaskBranch(client, taskId);
    const worktreePath = join(testRepoPath, ".kanna-worktrees", branch);
    const markerPath = join(worktreePath, ".kanna-cli-from-path");
    await waitForFile(markerPath, 60_000, 250);

    const resolvedFromTaskPath = (await readFile(markerPath, "utf8")).trim();
    expect(dirname(resolvedFromTaskPath)).toBe(dirname(expectedKannaCliPath));
    expect(resolvedFromTaskPath.endsWith("/kanna-cli")).toBe(true);
  }, 90_000);
});
