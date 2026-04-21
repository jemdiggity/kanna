import { setTimeout as sleep } from "node:timers/promises";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase, importTestRepo, cleanupWorktrees } from "../helpers/reset";
import { dismissStartupShortcutsModal } from "../helpers/startupOverlays";
import { submitTaskFromUi } from "../helpers/newTaskFlow";
import { nudgeTerminalTrustPrompt } from "../helpers/terminalInput";
import { waitForTaskCreated } from "../helpers/taskCreation";
import { cleanupFixtureRepos, createFixtureRepo } from "../helpers/fixture-repo";

describe("pty session (real CLI)", () => {
  const client = new WebDriverClient();
  let testRepoPath = "";

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
    await client.executeSync("location.reload()");
    await client.waitForAppReady();
    await dismissStartupShortcutsModal(client);
    testRepoPath = await createFixtureRepo("claude-real-test");
    await importTestRepo(client, testRepoPath, "claude-real-test");
  });

  afterAll(async () => {
    if (testRepoPath) {
      await cleanupWorktrees(client, testRepoPath);
      await cleanupFixtureRepos([testRepoPath]);
    }
    await client.deleteSession();
  });

  it("creates a PTY task and renders terminal output", async () => {
    const prompt = "Respond with exactly: E2E_TEST_OK";

    await submitTaskFromUi(client, prompt);

    const task = await waitForTaskCreated(client, prompt);
    expect(task.agent_provider).toBe("codex");
    await nudgeTerminalTrustPrompt(client, {
      initialDelayMs: 5_000,
      attempts: 4,
      intervalMs: 5_000,
    });

    // In PTY mode, output appears in the terminal container
    // Wait for the terminal to have content (xterm.js renders into a canvas)
    const terminal = await client.waitForElement(".terminal-container", 15_000);
    expect(terminal).toBeTruthy();

    // Wait for session to exit — the terminal shows "[Process exited with code X]"
    await sleep(10_000);
    const termText = await client.executeSync<string>(
      `const el = document.querySelector(".xterm-screen");
       return el ? el.textContent : "";`
    );
    // Terminal should have some content from the real agent session
    expect(termText.length).toBeGreaterThan(0);
  });

  it("renders the terminal view for PTY mode", async () => {
    const container = await client.findElement(".terminal-container");
    expect(container).toBeTruthy();
  });
});
