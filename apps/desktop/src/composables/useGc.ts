import { invoke } from "../invoke";
import { hasTag } from "@kanna/core";
import type { DbHandle, PipelineItem } from "@kanna/db";
import { listRepos, listPipelineItems } from "@kanna/db";
import { useKannaStore } from "../stores/kanna";

const GC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function useGc(db: DbHandle) {
  const store = useKannaStore();

  async function runGc() {
    try {
      const allRepos = await listRepos(db);
      const allItems: PipelineItem[] = [];
      for (const repo of allRepos) {
        allItems.push(...await listPipelineItems(db, repo.id));
      }

      const cutoff = new Date(Date.now() - store.gcAfterDays * 86400000).toISOString();
      const stale = allItems.filter(
        (i) => hasTag(i, "done") && i.updated_at < cutoff
      );
      for (const item of stale) {
        if (item.branch) {
          const repo = allRepos.find((r) => r.id === item.repo_id);
          if (repo) {
            const worktreePath = `${repo.path}/.kanna-worktrees/${item.branch}`;
            await invoke("git_worktree_remove", { repoPath: repo.path, path: worktreePath }).catch((e: unknown) =>
              console.error("[gc] worktree remove failed:", e)
            );
          }
        }
        await db.execute("DELETE FROM pipeline_item WHERE id = ?", [item.id]);
      }
      if (stale.length > 0) {
        console.log(`[gc] cleaned up ${stale.length} done task(s)`);
        await db.execute(
          `DELETE FROM task_blocker WHERE blocker_item_id NOT IN (SELECT id FROM pipeline_item)
           OR blocked_item_id NOT IN (SELECT id FROM pipeline_item)`,
        );
        store.bump();
      }
    } catch (e) {
      console.error("[gc] failed:", e);
    }
  }

  // Run immediately, then every hour
  runGc();
  setInterval(runGc, GC_INTERVAL_MS);

  return { runGc };
}
