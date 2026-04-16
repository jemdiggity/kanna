import { describe, expect, it } from "vitest";
import { extractPreviewLine } from "./preview";
import { buildRecentTasks, groupTasksByRepo } from "./task-list";

describe("extractPreviewLine", () => {
  it("returns the latest readable terminal line", () => {
    const bytes = new TextEncoder().encode("\u001b[32mPASS\u001b[0m\nUpdated mobile rows\n");
    expect(extractPreviewLine(bytes)).toBe("Updated mobile rows");
  });
});

describe("groupTasksByRepo", () => {
  it("keeps merge ahead of pr inside a repo", () => {
    const groups = groupTasksByRepo([
      {
        id: "pr-task",
        repo_id: "repo-1",
        title: "Prepare PR",
        repoName: "Kanna",
        stage: "pr",
        branch: null,
        displayName: null,
        prompt: null,
        prNumber: null,
        pinned: false,
        pinOrder: null,
        updatedAt: "2026-04-16T10:00:00Z",
        createdAt: "2026-04-16T09:00:00Z",
        lastOutputPreview: "",
      },
      {
        id: "merge-task",
        repo_id: "repo-1",
        title: "Merge",
        repoName: "Kanna",
        stage: "merge",
        branch: null,
        displayName: null,
        prompt: null,
        prNumber: null,
        pinned: false,
        pinOrder: null,
        updatedAt: "2026-04-16T09:00:00Z",
        createdAt: "2026-04-16T08:00:00Z",
        lastOutputPreview: "",
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].tasks.map((task) => task.id)).toEqual(["merge-task", "pr-task"]);
  });
});

describe("buildRecentTasks", () => {
  it("sorts across repos by most recent update", () => {
    const tasks = buildRecentTasks([
      {
        id: "older",
        repo_id: "repo-1",
        title: "Older",
        repoName: "Kanna",
        stage: "in progress",
        branch: null,
        displayName: null,
        prompt: null,
        prNumber: null,
        pinned: false,
        pinOrder: null,
        updatedAt: "2026-04-16T09:00:00Z",
        createdAt: "2026-04-16T08:00:00Z",
        lastOutputPreview: "",
      },
      {
        id: "newer",
        repo_id: "repo-2",
        title: "Newer",
        repoName: "Relay",
        stage: "pr",
        branch: null,
        displayName: null,
        prompt: null,
        prNumber: null,
        pinned: false,
        pinOrder: null,
        updatedAt: "2026-04-16T10:00:00Z",
        createdAt: "2026-04-16T08:30:00Z",
        lastOutputPreview: "",
      },
    ]);

    expect(tasks.map((task) => task.id)).toEqual(["newer", "older"]);
  });
});
