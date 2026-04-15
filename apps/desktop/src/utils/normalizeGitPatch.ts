const QUOTED_GIT_DIFF_HEADER =
  /^diff --git "a\/((?:[^"\\]|\\.)*)" "b\/((?:[^"\\]|\\.)*)"$/;
const QUOTED_PATCH_PATH_HEADER =
  /^(---|\+\+\+) "((?:[^"\\]|\\.)*)"$/;
const QUOTED_RENAME_OR_COPY_HEADER =
  /^(rename from|rename to|copy from|copy to) "((?:[^"\\]|\\.)*)"$/;

function normalizeGitPatchLine(line: string): string {
  const gitDiffMatch = line.match(QUOTED_GIT_DIFF_HEADER);
  if (gitDiffMatch) {
    const [, oldPath, newPath] = gitDiffMatch;
    return `diff --git a/${oldPath} b/${newPath}`;
  }

  const patchPathMatch = line.match(QUOTED_PATCH_PATH_HEADER);
  if (patchPathMatch) {
    const [, prefix, path] = patchPathMatch;
    return `${prefix} ${path}`;
  }

  const renameOrCopyMatch = line.match(QUOTED_RENAME_OR_COPY_HEADER);
  if (renameOrCopyMatch) {
    const [, prefix, path] = renameOrCopyMatch;
    return `${prefix} ${path}`;
  }

  return line;
}

export function normalizeGitPatchForDiffParser(patch: string): string {
  if (!patch.includes('"')) return patch;
  return patch
    .split("\n")
    .map(normalizeGitPatchLine)
    .join("\n");
}
