import { describe, expect, it } from "vitest";
import {
  filterBaseBranchCandidates,
  getDefaultBaseBranch,
  orderBaseBranchCandidates,
} from "./baseBranchPicker";

describe("orderBaseBranchCandidates", () => {
  it("puts origin/default first, local default second, then the rest alphabetically", () => {
    expect(orderBaseBranchCandidates(
      ["feature/zeta", "main", "release/1.0", "origin/main", "feature/alpha"],
      "main",
    )).toEqual([
      "origin/main",
      "main",
      "feature/alpha",
      "feature/zeta",
      "release/1.0",
    ]);
  });

  it("deduplicates repeated branch names", () => {
    expect(orderBaseBranchCandidates(
      ["main", "origin/main", "main", "feature/a"],
      "main",
    )).toEqual(["origin/main", "main", "feature/a"]);
  });
});

describe("getDefaultBaseBranch", () => {
  it("prefers origin/default over local default", () => {
    expect(getDefaultBaseBranch(["main", "origin/main"], "main")).toBe("origin/main");
  });

  it("falls back to local default when origin/default is unavailable", () => {
    expect(getDefaultBaseBranch(["main", "feature/a"], "main")).toBe("main");
  });
});

describe("filterBaseBranchCandidates", () => {
  it("preserves canonical ordering for an empty query", () => {
    expect(filterBaseBranchCandidates(
      ["feature/zeta", "main", "origin/main", "feature/alpha"],
      "",
      "main",
    )).toEqual(["origin/main", "main", "feature/alpha", "feature/zeta"]);
  });

  it("filters and sorts matches with fuzzyMatch", () => {
    expect(filterBaseBranchCandidates(
      ["origin/main", "main", "feature/task-base-branch", "fix/base-branch-picker"],
      "tbb",
      "main",
    )).toEqual(["feature/task-base-branch"]);
  });
});
