import { describe, expect, it } from "vitest";

import {
  buildGlobalKeydownScript,
  buildSelectorKeydownScript,
} from "./keyboard";

describe("keyboard helper scripts", () => {
  it("dispatches app-level shortcuts on window", () => {
    const script = buildGlobalKeydownScript({
      key: "N",
      meta: true,
      shift: true,
    });

    expect(script).toContain("window.dispatchEvent");
    expect(script).toContain('key: "N"');
    expect(script).toContain("metaKey: true");
    expect(script).toContain("shiftKey: true");
  });

  it("dispatches element-local shortcuts on the requested selector", () => {
    const script = buildSelectorKeydownScript(".modal", {
      key: "]",
      meta: true,
      shift: true,
    });

    expect(script).toContain('document.querySelector(".modal")');
    expect(script).toContain("dispatchEvent(new KeyboardEvent");
    expect(script).toContain('key: "]"');
    expect(script).toContain("metaKey: true");
    expect(script).toContain("shiftKey: true");
  });
});
