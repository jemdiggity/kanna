import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildGlobalKeydownScript } from "../helpers/keyboard";
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase } from "../helpers/reset";

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
    await client.executeSync(buildGlobalKeydownScript({ key: ",", meta: true }));
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
    await client.executeSync(buildGlobalKeydownScript({ key: "Escape" }));
    await client.waitForNoElement(".prefs-panel", 2_000);
  });

  it("shows default settings in the UI", async () => {
    await client.executeSync(buildGlobalKeydownScript({ key: ",", meta: true }));
    const panel = await client.waitForElement(".prefs-panel", 2_000);
    expect(panel).toBeTruthy();

    const values = await client.executeSync<string[]>(
      `return Array.from(document.querySelectorAll(".prefs-panel input, .prefs-panel select"))
        .map((element) => element.value);`
    );
    expect(values).toContain("5");
    expect(values).toContain("30");
  });
});
