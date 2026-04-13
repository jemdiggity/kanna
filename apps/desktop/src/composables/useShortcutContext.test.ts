import { describe, it, expect, beforeEach } from "vitest";
import {
  activeContext,
  contextShortcuts,
  setContext,
  resetContext,
  setContextShortcuts as register,
  clearContextShortcuts,
  getContextShortcuts,
  type ShortcutContext,
} from "./useShortcutContext";

describe("useShortcutContext", () => {
  beforeEach(() => {
    resetContext();
    clearContextShortcuts();
  });

  describe("activeContext", () => {
    it("defaults to 'main'", () => {
      expect(activeContext.value).toBe("main");
    });

    it("can be set to diff", () => {
      setContext("diff");
      expect(activeContext.value).toBe("diff");
    });

    it("resets to main", () => {
      setContext("file");
      resetContext();
      expect(activeContext.value).toBe("main");
    });
  });

  describe("registerContextShortcuts", () => {
    it("stores shortcuts for a context", () => {
      register("diff", [{ label: "Cycle Scope", display: "Space" }]);
      expect(contextShortcuts.value.get("diff")).toEqual([
        { label: "Cycle Scope", display: "Space" },
      ]);
    });

    it("clears shortcuts for a context", () => {
      register("diff", [{ label: "Cycle Scope", display: "Space" }]);
      clearContextShortcuts("diff");
      expect(contextShortcuts.value.has("diff")).toBe(false);
    });
  });

  describe("getContextShortcuts", () => {
    it("returns global shortcuts tagged for the context", () => {
      register("diff", [{ label: "Cycle Scope", display: "Space" }]);
      const result = getContextShortcuts("diff");
      const actions = result.map((s) => s.action);
      expect(actions).toContain("Cycle Scope");
    });

    it("includes global shortcuts tagged for main context", () => {
      const result = getContextShortcuts("main");
      const actions = result.map((s) => s.action);
      expect(actions).toContain("shortcuts.keyboardShortcuts");
      expect(actions).toContain("shortcuts.commandPalette");
      expect(actions).not.toContain("shortcuts.dismiss");
    });

    it("excludes command palette from modal contexts but allows keyboard shortcuts", () => {
      for (const ctx of ["diff", "file", "shell", "tree", "graph"] as ShortcutContext[]) {
        const result = getContextShortcuts(ctx);
        const actions = result.map((s) => s.action);
        expect(actions).not.toContain("shortcuts.commandPalette");
        if (ctx === "tree") {
          expect(actions).not.toContain("shortcuts.keyboardShortcuts");
          expect(actions).not.toContain("shortcuts.dismiss");
        } else if (ctx === "shell") {
          expect(actions).toContain("shortcuts.keyboardShortcuts");
          expect(actions).not.toContain("shortcuts.dismiss");
        } else {
          expect(actions).toContain("shortcuts.keyboardShortcuts");
          expect(actions).not.toContain("shortcuts.dismiss");
        }
      }
    });

    it("includes tree-specific supplementary shortcuts in tree context", () => {
      register("tree", [{ label: "Yank path", display: "y" }]);
      const result = getContextShortcuts("tree");
      const actions = result.map((s) => s.action);
      expect(actions).toContain("Yank path");
      expect(actions).not.toContain("shortcuts.treeExplorer");
      expect(actions).not.toContain("shortcuts.keyboardShortcuts");
    });

    it("excludes generic help and dismiss shortcuts from new task context", () => {
      const result = getContextShortcuts("newTask");
      const actions = result.map((s) => s.action);
      expect(actions).not.toContain("shortcuts.keyboardShortcuts");
      expect(actions).not.toContain("shortcuts.dismiss");
      expect(actions).not.toContain("shortcuts.commandPalette");
    });

    it("excludes shortcuts tagged for other contexts", () => {
      const result = getContextShortcuts("diff");
      const actions = result.map((s) => s.action);
      expect(actions).not.toContain("shortcuts.newTask");
      expect(actions).not.toContain("shortcuts.filePicker");
    });
  });
});
