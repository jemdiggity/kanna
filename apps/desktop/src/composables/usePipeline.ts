import { ref, type Ref } from "vue";
import { invoke } from "../invoke";
import type { DbHandle } from "@kanna/db";
import type { PipelineItem } from "@kanna/db";
import { listPipelineItems, updatePipelineItemStage, insertPipelineItem } from "@kanna/db";
import { canTransition, parseKannaConfig, type Stage } from "@kanna/core";

export function usePipeline(db: Ref<DbHandle | null>) {
  const items = ref<PipelineItem[]>([]);
  const selectedItemId = ref<string | null>(null);

  async function loadItems(repoId: string) {
    if (!db.value) return;
    items.value = await listPipelineItems(db.value, repoId);
  }

  async function transition(itemId: string, toStage: Stage) {
    if (!db.value) return;
    const item = items.value.find((i) => i.id === itemId);
    if (!item) return;
    if (!canTransition(item.stage as Stage, toStage)) return;
    await updatePipelineItemStage(db.value, itemId, toStage);
    item.stage = toStage;
  }

  async function createItem(repoId: string, repoPath: string, prompt: string) {
    if (!db.value) return;
    const id = crypto.randomUUID();
    const branch = `task-${id}`;
    const worktreePath = `${repoPath}/.kanna-worktrees/${branch}`;

    // 1. Create git worktree
    await invoke("git_worktree_add", {
      repoPath,
      branch,
      path: worktreePath,
    });

    // 2. Read .kanna.toml config and run setup script if defined
    try {
      const configContent = await invoke<string>("read_text_file", {
        path: `${repoPath}/.kanna.toml`,
      });
      if (configContent) {
        const config = parseKannaConfig(configContent);
        if (config.tasks?.setup) {
          await invoke("run_script", {
            script: config.tasks.setup,
            cwd: worktreePath,
            env: {},
          });
        }
      }
    } catch {
      // No .kanna.toml or parse error — continue without setup
    }

    // 3. Insert pipeline item to DB
    await insertPipelineItem(db.value, {
      id,
      repo_id: repoId,
      issue_number: null,
      issue_title: null,
      prompt,
      stage: "in_progress",
      pr_number: null,
      pr_url: null,
      branch,
      agent_type: null,
    });

    // 4. Spawn Claude agent session with dangerously-skip-permissions
    await invoke("create_agent_session", {
      sessionId: id,
      cwd: worktreePath,
      prompt,
      systemPrompt: null,
      permissionMode: "dontAsk",
    });

    // 5. Refresh pipeline items and select the new one
    await loadItems(repoId);
    selectedItemId.value = id;
  }

  function selectedItem(): PipelineItem | null {
    if (!selectedItemId.value) return null;
    return items.value.find((i) => i.id === selectedItemId.value) ?? null;
  }

  return {
    items,
    selectedItemId,
    loadItems,
    transition,
    createItem,
    selectedItem,
  };
}
