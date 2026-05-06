export interface ResolveInitialBaseRefOptions {
  selectedBaseBranch?: string;
  availableBaseBranches?: string[];
  defaultBranch: string;
}

export function resolveInitialBaseRef(
  options: ResolveInitialBaseRefOptions,
): string | null {
  if (options.selectedBaseBranch) {
    return options.availableBaseBranches?.includes(options.selectedBaseBranch)
      ? options.selectedBaseBranch
      : null;
  }

  const originDefault = `origin/${options.defaultBranch}`;
  if (options.availableBaseBranches?.includes(originDefault)) return originDefault;
  if (options.availableBaseBranches?.includes(options.defaultBranch)) return options.defaultBranch;
  return null;
}

export function getCreateWorktreeStartPoint(baseBranch?: string): string | null {
  return baseBranch ?? null;
}

export function getOriginFetchBranch(ref: string | null): string | null {
  if (!ref?.startsWith("origin/")) return null;
  const branch = ref.slice("origin/".length);
  return branch.length > 0 && branch !== "HEAD" ? branch : null;
}
