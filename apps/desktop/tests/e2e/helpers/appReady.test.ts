import { describe, expect, it } from "vitest";

import { APP_READY_SCRIPT } from "./appReady";

describe("APP_READY_SCRIPT", () => {
  it("checks both setupState existence and the explicit e2e ready flag", () => {
    expect(APP_READY_SCRIPT).toContain("window.__KANNA_E2E__");
    expect(APP_READY_SCRIPT).toContain("setupState");
    expect(APP_READY_SCRIPT).toContain("e2eAppReady");
    expect(APP_READY_SCRIPT).toContain("__v_isRef");
  });
});
