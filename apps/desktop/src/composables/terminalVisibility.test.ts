import { describe, expect, it } from "vitest";
import { shouldStartTerminalSession } from "./terminalVisibility";

describe("shouldStartTerminalSession", () => {
  it("treats omitted active state as visible by default", () => {
    expect(shouldStartTerminalSession(undefined)).toBe(true);
  });

  it("does not start explicitly inactive terminals", () => {
    expect(shouldStartTerminalSession(false)).toBe(false);
  });

  it("starts explicitly active terminals", () => {
    expect(shouldStartTerminalSession(true)).toBe(true);
  });
});
