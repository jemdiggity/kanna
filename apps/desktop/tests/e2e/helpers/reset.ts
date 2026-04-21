/**
 * Test reset helpers — clean DB state and worktrees between test files.
 */
import { join } from "path";
import { copyFile, access } from "fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { WebDriverClient } from "./webdriver";
import { execDb, callVueMethod, getVueState, queryDb, tauriInvoke } from "./vue";
import { assertSafeE2eRepoPath } from "./fixture-repo";

interface GitWorktreeEntry {
  name?: string;
  path?: string;
}

const worktreeCleanupBaselines = new Map<string, Set<string>>();
const IMPORT_REPO_SELECTION_TIMEOUT_MS = 10_000;
const IMPORT_REPO_SELECTION_POLL_MS = 100;

async function recordWorktreeCleanupBaseline(
  client: WebDriverClient,
  repoPath: string
): Promise<void> {
  const result = await tauriInvoke(client, "git_worktree_list", { repoPath });
  const worktrees = Array.isArray(result) ? result as GitWorktreeEntry[] : [];
  worktreeCleanupBaselines.set(
    repoPath,
    new Set(
      worktrees
        .map((wt) => wt.path)
        .filter((path): path is string => typeof path === "string" && path.length > 0)
    )
  );
}

async function getTrackedTaskWorktreePaths(
  client: WebDriverClient,
  repoPath: string
): Promise<Set<string>> {
  const rows = await queryDb(
    client,
    `SELECT branch
       FROM pipeline_item
      WHERE branch IS NOT NULL
        AND branch != ''
        AND repo_id IN (SELECT id FROM repo WHERE path = ?)`,
    [repoPath],
  ) as Array<{ branch?: string | null }>;

  return new Set(
    rows
      .map((row) => row.branch)
      .filter((branch): branch is string => typeof branch === "string" && branch.length > 0)
      .map((branch) => join(repoPath, ".kanna-worktrees", branch)),
  );
}

/** Back up the SQLite DB file before wiping. Best-effort — logs but never throws. */
async function getAppDataDir(client: WebDriverClient): Promise<string> {
  const appDataDir = await tauriInvoke(client, "get_app_data_dir");
  if (typeof appDataDir !== "string") {
    throw new Error(`Unexpected app data dir: ${JSON.stringify(appDataDir)}`);
  }
  return appDataDir;
}

async function backupDatabase(client: WebDriverClient, dbFileName: string): Promise<void> {
  const appDataDir = await getAppDataDir(client);
  const src = join(appDataDir, dbFileName);
  try {
    await access(src);
  } catch {
    return; // DB file doesn't exist yet — nothing to back up
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(appDataDir, `${dbFileName}.backup-${timestamp}`);
  try {
    await copyFile(src, dest);
    console.log(`[reset] backed up ${dbFileName} → ${dest}`);
  } catch (err) {
    console.error(`[reset] WARNING: failed to back up ${dbFileName}:`, err);
  }
}

/** Reset all DB tables to a clean state with default settings. */
export async function resetDatabase(client: WebDriverClient): Promise<void> {
  // Safety: refuse to wipe the production database
  const currentDb = await getVueState(client, "dbName") as string;
  if (!currentDb || currentDb === "kanna-v2.db") {
    throw new Error(
      `REFUSING to wipe database "${currentDb}" — production DB is not allowed.\n` +
      `Start the app from a worktree with: ./scripts/dev.sh start -a`
    );
  }

  // Back up the DB file before wiping
  await backupDatabase(client, currentDb);

  // Delete in FK-safe order (children before parents)
  await execDb(client, "DELETE FROM terminal_session");
  await execDb(client, "DELETE FROM worktree");
  await execDb(client, "DELETE FROM agent_run");
  await execDb(client, "DELETE FROM pipeline_item");
  await execDb(client, "DELETE FROM repo");
  await execDb(client, "DELETE FROM settings");

  // Re-insert default settings
  const defaults = [
    ["suspendAfterMinutes", "5"],
    ["killAfterMinutes", "30"],
    ["ideCommand", "code"],
  ];
  for (const [key, value] of defaults) {
    await execDb(client, "INSERT INTO settings (key, value) VALUES (?, ?)", [key, value]);
  }

  // Refresh the Vue state so the UI reflects the empty DB
  await callVueMethod(client, "refreshRepos");
}

export async function cleanupWorktrees(
  client: WebDriverClient,
  repoPath: string
): Promise<void> {
  assertSafeE2eRepoPath(repoPath);
  const baseline = worktreeCleanupBaselines.get(repoPath);
  if (!baseline) return;

  try {
    const trackedPaths = await getTrackedTaskWorktreePaths(client, repoPath);
    const result = await tauriInvoke(client, "git_worktree_list", { repoPath });
    const worktrees = Array.isArray(result) ? result as GitWorktreeEntry[] : [];

    for (const wt of worktrees) {
      if (
        wt.name?.startsWith("task-") &&
        typeof wt.path === "string" &&
        !baseline.has(wt.path) &&
        trackedPaths.has(wt.path)
      ) {
        try {
          await tauriInvoke(client, "git_worktree_remove", { repoPath, path: wt.path });
        } catch {
          // Worktree may already be removed
        }
      }
    }
  } catch {
    // Cleanup is best-effort — don't fail tests
  } finally {
    worktreeCleanupBaselines.delete(repoPath);
  }
}

/**
 * Import a test repo and select it.
 * Returns the repo ID.
 */
export async function importTestRepo(
  client: WebDriverClient,
  repoPath: string,
  name = "test-repo",
  branch = "main"
): Promise<string> {
  assertSafeE2eRepoPath(repoPath);
  await recordWorktreeCleanupBaseline(client, repoPath);
  await callVueMethod(client, "handleImportRepo", repoPath, name, branch);
  const rows = (await queryDb(
    client,
    "SELECT id, name FROM repo WHERE path = ?",
    [repoPath],
  )) as Array<{ id: string; name: string }>;
  const repo = rows.find((entry) => entry.name === name) ?? rows[0];
  if (!repo) throw new Error(`Repo "${name}" not found after import`);

  // Select it
  await callVueMethod(client, "handleSelectRepo", repo.id);
  const deadline = Date.now() + IMPORT_REPO_SELECTION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const selected = await client.executeSync<{
      selectedRepoId: string | null;
      selectedRepoPath: string | null;
    }>(`const ctx = window.__KANNA_E2E__.setupState;
      return {
        selectedRepoId: ctx.store?.selectedRepoId?.value ?? null,
        selectedRepoPath: ctx.store?.selectedRepo?.path ?? null,
      };`);
    if (selected.selectedRepoId === repo.id || selected.selectedRepoPath === repoPath) {
      return repo.id;
    }
    await sleep(IMPORT_REPO_SELECTION_POLL_MS);
  }

  throw new Error(`Repo "${name}" was imported but never became selected.`);
}
