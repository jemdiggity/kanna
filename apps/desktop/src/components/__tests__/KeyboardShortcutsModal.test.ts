// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import KeyboardShortcutsModal from "../KeyboardShortcutsModal.vue";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe("KeyboardShortcutsModal", () => {
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
    expect(entryAt("1", "14")).toBe("shortcuts.groupAppHelp");
    expect(entryAt("2", "1")).toBe("shortcuts.groupMoveAround");
    expect(entryAt("3", "1")).toBe("shortcuts.groupOpenInspect");
    expect(entryAt("1", "11")).toBe("shortcuts.toggleSidebar⌘B");
    expect(entryAt("1", "15")).toBe("shortcuts.preferences⌘,");
    expect(entryAt("2", "10")).toBe("shortcuts.oldestRead⌘R");
    expect(entryAt("3", "10")).toBe("shortcuts.viewDiff⌘D");
  });
});
