import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildGlobalKeydownScript,
} from "../helpers/keyboard";
import { WebDriverClient } from "../helpers/webdriver";
import { cleanupFixtureRepos, createFixtureRepo } from "../helpers/fixture-repo";
import { importTestRepo, resetDatabase } from "../helpers/reset";

describe("commit graph", () => {
  const client = new WebDriverClient();
  let fixtureRepoRoot = "";
  let testRepoPath = "";

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
    fixtureRepoRoot = await createFixtureRepo("commit-graph-test");
    testRepoPath = join(fixtureRepoRoot, "apps");
    await importTestRepo(client, testRepoPath, "commit-graph-test");
  });

  afterAll(async () => {
    await cleanupFixtureRepos(fixtureRepoRoot ? [fixtureRepoRoot] : []);
    await client.deleteSession();
  });

  it("opens search inside the commit graph and closes search before the modal", async () => {
    await client.executeSync(
      "window.__KANNA_E2E__.setupState.showCommitGraphModal = true;"
    );

    await client.waitForElement(".graph-modal", 5000);
    await client.waitForElement(".graph-scroll", 5000);

    await client.executeSync(buildGlobalKeydownScript({ key: "/" }));

    const searchInput = await client.waitForElement(".graph-modal .search-input", 5000);
    await client.sendKeys(searchInput, "main");
    const searchCount = await client.waitForElement(".graph-modal .search-count", 5000);
    const countText = await client.getText(searchCount);
    expect(countText.length).toBeGreaterThan(0);

    await client.executeSync(
      `const input = document.querySelector(".graph-modal .search-input");
       if (input instanceof HTMLElement) input.focus();`
    );
    await client.pressKey("\uE00C");

    await client.waitForNoElement(".graph-modal .search-input", 5000);
    await client.waitForElement(".graph-modal", 5000);
  });
});
