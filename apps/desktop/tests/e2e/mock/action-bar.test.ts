import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase, importTestRepo, cleanupWorktrees } from "../helpers/reset";
import { callVueMethod, getVueState } from "../helpers/vue";

const TEST_REPO_PATH = process.cwd().replace(/\/apps\/desktop$/, "");

describe("action bar", () => {
  const client = new WebDriverClient();

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
    await importTestRepo(client, TEST_REPO_PATH, "action-test");
    await callVueMethod(client, "handleNewTaskSubmit", "Say OK");
    await client.waitForText(".sidebar", "In Progress");
  });

  afterAll(async () => {
    await cleanupWorktrees(client, TEST_REPO_PATH);
    await client.deleteSession();
  });

  it("shows Make PR button for in_progress task", async () => {
    const el = await client.waitForText(".action-bar", "Make PR");
    expect(el).toBeTruthy();
  });

  it("shows Close button for in_progress task", async () => {
    const el = await client.waitForText(".action-bar", "Close");
    expect(el).toBeTruthy();
  });

  it("clicking Close changes stage to Closed", async () => {
    const buttons = await client.findElements(".action-bar button");
    for (const id of buttons) {
      const text = await client.getText(id);
      if (text.trim() === "Close") {
        await client.click(id);
        break;
      }
    }

    await Bun.sleep(500);
    const item = (await callVueMethod(client, "selectedItem")) as { stage: string } | null;
    expect(item?.stage).toBe("closed");
  });

  it("hides Make PR and Close for closed task", async () => {
    const actionBar = await client.findElement(".action-bar");
    const text = await client.getText(actionBar);
    expect(text).not.toContain("Make PR");
    expect(text).not.toContain("Close");
  });
});
