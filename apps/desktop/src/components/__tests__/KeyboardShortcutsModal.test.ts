// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import KeyboardShortcutsModal from "../KeyboardShortcutsModal.vue";
import { clearContextShortcuts, setContextShortcuts } from "../../composables/useShortcutContext";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe("KeyboardShortcutsModal", () => {
  afterEach(() => {
    clearContextShortcuts();
  });

  it("renders full-mode entries in a shared three-column grid", () => {
    const wrapper = mount(KeyboardShortcutsModal, {
      props: {
        context: "main",
        startInFullMode: true,
      },
    });

    const entryAt = (column: string, row: string) =>
      wrapper.get(`.shortcut-entry[data-column="${column}"][data-row="${row}"]`).text();

    expect(entryAt("1", "1")).toBe("shortcuts.groupCreateOrganize");
    expect(entryAt("1", "10")).toBe("shortcuts.groupWorkspace");
    expect(entryAt("1", "15")).toBe("shortcuts.groupAppHelp");
    expect(entryAt("2", "1")).toBe("shortcuts.groupMoveAround");
    expect(entryAt("3", "1")).toBe("shortcuts.groupOpenInspect");
    expect(entryAt("1", "11")).toBe("shortcuts.newWindow⌘N");
    expect(entryAt("1", "12")).toBe("shortcuts.closeWindow⌘W");
    expect(entryAt("1", "13")).toBe("shortcuts.toggleSidebar⌘B");
    expect(entryAt("1", "16")).toBe("shortcuts.preferences⌘,");
    expect(entryAt("2", "10")).toBe("shortcuts.oldestRead⌘R");
    expect(entryAt("3", "10")).toBe("shortcuts.treeExplorer⇧⌘E");
    expect(entryAt("3", "11")).toBe("shortcuts.viewDiff⌘D");
  });

  it("renders context-mode shortcuts in the shared multi-column grid", () => {
    setContextShortcuts(
      "file",
      [
        { label: "filePreview.shortcutSearch", display: "/", groupKey: "shortcuts.groupSearch" },
        { label: "filePreview.shortcutNextPrevMatch", display: "n / N", groupKey: "shortcuts.groupSearch" },
        { label: "filePreview.shortcutLineUpDown", display: "j / k", groupKey: "shortcuts.groupNavigation" },
        { label: "filePreview.shortcutToggleLineNumbers", display: "l", groupKey: "shortcuts.groupViews" },
      ] as unknown as Parameters<typeof setContextShortcuts>[1],
    );

    const wrapper = mount(KeyboardShortcutsModal, {
      props: {
        context: "file",
      },
    });

    const entries = wrapper.findAll(".shortcut-entry");
    const searchSection = wrapper.findAll(".shortcut-entry").find((entry) => entry.text().includes("shortcuts.groupSearch"));
    const viewsSection = wrapper.findAll(".shortcut-entry").find((entry) => entry.text().includes("shortcuts.groupViews"));

    expect(entries.length).toBeGreaterThan(0);
    expect(wrapper.find(".context-shortcuts").exists()).toBe(false);
    expect(wrapper.get('.shortcut-entry[data-column="1"][data-row="1"]').text()).toContain("shortcuts.groupSearch");
    expect(searchSection).toBeDefined();
    expect(viewsSection).toBeDefined();
    expect(viewsSection?.attributes("data-column")).toBe("1");
    expect(Number(viewsSection?.attributes("data-row"))).toBeGreaterThan(
      Number(searchSection?.attributes("data-row")),
    );
    expect(wrapper.text()).toContain("shortcuts.groupSearch");
    expect(wrapper.text()).toContain("shortcuts.groupNavigation");
    expect(wrapper.text()).toContain("shortcuts.groupViews");
    const helpSection = wrapper.findAll(".shortcut-entry").find((entry) => entry.text().includes("shortcuts.groupAppHelp"));
    expect(helpSection).toBeDefined();
    expect(helpSection?.attributes("data-column")).toBe("1");
    expect(Number(helpSection?.attributes("data-row"))).toBeGreaterThan(6);
    expect(entries.some((entry) => entry.text().includes("shortcuts.keyboardShortcuts"))).toBe(true);
    expect(entries.some((entry) => entry.text().includes("filePreview.shortcutSearch"))).toBe(true);
    expect(entries.some((entry) => entry.text().includes("shortcuts.shellTerminal"))).toBe(true);
    expect(entries.some((entry) => entry.text().includes("shortcuts.viewDiff"))).toBe(true);
  });

  it("keeps diff search first and merged views beneath it in column 1", () => {
    setContextShortcuts(
      "diff",
      [
        { label: "diffView.shortcutSearch", display: "/", groupKey: "shortcuts.groupSearch" },
        { label: "diffView.shortcutNextPrevMatch", display: "n / N", groupKey: "shortcuts.groupSearch" },
        { label: "diffView.shortcutLineUpDown", display: "j / k", groupKey: "shortcuts.groupNavigation" },
        { label: "diffView.shortcutCycleFilter", display: "s", groupKey: "shortcuts.groupViews" },
      ] as unknown as Parameters<typeof setContextShortcuts>[1],
    );

    const wrapper = mount(KeyboardShortcutsModal, {
      props: {
        context: "diff",
      },
    });

    const searchSection = wrapper.findAll(".shortcut-entry").find((entry) => entry.text().includes("shortcuts.groupSearch"));
    const viewsSection = wrapper.findAll(".shortcut-entry").find((entry) => entry.text().includes("shortcuts.groupViews"));

    expect(wrapper.get('.shortcut-entry[data-column="1"][data-row="1"]').text()).toContain("shortcuts.groupSearch");
    expect(searchSection).toBeDefined();
    expect(viewsSection).toBeDefined();
    expect(viewsSection?.attributes("data-column")).toBe("1");
    expect(Number(viewsSection?.attributes("data-row"))).toBeGreaterThan(
      Number(searchSection?.attributes("data-row")),
    );
  });

  it("keeps graph navigation first in column 1 with compact combined labels", () => {
    setContextShortcuts(
      "graph",
      [
        { label: "Scroll ↓/↑", display: "j / k", groupKey: "shortcuts.groupNavigation" },
        { label: "Page ↓/↑", display: "f / b", groupKey: "shortcuts.groupNavigation" },
        { label: "Half-page ↓/↑", display: "d / u", groupKey: "shortcuts.groupNavigation" },
        { label: "Top / Bottom", display: "g / G", groupKey: "shortcuts.groupNavigation" },
        { label: "Toggle auto / all", display: "Space", groupKey: "shortcuts.groupViews" },
      ] as unknown as Parameters<typeof setContextShortcuts>[1],
    );

    const wrapper = mount(KeyboardShortcutsModal, {
      props: {
        context: "graph",
      },
    });

    const navigationSection = wrapper.findAll(".shortcut-entry").find((entry) => entry.text().includes("shortcuts.groupNavigation"));
    expect(navigationSection).toBeDefined();
    expect(navigationSection?.attributes("data-column")).toBe("1");
    expect(wrapper.text()).toContain("Scroll ↓/↑");
    expect(wrapper.text()).toContain("Page ↓/↑");
    expect(wrapper.text()).toContain("Half-page ↓/↑");
    expect(wrapper.text()).toContain("shortcuts.groupViews");
  });
});
