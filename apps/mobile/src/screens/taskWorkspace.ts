import type { TaskSummary } from "../lib/api/types";
import type { TaskTerminalStatus } from "../state/sessionStore";

export interface TaskWorkspaceModel {
  stageLabel: string;
  title: string;
  isTerminalHealthy: boolean;
  overlayLabel: string | null;
  isComposerDisabled: boolean;
  chromeStyle: "floating";
  terminalLayout: "fullscreen";
  titlePresentation: "chip";
}

interface BuildTaskWorkspaceModelOptions {
  task: TaskSummary;
  terminalStatus: TaskTerminalStatus;
}

export function buildTaskWorkspaceModel({
  task,
  terminalStatus
}: BuildTaskWorkspaceModelOptions): TaskWorkspaceModel {
  return {
    stageLabel: task.stage ?? "unknown",
    title: task.title,
    isTerminalHealthy: terminalStatus === "live",
    overlayLabel: getOverlayLabel(terminalStatus),
    isComposerDisabled: terminalStatus !== "live",
    chromeStyle: "floating",
    terminalLayout: "fullscreen",
    titlePresentation: "chip"
  };
}

function getOverlayLabel(status: TaskTerminalStatus): string | null {
  switch (status) {
    case "connecting":
      return "Connecting";
    case "closed":
      return "Offline";
    case "error":
      return "Error";
    case "idle":
      return "Connecting";
    case "live":
    default:
      return null;
  }
}
