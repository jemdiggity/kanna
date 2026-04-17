import type { TaskSummary } from "../lib/api/types";

export interface MoreCommandAction {
  id: "refresh" | "pair" | "desktops" | "compose" | "merge-agent" | "close-task";
  title: string;
  copy: string;
}

export interface MoreCommandSection {
  title: string;
  headline: string;
  detail: string;
  actions?: MoreCommandAction[];
}

interface BuildMoreCommandSectionsOptions {
  pairingCode: string | null;
  selectedTask: TaskSummary | null;
}

export function buildMoreCommandSections({
  pairingCode,
  selectedTask
}: BuildMoreCommandSectionsOptions): MoreCommandSection[] {
  const sections: MoreCommandSection[] = [
    {
      title: "Workspace",
      headline: pairingCode ?? "No pairing session",
      detail: "Global mobile commands for refresh, pairing, desktop switching, and task creation."
    },
    {
      title: "Commands",
      headline: "Global actions",
      detail: "Use these to move around the paired desktop from mobile.",
      actions: [
        {
          id: "refresh",
          title: "Refresh Data",
          copy: "Reload desktops, repos, and recent tasks."
        },
        {
          id: "pair",
          title: "Start Pairing",
          copy: "Generate a fresh LAN pairing code."
        },
        {
          id: "desktops",
          title: "Switch Desktop",
          copy: "Jump to the desktop picker."
        },
        {
          id: "compose",
          title: "Create Task",
          copy: "Open the new-task composer."
        }
      ]
    }
  ];

  if (selectedTask) {
    sections.push({
      title: "Selected Task",
      headline: selectedTask.title,
      detail:
        selectedTask.snippet?.trim() ||
        `Stage ${selectedTask.stage ?? "unknown"} is the current mobile checkpoint.`
    });
    sections.push({
      title: "Task Actions",
      headline: selectedTask.stage ?? "unknown",
      detail: "Contextual actions for the currently selected task.",
      actions: [
        {
          id: "merge-agent",
          title: "Run Merge Agent",
          copy: `Spawn the follow-up merge task for ${selectedTask.title}.`
        },
        {
          id: "close-task",
          title: "Close Task",
          copy: `Stop the agent and hide ${selectedTask.title} from the open task list.`
        }
      ]
    });
  }

  return sections;
}
