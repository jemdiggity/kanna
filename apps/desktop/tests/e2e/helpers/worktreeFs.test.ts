import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { findNewTaskWorktree, waitForFile } from "./worktreeFs";

const tempDirs: string[] = [];

describe("worktreeFs", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("finds the one newly created task worktree compared with a baseline", async () => {
    const root = await mkdtemp(join(tmpdir(), "kanna-worktree-fs-"));
    tempDirs.push(root);
    const worktreesDir = join(root, ".kanna-worktrees");
    await mkdir(join(worktreesDir, "task-existing"), { recursive: true });
    await mkdir(join(worktreesDir, "task-new"), { recursive: true });

    const result = await findNewTaskWorktree(root, new Set(["task-existing"]));

    expect(result).toBe(join(worktreesDir, "task-new"));
  });

  it("waits for a file to appear in the worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "kanna-worktree-fs-"));
    tempDirs.push(root);
    const target = join(root, "e2e-test-output.txt");

    setTimeout(() => {
      void writeFile(target, "E2E test content", "utf8");
    }, 20);

    await expect(waitForFile(target, 1_000, 10)).resolves.toBeUndefined();
  });
});
