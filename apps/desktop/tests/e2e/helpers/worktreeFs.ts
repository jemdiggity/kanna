import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export async function findNewTaskWorktree(
  repoPath: string,
  baseline: Set<string>,
): Promise<string | null> {
  const worktreesDir = join(repoPath, ".kanna-worktrees");
  const entries = await readdir(worktreesDir, { withFileTypes: true }).catch(() => []);
  const match = entries.find((entry) =>
    entry.isDirectory() &&
    entry.name.startsWith("task-") &&
    !baseline.has(entry.name),
  );
  return match ? join(worktreesDir, match.name) : null;
}

export async function waitForNewTaskWorktree(
  repoPath: string,
  baseline: Set<string>,
  timeoutMs = 20_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const worktreePath = await findNewTaskWorktree(repoPath, baseline);
    if (worktreePath) {
      return worktreePath;
    }
    await sleep(200);
  }

  throw new Error(`timed out waiting for new task worktree under ${repoPath}`);
}

export async function waitForFile(
  path: string,
  timeoutMs = 120_000,
  pollMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await sleep(pollMs);
    }
  }

  throw new Error(`timed out waiting for file ${path}`);
}
