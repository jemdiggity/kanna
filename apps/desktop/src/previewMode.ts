export interface PreviewRuntime {
  dev: boolean;
  mode?: string;
  vitest?: string;
}

export function shouldMountBaseBranchDropdownPreview(
  search: string,
  runtime: PreviewRuntime,
): boolean {
  const preview = new URLSearchParams(search).get("preview");
  const isPreviewRuntime =
    runtime.dev ||
    runtime.mode === "test" ||
    runtime.vitest === "true";

  return isPreviewRuntime && preview === "base-branch-dropdown";
}
