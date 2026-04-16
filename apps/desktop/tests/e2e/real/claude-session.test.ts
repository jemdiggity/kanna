import { setTimeout as sleep } from "node:timers/promises";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase, importTestRepo, cleanupWorktrees } from "../helpers/reset";
import { callVueMethod } from "../helpers/vue";
import { cleanupFixtureRepos, createFixtureRepo } from "../helpers/fixture-repo";

describe("claude session (real CLI)", () => {
  const client = new WebDriverClient();
  let testRepoPath = "";

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
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

  it("creates task and Claude produces terminal output", async () => {
    await callVueMethod(
      client,
      "handleNewTaskSubmit",
      "Respond with exactly: E2E_TEST_OK"
    );

    // Wait for task to appear
    await client.waitForText(".sidebar", "In Progress");

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
    // Terminal should have some content from Claude
    expect(termText.length).toBeGreaterThan(0);
  });

  it("terminal view is rendered for PTY mode", async () => {
    const container = await client.findElement(".terminal-container");
    expect(container).toBeTruthy();
  });
});
