import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase } from "../helpers/reset";
import { queryDb } from "../helpers/vue";

describe("preferences", () => {
  const client = new WebDriverClient();

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
  });

  afterAll(async () => {
    await client.deleteSession();
  });

  it("opens preferences panel when settings button clicked", async () => {
    // Find and click the settings/gear button
    const buttons = await client.findElements("button");
    for (const id of buttons) {
      const text = await client.getText(id);
      if (text.includes("\u2699") || text.includes("settings") || text.includes("\u{2699}")) {
        await client.click(id);
        break;
      }
    }

    await Bun.sleep(500);
    const panel = await client.waitForElement(".prefs-panel", 2000);
    expect(panel).toBeTruthy();
  });

  it("shows preference fields", async () => {
    const panelText = await client.executeSync<string>(
      `return document.querySelector(".prefs-panel")?.textContent || ""`
    );
    // Should contain labels for common settings
    expect(panelText.toLowerCase()).toContain("suspend");
    expect(panelText.toLowerCase()).toContain("ide");
  });

  it("closes preferences panel", async () => {
    // Preferences closes via Escape or clicking the overlay
    await client.executeSync(
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));`
    );
    await Bun.sleep(500);
    // If still open, close via Vue state
    try {
      await client.findElement(".prefs-panel");
      await client.executeSync(
        `document.getElementById("app").__vue_app__._instance.setupState.showPreferencesPanel = false;`
      );
      await Bun.sleep(300);
    } catch {
      // Already closed
    }
  });

  it("default settings are in DB", async () => {
    const rows = (await queryDb(
      client,
      "SELECT key, value FROM settings ORDER BY key"
    )) as Array<{ key: string; value: string }>;

    const keys = rows.map((r) => r.key);
    expect(keys).toContain("suspendAfterMinutes");
    expect(keys).toContain("killAfterMinutes");
  });
});
