import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildGlobalKeydownScript } from "../helpers/keyboard";
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase, importTestRepo } from "../helpers/reset";
import { cleanupFixtureRepos, createSeedFixtureRepo } from "../helpers/fixture-repo";

describe("file preview", () => {
  const client = new WebDriverClient();
  let fixtureRepoPath = "";

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
    fixtureRepoPath = await createSeedFixtureRepo("task-switch-minimal");
    await importTestRepo(client, fixtureRepoPath, "file-preview-fixture");
  });

  afterAll(async () => {
    await cleanupFixtureRepos(fixtureRepoPath ? [fixtureRepoPath] : []);
    await client.deleteSession();
  });

  async function pressKey(
    key: string,
    opts: { code?: string; meta?: boolean; shift?: boolean; alt?: boolean } = {},
  ) {
    await client.executeSync(buildGlobalKeydownScript({
      key,
      code: opts.code,
      meta: opts.meta,
      shift: opts.shift,
      alt: opts.alt,
    }));
  }

  async function previewedFilePath(): Promise<string> {
    const element = await client.waitForElement(".preview-modal .file-path", 5000);
    return await client.getText(element);
  }

  it("opens the picker from preview, selects another file, and recalls it with Option+Command+P", async () => {
    await pressKey("p", { meta: true });
    await client.waitForElement(".picker-modal", 5000);

    const firstFile = await client.waitForText(".file-item", "src/index.txt", 5000);
    await client.click(firstFile);

    expect(await previewedFilePath()).toBe("src/index.txt");

    await pressKey("p", { meta: true });
    await client.waitForElement(".picker-modal", 5000);

    const secondFile = await client.waitForText(".file-item", "README.md", 5000);
    await client.click(secondFile);

    expect(await previewedFilePath()).toBe("README.md");
    await client.waitForNoElement(".picker-modal", 5000);

    await pressKey("p", { meta: true });
    await client.waitForElement(".picker-modal", 5000);

    await pressKey("Escape");
    await client.waitForNoElement(".picker-modal", 5000);
    expect(await previewedFilePath()).toBe("README.md");

    await pressKey("Escape");
    await client.waitForNoElement(".preview-modal", 5000);
    await client.waitForNoElement(".picker-modal", 5000);

    await pressKey("π", { meta: true, alt: true, code: "KeyP" });
    expect(await previewedFilePath()).toBe("README.md");

    await pressKey("π", { meta: true, alt: true, code: "KeyP" });
    await client.waitForNoElement(".preview-modal", 5000);

    await pressKey("π", { meta: true, alt: true, code: "KeyP" });
    expect(await previewedFilePath()).toBe("README.md");
  });
});
