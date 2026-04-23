import type { RepoConfig } from "@kanna/core";

export interface BuildWorktreeSessionEnvOptions {
  worktreePath: string;
  baseEnv?: Record<string, string>;
  repoConfig?: RepoConfig;
  portEnv?: Record<string, string>;
  inheritedPath?: string | null;
}

function resolveWorkspacePath(worktreePath: string, entry: string): string {
  if (entry.startsWith("/")) {
    return entry;
  }

  const normalizedRoot = worktreePath.endsWith("/") ? worktreePath : `${worktreePath}/`;
  return decodeURIComponent(new URL(entry, `file://${normalizedRoot}`).pathname);
}

export function buildWorktreeSessionEnv(options: BuildWorktreeSessionEnvOptions): Record<string, string> {
  const env = { ...(options.baseEnv ?? {}) };
  const workspace = options.repoConfig?.workspace;

  if (workspace?.env) {
    Object.assign(env, workspace.env);
  }

  const prependEntries = (workspace?.path?.prepend ?? []).map((entry) => resolveWorkspacePath(options.worktreePath, entry));
  const appendEntries = (workspace?.path?.append ?? []).map((entry) => resolveWorkspacePath(options.worktreePath, entry));

  if (prependEntries.length > 0 || appendEntries.length > 0) {
    const pathParts = [
      ...prependEntries,
      env.PATH ?? options.inheritedPath ?? "",
      ...appendEntries,
    ].filter((entry) => entry.length > 0);

    if (pathParts.length > 0) {
      env.PATH = pathParts.join(":");
    }
  }

  if (options.portEnv) {
    Object.assign(env, options.portEnv);
  }

  return env;
}
