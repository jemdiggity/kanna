import { invoke } from "@tauri-apps/api/core";
import type { MobileRepo, MobileTask } from "./mobile-types";

interface PipelineItemRow {
  id: string;
  repo_id: string;
  prompt: string | null;
  display_name: string | null;
  stage: string;
  pr_number: number | null;
  branch: string | null;
  pinned: number | null;
  pin_order: number | null;
  created_at: string | null;
  updated_at: string | null;
  last_output_preview: string | null;
}

function taskTitle(row: PipelineItemRow): string {
  const title = row.display_name ?? row.prompt ?? row.id;
  return title.length > 80 ? `${title.slice(0, 79)}…` : title;
}

export async function loadMobileRepos(): Promise<MobileRepo[]> {
  return invoke<MobileRepo[]>("list_repos");
}

export async function loadMobileTasks(repoId: string, repoName: string): Promise<MobileTask[]> {
  const rows = await invoke<PipelineItemRow[]>("list_pipeline_items", { repoId });
  return rows
    .filter((row) => row.stage !== "done")
    .map((row) => ({
      id: row.id,
      repo_id: row.repo_id,
      title: taskTitle(row),
      repoName,
      stage: row.stage,
      branch: row.branch,
      displayName: row.display_name,
      prompt: row.prompt,
      prNumber: row.pr_number,
      pinned: row.pinned === 1,
      pinOrder: row.pin_order,
      updatedAt: row.updated_at,
      createdAt: row.created_at,
      lastOutputPreview: row.last_output_preview ?? "",
    }));
}
