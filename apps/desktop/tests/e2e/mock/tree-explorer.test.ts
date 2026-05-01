import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildGlobalKeydownScript } from "../helpers/keyboard";
import { WebDriverClient } from "../helpers/webdriver";
import { cleanupFixtureRepos, createSeedFixtureRepo } from "../helpers/fixture-repo";

const REPO_NAME = "task-switch-minimal";
const IGNORED_FILE = "ignored-output.log";

async function pressKey(
  client: WebDriverClient,
  key: string,
  opts: { meta?: boolean; shift?: boolean; alt?: boolean } = {},
): Promise<void> {
  await client.executeSync(buildGlobalKeydownScript({
    key,
    meta: opts.meta,
    shift: opts.shift,
    alt: opts.alt,
  }));
}

async function textContent(client: WebDriverClient, selector: string): Promise<string> {
  return await client.executeSync<string>(
    `return document.querySelector(${JSON.stringify(selector)})?.textContent ?? "";`,
  );
}

async function importRepoThroughUi(client: WebDriverClient, repoPath: string): Promise<void> {
  await pressKey(client, "I", { meta: true, shift: true });
  const input = await client.waitForElement(".modal .text-input", 5_000);
  await client.sendKeys(input, repoPath);
  await client.waitForText(".modal", "Git repo", 10_000);
  const submit = await client.waitForElement(".modal-footer .btn-primary", 5_000);
  await client.click(submit);
  await client.waitForText(".repo-header", REPO_NAME, 10_000);
}

async function waitForExplorerText(
  client: WebDriverClient,
  expected: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await textContent(client, ".tree-modal");
    if (text.includes(expected)) return;
    await sleep(100);
  }
  throw new Error(`tree explorer never showed ${expected}`);
}

describe("tree explorer", () => {
  const client = new WebDriverClient();
  let fixtureRepoPath = "";

  beforeAll(async () => {
    fixtureRepoPath = await createSeedFixtureRepo("task-switch-minimal");
    await writeFile(join(fixtureRepoPath, ".gitignore"), "*.log\n", "utf8");
    await writeFile(join(fixtureRepoPath, IGNORED_FILE), "ignored\n", "utf8");
    await client.createSession();
  });

  afterAll(async () => {
    await cleanupFixtureRepos(fixtureRepoPath ? [fixtureRepoPath] : []);
    await client.deleteSession();
  });

  it("toggles ignored files through the UI for an imported fixture repo", async () => {
    await importRepoThroughUi(client, fixtureRepoPath);

    await pressKey(client, "E", { meta: true, shift: true });
    await client.waitForElement(".tree-modal", 5_000);
    await waitForExplorerText(client, "README.md");

    expect(await textContent(client, ".tree-modal")).not.toContain(IGNORED_FILE);

    const toggle = await client.waitForElement(".show-all-toggle", 2_000);
    await client.click(toggle);
    await waitForExplorerText(client, IGNORED_FILE);

    expect(await textContent(client, ".show-all-toggle")).toContain("showing all");
  });
});
