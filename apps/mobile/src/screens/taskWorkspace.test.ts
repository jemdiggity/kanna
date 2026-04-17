import { describe, expect, it } from "vitest";
import { buildTaskWorkspaceModel } from "./taskWorkspace";

describe("buildTaskWorkspaceModel", () => {
  it("builds a resume-oriented workspace for in-progress tasks", () => {
    const model = buildTaskWorkspaceModel({
      desktopName: "Studio Mac",
      repoName: "kanna-tauri",
      task: {
        id: "task-123",
        repoId: "repo-1",
        title: "Refactor mobile workspace",
        stage: "in progress"
      }
    });

    expect(model.summaryLabel).toBe("Resume agent task");
    expect(model.summaryCopy).toContain("Refactor mobile workspace");
    expect(model.primaryActionLabel).toBe("Command Palette");
    expect(model.facts).toEqual([
      { label: "Desktop", value: "Studio Mac" },
      { label: "Repo", value: "kanna-tauri" },
      { label: "Stage", value: "in progress" },
      { label: "Task", value: "task-123" }
    ]);
  });

  it("adapts the guidance for review-stage tasks and falls back cleanly", () => {
    const model = buildTaskWorkspaceModel({
      desktopName: null,
      repoName: null,
      task: {
        id: "task-pr",
        repoId: "repo-2",
        title: "Ship mobile shell",
        stage: "pr"
      }
    });

    expect(model.summaryLabel).toBe("Review task");
    expect(model.summaryCopy).toContain("review-ready");
    expect(model.facts).toEqual([
      { label: "Desktop", value: "Unknown desktop" },
      { label: "Repo", value: "repo-2" },
      { label: "Stage", value: "pr" },
      { label: "Task", value: "task-pr" }
    ]);
  });
});
