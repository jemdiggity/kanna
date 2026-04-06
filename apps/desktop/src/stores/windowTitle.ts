export interface AppBuildInfo {
  version: string;
  branch: string;
  commitHash: string;
  worktree: string;
}

export function formatAppWindowTitle(info: AppBuildInfo): string | null {
  const branch = info.branch.trim();
  const worktree = info.worktree.trim();
  const version = info.version.trim();
  const commitHash = info.commitHash.trim();

  if (!worktree && (branch === "" || branch === "main" || branch === "master")) {
    return null;
  }

  const descriptor = worktree ? `${worktree} · ${branch}` : branch;
  return `Kanna — ${descriptor} (${version} @ ${commitHash})`;
}
