import { describe, expect, it } from "vitest";
import { buildMoreCommandSections } from "./moreCommands";

describe("buildMoreCommandSections", () => {
  it("builds both global and selected-task command sections", () => {
    const sections = buildMoreCommandSections({
      pairingCode: "ABC123",
      selectedTask: {
        id: "task-1",
        repoId: "repo-1",
        title: "Review mobile shell",
        stage: "pr",
        snippet: "Agent says the branch is ready for review."
      }
    });

    expect(sections[0]).toMatchObject({
      title: "Workspace",
      headline: "ABC123"
    });
    expect(sections[1]?.actions.map((action) => action.id)).toEqual([
      "refresh",
      "pair",
      "desktops",
      "compose"
    ]);
    expect(sections[2]).toMatchObject({
      title: "Selected Task",
      headline: "Review mobile shell"
    });
    expect(sections[3]?.actions.map((action) => action.id)).toEqual([
      "advance-stage",
      "merge-agent",
      "close-task"
    ]);
  });

  it("omits task actions when no task is selected", () => {
    const sections = buildMoreCommandSections({
      pairingCode: null,
      selectedTask: null
    });

    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({
      title: "Workspace",
      headline: "No pairing session"
    });
  });
});
