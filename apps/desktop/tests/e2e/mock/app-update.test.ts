import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase } from "../helpers/reset";

async function injectUpdate(
  client: WebDriverClient,
  options: {
    version: string;
    body?: string;
    contentLength?: number;
    chunks?: number[];
    delayMs?: number;
    failInstall?: boolean;
    failInstallAttempts?: number;
    failMessage?: string;
  },
): Promise<void> {
  await client.executeSync(
    `window.__KANNA_E2E__.setupState.appUpdate.__e2eInjectUpdate(${JSON.stringify(options)});`,
  );
}

describe("app update prompt", () => {
  const client = new WebDriverClient();

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
  });

  afterAll(async () => {
    await client.deleteSession();
  });

  it("installs an available update and lets the user restart later", async () => {
    await injectUpdate(client, {
      version: "9.9.9",
      body: "Mock release notes",
      contentLength: 84,
      chunks: [20, 64],
      delayMs: 50,
    });

    await client.waitForText(".update-prompt", "Update available", 2000);
    await client.waitForText(".update-prompt", "9.9.9", 2000);
    await client.waitForText(".update-prompt", "Mock release notes", 2000);

    await client.click(await client.waitForElement('[data-testid="update-install"]', 2000));
    await client.waitForText(".update-prompt", "Downloading update", 2000);
    await client.waitForText(".update-prompt", "84", 2000);
    await client.waitForText(".update-prompt", "Ready to restart", 2000);

    await client.click(await client.waitForElement('[data-testid="update-later"]', 2000));
    await client.waitForNoElement(".update-prompt", 2000);
  });

  it("shows install failures and retries successfully", async () => {
    await injectUpdate(client, {
      version: "9.9.10",
      body: "Broken mock release",
      contentLength: 12,
      chunks: [12],
      failInstallAttempts: 1,
      failMessage: "mock install failed",
    });

    await client.waitForText(".update-prompt", "Update available", 2000);
    await client.click(await client.waitForElement('[data-testid="update-install"]', 2000));
    await client.waitForText(".update-prompt", "Update failed", 2000);
    await client.waitForText(".update-prompt", "mock install failed", 2000);

    await client.click(await client.waitForElement('[data-testid="update-retry"]', 2000));
    await client.waitForText(".update-prompt", "Ready to restart", 2000);

    await client.click(await client.waitForElement('[data-testid="update-later"]', 2000));
    await client.waitForNoElement(".update-prompt", 2000);
  });
});
