import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase, importTestRepo } from "../helpers/reset";
import { cleanupFixtureRepos, createFixtureRepo } from "../helpers/fixture-repo";

describe("import repo", () => {
  const client = new WebDriverClient();
  let firstRepoRoot = "";
  let secondRepoRoot = "";
  let firstRepoPath = "";
  let secondRepoPath = "";

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
    firstRepoRoot = await createFixtureRepo("kanna-tauri");
    secondRepoRoot = await createFixtureRepo("second-repo");
    firstRepoPath = join(firstRepoRoot, "apps");
    secondRepoPath = join(secondRepoRoot, "apps");
  });

  afterAll(async () => {
    await cleanupFixtureRepos([firstRepoRoot, secondRepoRoot].filter(Boolean));
    await client.deleteSession();
  });

  it("imports a repo and shows it in the sidebar", async () => {
    await importTestRepo(client, firstRepoPath, "kanna-tauri");

    // Repo should appear in sidebar
    const el = await client.waitForText(".repo-header", "kanna-tauri");
    expect(el).toBeTruthy();
  });

  it("shows task count badge as 0", async () => {
    // The repo header shows the count
    const text = await client.executeSync<string>(
      `const headers = document.querySelectorAll(".repo-header");
       for (const h of headers) {
         if (h.textContent.includes("kanna-tauri")) return h.textContent;
       }
       return "";`
    );
    expect(text).toContain("0");
  });

  it("shows No tasks under repo", async () => {
    const el = await client.waitForText(".sidebar", "No tasks");
    expect(el).toBeTruthy();
  });

  it("can import a second repo", async () => {
    await importTestRepo(client, secondRepoPath, "second-repo");
    await client.waitForText(".sidebar", "second-repo", 10000);
    const text = await client.executeSync<string>(
      `return document.querySelector(".sidebar").textContent;`
    );
    expect(text).toContain("kanna-tauri");
    expect(text).toContain("second-repo");
  });

  it("can select between repos", async () => {
    const headers = await client.findElements(".repo-header");
    let firstHeader: string | null = null;
    let secondHeader: string | null = null;
    for (const header of headers) {
      const text = await client.getText(header);
      if (text.includes("kanna-tauri")) firstHeader = header;
      if (text.includes("second-repo")) secondHeader = header;
    }
    expect(firstHeader).toBeTruthy();
    expect(secondHeader).toBeTruthy();
    if (!firstHeader || !secondHeader) {
      throw new Error("expected both imported repos to be visible");
    }

    await client.click(firstHeader);
    await client.waitForText(".repo-header.selected", "kanna-tauri");

    await client.click(secondHeader);
    await client.waitForText(".repo-header.selected", "second-repo");
  });
});
