import { describe, expect, it } from "vitest";
import {
  getCreateWorktreeStartPoint,
  getOriginFetchBranch,
  resolveInitialBaseRef,
} from "./taskBaseBranch";

describe("resolveInitialBaseRef", () => {
  it("uses the selected base branch when present", () => {
    expect(resolveInitialBaseRef({
      selectedBaseBranch: "feature/task-base-branch",
      availableBaseBranches: ["feature/task-base-branch", "origin/main", "main"],
      defaultBranch: "main",
    })).toBe("feature/task-base-branch");
  });

  it("prefers origin/default for fallback base_ref", () => {
    expect(resolveInitialBaseRef({
      availableBaseBranches: ["origin/main", "main"],
      defaultBranch: "main",
    })).toBe("origin/main");
  });

  it("falls back to the local default branch when the origin default is unavailable", () => {
    expect(resolveInitialBaseRef({
      availableBaseBranches: ["feature/x", "main"],
      defaultBranch: "main",
    })).toBe("main");
  });

  it("returns null when no verified default branch is available", () => {
    expect(resolveInitialBaseRef({
      availableBaseBranches: ["feature/x"],
      defaultBranch: "main",
    })).toBeNull();
  });

  it("returns null when a selected base branch is not available", () => {
    expect(resolveInitialBaseRef({
      selectedBaseBranch: "missing/base",
      availableBaseBranches: ["origin/main", "main"],
      defaultBranch: "main",
    })).toBeNull();
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

describe("getOriginFetchBranch", () => {
  it("returns the branch name for origin refs", () => {
    expect(getOriginFetchBranch("origin/dev")).toBe("dev");
    expect(getOriginFetchBranch("origin/feature/task-base")).toBe("feature/task-base");
  });

  it("ignores local refs and origin HEAD", () => {
    expect(getOriginFetchBranch("dev")).toBeNull();
    expect(getOriginFetchBranch("origin/HEAD")).toBeNull();
    expect(getOriginFetchBranch(null)).toBeNull();
  });
});
