import { access, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const LIVE_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

describe("fixture repo helpers", () => {
  const createdRepoPaths: string[] = [];

  afterEach(async () => {
    if (createdRepoPaths.length === 0) return;

    const { cleanupFixtureRepos } = await import("./fixture-repo");
    await cleanupFixtureRepos(createdRepoPaths.splice(0));
  });

  it("rejects live checkout paths and their descendants", async () => {
    const { assertSafeE2eRepoPath } = await import("./fixture-repo");

    expect(() => assertSafeE2eRepoPath("/tmp/fixture", LIVE_REPO_ROOT)).not.toThrow();
    expect(() => assertSafeE2eRepoPath(LIVE_REPO_ROOT, LIVE_REPO_ROOT)).toThrow(
      /fixture repo/i,
    );
    expect(() => assertSafeE2eRepoPath(`${LIVE_REPO_ROOT}/apps`, LIVE_REPO_ROOT)).toThrow(
      /fixture repo/i,
    );
  });

  it("creates isolated cloned repos outside the live checkout", async () => {
    const { createFixtureRepo } = await import("./fixture-repo");

    const fixtureRepoPath = await createFixtureRepo("fixture-repo-test", {
      sourceRepoPath: LIVE_REPO_ROOT,
    });
    createdRepoPaths.push(fixtureRepoPath);

    expect(fixtureRepoPath.startsWith(`${LIVE_REPO_ROOT}/`)).toBe(false);
    await expect(access(resolve(fixtureRepoPath, ".git"))).resolves.toBeUndefined();

    const { stdout } = await execFileAsync("git", [
      "-C",
      fixtureRepoPath,
      "rev-parse",
      "--show-toplevel",
    ]);
    expect(await realpath(stdout.trim())).toBe(await realpath(fixtureRepoPath));
  });

  it("creates a disposable repo from committed seed content with a local bare origin", async () => {
    const { createSeedFixtureRepo } = await import("./fixture-repo");

    const fixtureRepoPath = await createSeedFixtureRepo("task-switch-minimal");
    createdRepoPaths.push(fixtureRepoPath);

    expect(fixtureRepoPath.startsWith(`${LIVE_REPO_ROOT}/`)).toBe(false);
    await expect(access(resolve(fixtureRepoPath, ".git"))).resolves.toBeUndefined();

    const { stdout: topLevel } = await execFileAsync("git", [
      "-C",
      fixtureRepoPath,
      "rev-parse",
      "--show-toplevel",
    ]);
    expect(await realpath(topLevel.trim())).toBe(await realpath(fixtureRepoPath));

    const { stdout: originUrl } = await execFileAsync("git", [
      "-C",
      fixtureRepoPath,
      "remote",
      "get-url",
      "origin",
    ]);
    const resolvedOriginPath = await realpath(originUrl.trim());
    expect(resolvedOriginPath.endsWith(".git")).toBe(true);

    const { stdout: isBare } = await execFileAsync("git", [
      "--git-dir",
      resolvedOriginPath,
      "rev-parse",
      "--is-bare-repository",
    ]);
    expect(isBare.trim()).toBe("true");

    const { stdout: mainRef } = await execFileAsync("git", [
      "--git-dir",
      resolvedOriginPath,
      "rev-parse",
      "refs/heads/main",
    ]);
    expect(mainRef.trim().length).toBeGreaterThan(0);
  });
});
