import { describe, expect, it } from "vitest";
import {
  getCreateWorktreeStartPoint,
  resolveInitialBaseRef,
} from "./taskBaseBranch";

describe("resolveInitialBaseRef", () => {
  it("uses the selected base branch when present", () => {
    expect(resolveInitialBaseRef({
      selectedBaseBranch: "feature/task-base-branch",
      defaultBranch: "main",
    })).toBe("feature/task-base-branch");
  });

  it("prefers origin/default for fallback base_ref", () => {
    expect(resolveInitialBaseRef({
      availableBaseBranches: ["origin/main", "main"],
      defaultBranch: "main",
    })).toBe("origin/main");
  });
});

describe("getCreateWorktreeStartPoint", () => {
  it("returns the explicit base branch as the worktree start point", () => {
    expect(getCreateWorktreeStartPoint("feature/task-base-branch")).toBe("feature/task-base-branch");
  });

  it("does not invent a .kanna-worktrees path for arbitrary branches", () => {
    expect(getCreateWorktreeStartPoint("release/1.2")).not.toContain(".kanna-worktrees");
  });
});
