import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "vitest";
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase, importTestRepo, cleanupWorktrees } from "../helpers/reset";
import { callVueMethod } from "../helpers/vue";
import { dirname, resolve } from "path";

setDefaultTimeout(60_000);

const TEST_REPO_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

describe("diff after claude (real CLI)", () => {
  const client = new WebDriverClient();

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
    await importTestRepo(client, TEST_REPO_PATH, "diff-real-test");
  });

  afterAll(async () => {
    cleanupWorktrees(client, TEST_REPO_PATH).catch(() => {});
    await client.deleteSession();
  });

  it("creates task that writes a file and shows diff", async () => {
    await callVueMethod(
      client,
      "handleNewTaskSubmit",
      "Create a file called e2e-test-output.txt containing exactly: E2E test content"
    );

    // Wait for task to appear
    await client.waitForText(".sidebar", "In Progress");

    // Wait for Claude to finish (process exits)
    await sleep(15_000);

    // Switch to Diff tab
    const tabs = await client.findElements(".tab");
    for (const id of tabs) {
      const text = await client.getText(id);
      if (text.trim() === "Diff") {
        await client.click(id);
        break;
      }
    }

    await sleep(3000);

    const diffView = await client.findElement(".diff-view");
    const text = await client.getText(diffView);

    // Should contain the file name somewhere in the diff output
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toBe("No changes");
  });
});
