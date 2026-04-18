import { describe, expect, it } from "vitest";
import {
  buildTaskListItemModel,
  buildTaskWorkspaceHeaderModel
} from "./taskPresentation";

describe("buildTaskListItemModel", () => {
  it("prefers repo names and trims snippets for task cards", () => {
    const model = buildTaskListItemModel(
      {
        id: "task-1",
        repoId: "repo-1",
        title: "Refactor mobile task cards",
        stage: "in progress",
        snippet: "  Recent output line  "
      },
      "kanna-tauri",
      false
    );

    expect(model.repoLabel).toBe("kanna-tauri");
    expect(model.stageLabel).toBe("in progress");
    expect(model.preview).toBe("Recent output line");
    expect(model.scopeLabel).toBe("Repo Task");
  });

  it("falls back cleanly for recent tasks without snippets", () => {
    const model = buildTaskListItemModel(
      {
        id: "task-2",
        repoId: "repo-2",
        title: "Review task output",
        stage: "pr"
      },
      null,
      true
    );

    expect(model.repoLabel).toBe("repo-2");
    expect(model.scopeLabel).toBe("Recent Task");
    expect(model.preview).toContain("review");
  });
});

describe("buildTaskWorkspaceHeaderModel", () => {
  it("builds task workspace header copy for an active task", () => {
    const model = buildTaskWorkspaceHeaderModel({
      desktopName: "Studio Mac",
      repoName: "kanna-tauri",
      task: {
        id: "task-9",
        repoId: "repo-1",
        title: "Tighten mobile workspace",
        stage: "pr",
        snippet: "Latest agent output"
      }
    });

    expect(model.desktopLabel).toBe("Studio Mac");
    expect(model.repoLabel).toBe("kanna-tauri");
    expect(model.stageLabel).toBe("pr");
    expect(model.snippetLabel).toBe("Latest agent output");
  });
});
