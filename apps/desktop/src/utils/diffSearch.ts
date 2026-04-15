export type DiffSearchTargetKind = "file-header" | "hunk-header" | "line";

export interface DiffSearchContextContent {
  type: "context";
  lines: number;
  additionLineIndex: number;
  deletionLineIndex: number;
}

export interface DiffSearchChangeContent {
  type: "change";
  deletions: number;
  deletionLineIndex: number;
  additions: number;
  additionLineIndex: number;
}

export interface DiffSearchHunk {
  hunkSpecs?: string;
  hunkContext?: string;
  unifiedLineStart: number;
  hunkContent: Array<DiffSearchContextContent | DiffSearchChangeContent>;
}

export interface DiffSearchFileDiff {
  name?: string;
  oldName?: string;
  newName?: string;
  hunks: DiffSearchHunk[];
  additionLines: string[];
  deletionLines: string[];
}

export interface DiffSearchFile {
  id: string;
  fileDiff: DiffSearchFileDiff;
}

export interface DiffSearchFileHeaderAnchor {
  type: "file-header";
  fileId: string;
}

export interface DiffSearchLineAnchor {
  type: "line";
  fileId: string;
  unifiedLineIndex: number;
}

export type DiffSearchAnchor = DiffSearchFileHeaderAnchor | DiffSearchLineAnchor;

export interface DiffSearchTarget {
  key: string;
  kind: DiffSearchTargetKind;
  text: string;
  anchor: DiffSearchAnchor;
}

export interface DiffSearchMatch {
  id: string;
  key: string;
  kind: DiffSearchTargetKind;
  text: string;
  start: number;
  end: number;
  anchor: DiffSearchAnchor;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getFileHeaderText(fileDiff: DiffSearchFileDiff): string {
  const parts = [
    fileDiff.oldName,
    fileDiff.newName,
    fileDiff.name,
  ].filter((value, index, allValues): value is string => Boolean(value) && allValues.indexOf(value) === index);

  return parts.join(" ");
}

function pushLineTargets(
  targets: DiffSearchTarget[],
  fileId: string,
  hunk: DiffSearchHunk,
  fileDiff: DiffSearchFileDiff,
) {
  let unifiedLineIndex = hunk.unifiedLineStart;

  for (const content of hunk.hunkContent) {
    if (content.type === "context") {
      for (let i = 0; i < content.lines; i += 1) {
        const text =
          fileDiff.additionLines[content.additionLineIndex + i] ??
          fileDiff.deletionLines[content.deletionLineIndex + i] ??
          "";
        targets.push({
          key: `${fileId}:line:${unifiedLineIndex}`,
          kind: "line",
          text,
          anchor: {
            type: "line",
            fileId,
            unifiedLineIndex,
          },
        });
        unifiedLineIndex += 1;
      }
      continue;
    }

    for (let i = 0; i < content.deletions; i += 1) {
      const text = fileDiff.deletionLines[content.deletionLineIndex + i] ?? "";
      targets.push({
        key: `${fileId}:line:${unifiedLineIndex}`,
        kind: "line",
        text,
        anchor: {
          type: "line",
          fileId,
          unifiedLineIndex,
        },
      });
      unifiedLineIndex += 1;
    }

    for (let i = 0; i < content.additions; i += 1) {
      const text = fileDiff.additionLines[content.additionLineIndex + i] ?? "";
      targets.push({
        key: `${fileId}:line:${unifiedLineIndex}`,
        kind: "line",
        text,
        anchor: {
          type: "line",
          fileId,
          unifiedLineIndex,
        },
      });
      unifiedLineIndex += 1;
    }
  }
}

export function buildDiffSearchTargets(files: readonly DiffSearchFile[]): DiffSearchTarget[] {
  const targets: DiffSearchTarget[] = [];

  for (const file of files) {
    const headerText = getFileHeaderText(file.fileDiff);
    if (headerText) {
      targets.push({
        key: `${file.id}:header`,
        kind: "file-header",
        text: headerText,
        anchor: {
          type: "file-header",
          fileId: file.id,
        },
      });
    }

    for (const [hunkIndex, hunk] of file.fileDiff.hunks.entries()) {
      const hunkText = [hunk.hunkSpecs, hunk.hunkContext].filter(Boolean).join(" ");
      if (hunkText) {
        targets.push({
          key: `${file.id}:hunk:${hunkIndex}`,
          kind: "hunk-header",
          text: hunkText,
          anchor: {
            type: "line",
            fileId: file.id,
            unifiedLineIndex: hunk.unifiedLineStart,
          },
        });
      }

      pushLineTargets(targets, file.id, hunk, file.fileDiff);
    }
  }

  return targets;
}

export function findDiffSearchMatches(
  targets: readonly DiffSearchTarget[],
  query: string,
): DiffSearchMatch[] {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const matcher = new RegExp(escapeRegExp(trimmedQuery), "gi");
  const matches: DiffSearchMatch[] = [];

  for (const target of targets) {
    let result: RegExpExecArray | null;
    while ((result = matcher.exec(target.text)) !== null) {
      matches.push({
        id: `${target.key}:${result.index}`,
        key: target.key,
        kind: target.kind,
        text: target.text,
        start: result.index,
        end: result.index + result[0].length,
        anchor: target.anchor,
      });
    }
    matcher.lastIndex = 0;
  }

  return matches;
}
