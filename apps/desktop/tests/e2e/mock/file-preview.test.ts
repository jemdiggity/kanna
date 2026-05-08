import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setTimeout as sleep } from "node:timers/promises";
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

  async function isPreviewVisible(): Promise<boolean> {
    return await client.executeSync<boolean>(
      `const modal = document.querySelector(".preview-modal");
       if (!modal) return false;
       const rect = modal.getBoundingClientRect();
       const style = getComputedStyle(modal);
       return style.display !== "none" &&
         style.visibility !== "hidden" &&
         rect.width > 0 &&
         rect.height > 0;`,
    );
  }

  async function waitForPreviewHidden(): Promise<void> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (!(await isPreviewVisible())) return;
      await sleep(200);
    }
    throw new Error("preview modal remained visible");
  }

  async function waitForPreviewVisible(): Promise<void> {
    await client.waitForElement(".preview-modal", 5000);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await isPreviewVisible()) return;
      await sleep(200);
    }
    throw new Error("preview modal did not become visible");
  }

  async function waitForRenderedMarkdown(): Promise<void> {
    await client.waitForElement(".preview-content.markdown-rendered h1", 5000);
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

    const modeBadge = await client.waitForElement(".preview-modal .mode-badge", 5000);
    await client.click(modeBadge);
    await waitForRenderedMarkdown();
    expect(await client.getText(modeBadge)).toBe("Rendered");

    await pressKey("π", { meta: true, alt: true, code: "KeyP" });
    await waitForPreviewHidden();

    await pressKey("π", { meta: true, alt: true, code: "KeyP" });
    await waitForPreviewVisible();
    expect(await previewedFilePath()).toBe("README.md");
    const restoredModeBadge = await client.waitForElement(".preview-modal .mode-badge", 5000);
    expect(await client.getText(restoredModeBadge)).toBe("Rendered");
    await waitForRenderedMarkdown();
  });
});
