import {
  renderBestEffortLifecycleCommand,
  renderVisibleLifecycleCommand,
  shellSingleQuote,
} from "./lifecycleCommands";

export interface TaskBootstrapCommandOptions {
  worktreePath: string;
  visibleBootstrapSteps: string[];
  setupCmds: string[];
  agentCmd: string;
}

export function buildTaskBootstrapCommand(options: TaskBootstrapCommandOptions): string {
  const visibleBootstrapLines = options.visibleBootstrapSteps.map((command) => renderVisibleLifecycleCommand(command));
  const setupLines = options.setupCmds.map((command) => renderBestEffortLifecycleCommand(command, "Setup"));

  return [
    "set -e",
    ...visibleBootstrapLines,
    `cd '${shellSingleQuote(options.worktreePath)}'`,
    ...setupLines,
    "printf '\\n'",
    options.agentCmd,
  ].join("\n");
}
