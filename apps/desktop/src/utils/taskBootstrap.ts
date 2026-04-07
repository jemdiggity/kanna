export interface TaskBootstrapCommandOptions {
  repoPath: string;
  worktreePath: string;
  branch: string;
  baseBranch?: string;
  setupCmds: string[];
  agentCmd: string;
  defaultBranch?: string | null;
}

function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function renderVisibleStep(command: string): string {
  const escaped = command.replace(/'/g, `'\\''`);
  return `printf '\\033[2m$ %s\\033[0m\\n' '${escaped}'`;
}

function renderWarning(message: string): string {
  const escaped = message.replace(/'/g, `'\\''`);
  return `printf '\\033[33m%s\\033[0m\\n' '${escaped}'`;
}

export function buildTaskBootstrapCommand(options: TaskBootstrapCommandOptions): string {
  const setupLines = options.setupCmds.flatMap((command) => [
    renderVisibleStep(command),
    command,
  ]);

  if (options.baseBranch) {
    return [
      "set -e",
      `cd ${shSingleQuote(`${options.repoPath}/.kanna-worktrees/${options.baseBranch}`)}`,
      renderVisibleStep(`git worktree add -b ${options.branch} ${shSingleQuote(options.worktreePath)} HEAD`),
      `git worktree add -b ${options.branch} ${shSingleQuote(options.worktreePath)} HEAD`,
      `cd ${shSingleQuote(options.worktreePath)}`,
      ...setupLines,
      "printf '\\n'",
      options.agentCmd,
    ].join("\n");
  }

  const defaultBranch = options.defaultBranch ?? "main";

  return [
    "set -e",
    `cd ${shSingleQuote(options.repoPath)}`,
    `start_ref=${shSingleQuote(defaultBranch)}`,
    "if git remote get-url origin >/dev/null 2>&1; then",
    `  ${renderVisibleStep(`git fetch origin ${defaultBranch}`)}`,
    `  if git fetch origin ${defaultBranch}; then`,
    `    start_ref=${shSingleQuote(`origin/${defaultBranch}`)}`,
    "  else",
    `    ${renderWarning(`Fetch failed; using local ${defaultBranch}`)}`,
    "  fi",
    "fi",
    "printf '\\033[2m$ git worktree add -b %s %s %s\\033[0m\\n' \\",
    `  ${shSingleQuote(options.branch)} ${shSingleQuote(options.worktreePath)} \"$start_ref\"`,
    `git worktree add -b ${options.branch} ${shSingleQuote(options.worktreePath)} \"$start_ref\"`,
    `cd ${shSingleQuote(options.worktreePath)}`,
    ...setupLines,
    "printf '\\n'",
    options.agentCmd,
  ].join("\n");
}
