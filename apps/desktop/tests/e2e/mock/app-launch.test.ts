import { setTimeout as sleep } from "node:timers/promises";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase } from "../helpers/reset";

describe("app launch", () => {
  const client = new WebDriverClient();

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
    // Reload to get fresh UI after reset
    await client.executeSync("location.reload()");
    await sleep(1000);
  });

  afterAll(async () => {
    await client.deleteSession();
  });

  it("renders with title Kanna", async () => {
    const title = await client.getTitle();
    expect(title).toBe("Kanna");
  });

  it("shows empty sidebar message", async () => {
    const el = await client.waitForText(".sidebar", "No repos yet.");
    expect(el).toBeTruthy();
  });

  it("shows onboarding guidance in main panel", async () => {
    const el = await client.waitForText(".main-panel", "Press ⇧⌘J to open a shell");
    expect(el).toBeTruthy();
  });

  it("shows repo creation shortcut hint", async () => {
    const bodyText = await client.executeSync<string>("return document.body.innerText;");
    expect(bodyText).toContain("Press ⌘I to create one.");
  });

  it("shows keyboard shortcuts reference", async () => {
    const bodyText = await client.executeSync<string>("return document.body.innerText;");
    expect(bodyText).toContain("Keyboard Shortcuts");
  });
});
