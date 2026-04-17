import { describe, expect, it } from "vitest";
import { createSessionStore } from "./sessionStore";

describe("createSessionStore", () => {
  it("switches the selected desktop without dropping the desktop list", () => {
    const store = createSessionStore();
    store.setDesktops([
      { id: "desktop-a", name: "Studio Mac", online: true, mode: "lan" },
      { id: "desktop-b", name: "Laptop", online: false, mode: "remote" }
    ]);

    store.selectDesktop("desktop-b");

    expect(store.getState().selectedDesktopId).toBe("desktop-b");
    expect(store.getState().desktops).toHaveLength(2);
  });

  it("selects the first desktop when no desktop is selected", () => {
    const store = createSessionStore();
    store.setDesktops([
      { id: "desktop-a", name: "Studio Mac", online: true, mode: "lan" }
    ]);

    expect(store.getState().selectedDesktopId).toBe("desktop-a");
  });
});
