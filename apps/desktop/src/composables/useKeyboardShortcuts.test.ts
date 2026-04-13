import { describe, expect, it } from "vitest";
import { getShortcutGroups } from "./useKeyboardShortcuts";

function identityTranslate(key: string): string {
  return key;
}

function englishTranslate(key: string): string {
  const values: Record<string, string> = {
    "shortcuts.groupOpenInspect": "Tools",
    "shortcuts.commandPalette": "Command Palette",
    "shortcuts.analytics": "Analytics",
    "shortcuts.commitGraph": "Commit Graph",
    "shortcuts.filePicker": "File Picker",
    "shortcuts.openInIDE": "Open in IDE",
    "shortcuts.shellRepoRoot": "Shell at Repo Root",
    "shortcuts.shellTerminal": "Shell Terminal",
    "shortcuts.treeExplorer": "Tree Explorer",
    "shortcuts.viewDiff": "View Diff",
  };
  return values[key] ?? key;
}

describe("getShortcutGroups", () => {
  it("groups full-menu shortcuts by workflow-first categories", () => {
    const groups = getShortcutGroups(identityTranslate);

    expect(groups.map((group) => group.title)).toEqual([
      "shortcuts.groupCreateOrganize",
      "shortcuts.groupMoveAround",
      "shortcuts.groupOpenInspect",
      "shortcuts.groupWorkspace",
      "shortcuts.groupAppHelp",
    ]);
  });

  it("assigns shortcuts to the expected workflow-first groups", () => {
    const groups = getShortcutGroups(identityTranslate);
    const groupMap = Object.fromEntries(
      groups.map((group) => [group.title, group.shortcuts.map((shortcut) => shortcut.action)]),
    );

    expect(groupMap["shortcuts.groupCreateOrganize"]).toEqual([
      "shortcuts.createRepo",
      "shortcuts.importClone",
      "shortcuts.newTask",
      "shortcuts.focusSearch",
      "shortcuts.advanceStage",
      "shortcuts.closeReject",
      "shortcuts.undoClose",
    ]);

    expect(groupMap["shortcuts.groupMoveAround"]).toEqual([
      "shortcuts.previousTask",
      "shortcuts.nextTask",
      "shortcuts.previousRepo",
      "shortcuts.nextRepo",
      "shortcuts.goBack",
      "shortcuts.goForward",
      "shortcuts.oldestUnread",
      "shortcuts.newestUnread",
      "shortcuts.oldestRead",
      "shortcuts.newestRead",
    ]);

    expect([...groupMap["shortcuts.groupOpenInspect"]].sort()).toEqual([
      "shortcuts.analytics",
      "shortcuts.commandPalette",
      "shortcuts.commitGraph",
      "shortcuts.filePicker",
      "shortcuts.openInIDE",
      "shortcuts.shellRepoRoot",
      "shortcuts.shellTerminal",
      "shortcuts.treeExplorer",
      "shortcuts.viewDiff",
    ].sort());

    expect(groupMap["shortcuts.groupWorkspace"]).toEqual([
      "shortcuts.toggleSidebar",
      "shortcuts.maximize",
    ]);

    expect(groupMap["shortcuts.groupAppHelp"]).toEqual([
      "shortcuts.preferences",
      "shortcuts.keyboardShortcuts",
    ]);
  });

  it("sorts tools alphabetically by their visible label", () => {
    const groups = getShortcutGroups(englishTranslate);
    const tools = groups.find((group) => group.title === "Tools");

    expect(tools?.shortcuts.map((shortcut) => shortcut.action)).toEqual([
      "Analytics",
      "Command Palette",
      "Commit Graph",
      "File Picker",
      "Open in IDE",
      "Shell at Repo Root",
      "Shell Terminal",
      "Tree Explorer",
      "View Diff",
    ]);
  });
});
