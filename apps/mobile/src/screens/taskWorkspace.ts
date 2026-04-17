import type { TaskSummary } from "../lib/api/types";

export interface TaskWorkspaceFact {
  label: string;
  value: string;
}

export interface TaskWorkspaceModel {
  summaryLabel: string;
  summaryCopy: string;
  primaryActionLabel: string;
  facts: TaskWorkspaceFact[];
  terminalLines: string[];
}

interface BuildTaskWorkspaceModelOptions {
  desktopName: string | null;
  repoName: string | null;
  task: TaskSummary;
}

export function buildTaskWorkspaceModel({
  desktopName,
  repoName,
  task
}: BuildTaskWorkspaceModelOptions): TaskWorkspaceModel {
  const stage = task.stage ?? "unknown";
  const resolvedDesktopName = desktopName ?? "Unknown desktop";
  const resolvedRepoName = repoName ?? task.repoId;
  const summary = getStageSummary(stage, task.title);

  return {
    summaryLabel: summary.label,
    summaryCopy: summary.copy,
    primaryActionLabel: "Command Palette",
    facts: [
      { label: "Desktop", value: resolvedDesktopName },
      { label: "Repo", value: resolvedRepoName },
      { label: "Stage", value: stage },
      { label: "Task", value: task.id }
    ],
    terminalLines: [
      `desktop://${resolvedDesktopName}`,
      `repo://${resolvedRepoName}`,
      `task://${task.id}`,
      `stage://${stage}`
    ]
  };
}

function getStageSummary(stage: string, taskTitle: string): {
  label: string;
  copy: string;
} {
  switch (stage) {
    case "pr":
      return {
        label: "Review task",
        copy: `${taskTitle} is review-ready. Use the command palette for the merge path or jump back to search to open a different task.`
      };
    case "merge":
      return {
        label: "Merge task",
        copy: `${taskTitle} is in the merge stage. Keep this task open as the mobile checkpoint while desktop-side work finishes.`
      };
    default:
      return {
        label: "Resume agent task",
        copy: `${taskTitle} is still active. Use this screen as the mobile checkpoint, then open the command palette for task actions or switch back to the task list.`
      };
  }
}
