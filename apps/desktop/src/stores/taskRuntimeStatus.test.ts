import { describe, expect, it } from "vitest";
import { shouldIgnoreRuntimeStatusDuringSetup } from "./taskRuntimeStatus";

describe("shouldIgnoreRuntimeStatusDuringSetup", () => {
  it("ignores idle while task setup is still pending", () => {
    expect(shouldIgnoreRuntimeStatusDuringSetup("idle", true)).toBe(true);
  });

  it("does not ignore busy while task setup is pending", () => {
    expect(shouldIgnoreRuntimeStatusDuringSetup("busy", true)).toBe(false);
  });

  it("does not ignore waiting while task setup is pending", () => {
    expect(shouldIgnoreRuntimeStatusDuringSetup("waiting", true)).toBe(false);
  });

  it("does not ignore idle after task setup finishes", () => {
    expect(shouldIgnoreRuntimeStatusDuringSetup("idle", false)).toBe(false);
  });
});
