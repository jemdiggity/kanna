export interface ResolveInitialBaseRefOptions {
  selectedBaseBranch?: string;
  availableBaseBranches?: string[];
  defaultBranch: string;
}

export function resolveInitialBaseRef(
  options: ResolveInitialBaseRefOptions,
): string {
  if (options.selectedBaseBranch) return options.selectedBaseBranch;

  const originDefault = `origin/${options.defaultBranch}`;
  if (options.availableBaseBranches?.includes(originDefault)) return originDefault;
  return options.defaultBranch;
}

export function getCreateWorktreeStartPoint(baseBranch?: string): string | null {
  return baseBranch ?? null;
}
