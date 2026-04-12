export interface TaskBootstrapCommandOptions {
  worktreePath: string;
  visibleBootstrapSteps: string[];
  setupCmds: string[];
  agentCmd: string;
}

function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function renderVisibleStep(command: string): string {
  const escaped = command.replace(/'/g, `'\\''`);
  return `printf '\\033[2m$ %s\\033[0m\\n' '${escaped}'`;
}

export function buildTaskBootstrapCommand(options: TaskBootstrapCommandOptions): string {
  const visibleBootstrapLines = options.visibleBootstrapSteps.map((command) => renderVisibleStep(command));
  const setupLines = options.setupCmds.flatMap((command) => [
    renderVisibleStep(command),
    command,
  ]);

  return [
    "set -e",
    ...visibleBootstrapLines,
    `cd ${shSingleQuote(options.worktreePath)}`,
    ...setupLines,
    "printf '\\n'",
    options.agentCmd,
  ].join("\n");
}
