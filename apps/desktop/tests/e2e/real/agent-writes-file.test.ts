import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { submitTaskFromUi } from "../helpers/newTaskFlow";
import { cleanupFixtureRepos, createFixtureRepo } from "../helpers/fixture-repo";
import { cleanupWorktrees, importTestRepo, resetDatabase } from "../helpers/reset";
import { dismissStartupShortcutsModal } from "../helpers/startupOverlays";
import { nudgeTerminalTrustPrompt } from "../helpers/terminalInput";
import { WebDriverClient } from "../helpers/webdriver";
import { waitForFile, waitForNewTaskWorktree } from "../helpers/worktreeFs";

function readTaskWorktreeNames(repoPath: string): Promise<string[]> {
  return readdir(join(repoPath, ".kanna-worktrees"), { withFileTypes: true })
    .then((entries) =>
      entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("task-"))
        .map((entry) => entry.name),
    )
    .catch(() => []);
}

async function nudgeTrustPromptViaUi(client: WebDriverClient): Promise<void> {
  await nudgeTerminalTrustPrompt(client, {
    initialDelayMs: 5_000,
    attempts: 4,
    intervalMs: 5_000,
  });
}

describe("agent writes file (real CLI)", () => {
  const client = new WebDriverClient();
  let testRepoPath = "";

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
    await client.executeSync("location.reload()");
    await client.waitForAppReady();
    await dismissStartupShortcutsModal(client);
    testRepoPath = await createFixtureRepo("agent-writes-file-real-test");
    await importTestRepo(client, testRepoPath, "agent-writes-file-real-test");
  });

  afterAll(async () => {
    if (testRepoPath) {
      await cleanupWorktrees(client, testRepoPath).catch(() => undefined);
      await cleanupFixtureRepos([testRepoPath]).catch(() => undefined);
    }
    await client.deleteSession();
  });

  it("creates a task that writes the expected file", async () => {
    const prompt = "Create a file called e2e-test-output.txt containing exactly: E2E test content";
    const worktreeBaseline = new Set(await readTaskWorktreeNames(testRepoPath));

    await submitTaskFromUi(client, prompt);
    await client.waitForElement(".terminal-container", 15_000);

    const worktreePath = await waitForNewTaskWorktree(testRepoPath, worktreeBaseline, 20_000);

    await nudgeTrustPromptViaUi(client);

    const filePath = join(worktreePath, "e2e-test-output.txt");
    await waitForFile(filePath, 120_000, 500);
    expect((await readFile(filePath, "utf8")).trimEnd()).toBe("E2E test content");
  }, 180_000);
});
