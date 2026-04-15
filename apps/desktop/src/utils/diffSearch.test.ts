import { describe, expect, it } from "vitest";
import { buildDiffSearchTargets, findDiffSearchMatches } from "./diffSearch";

const files = [
  {
    id: "file-1",
    fileDiff: {
      name: "src/example.ts",
      hunks: [
        {
          hunkSpecs: "@@ -1,2 +1,3 @@",
          hunkContext: "function demo()",
          unifiedLineStart: 0,
          hunkContent: [
            {
              type: "change",
              deletions: 1,
              deletionLineIndex: 0,
              additions: 1,
              additionLineIndex: 0,
            },
            {
              type: "context",
              lines: 1,
              additionLineIndex: 1,
              deletionLineIndex: 1,
            },
            {
              type: "change",
              deletions: 0,
              deletionLineIndex: 2,
              additions: 1,
              additionLineIndex: 2,
            },
          ],
        },
      ],
      additionLines: [
        "const alpha = 2;",
        "const beta = 3;",
        "const gamma = 4;",
      ],
      deletionLines: [
        "const alpha = 1;",
        "const beta = 3;",
      ],
    },
  },
] as const;

describe("diffSearch", () => {
  it("finds matches in file names, hunk headers, and diff lines", () => {
    const targets = buildDiffSearchTargets(files);

    expect(findDiffSearchMatches(targets, "example")).toEqual([
      expect.objectContaining({
        kind: "file-header",
        anchor: {
          fileId: "file-1",
          type: "file-header",
        },
      }),
    ]);

    expect(findDiffSearchMatches(targets, "@@ -1,2 +1,3 @@")).toEqual([
      expect.objectContaining({
        kind: "hunk-header",
        anchor: {
          fileId: "file-1",
          type: "line",
          unifiedLineIndex: 0,
        },
      }),
    ]);

    expect(findDiffSearchMatches(targets, "gamma")).toEqual([
      expect.objectContaining({
        kind: "line",
        anchor: {
          fileId: "file-1",
          type: "line",
          unifiedLineIndex: 3,
        },
      }),
    ]);
  });

  it("returns zero matches for an empty query", () => {
    const targets = buildDiffSearchTargets(files);

    expect(findDiffSearchMatches(targets, "")).toEqual([]);
  });
});
