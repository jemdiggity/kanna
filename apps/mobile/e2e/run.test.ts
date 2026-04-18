import { describe, expect, it } from "vitest";
import { smokeSpecPaths, supportedSmokeTargets } from "./run";

describe("mobile smoke runner", () => {
  it("registers the list-detail-back smoke spec", () => {
    expect(smokeSpecPaths).toContain("specs/smoke/list-detail-back.e2e.ts");
  });

  it("supports both simulator and physical-device targets", () => {
    expect(supportedSmokeTargets).toEqual(["simulator", "device"]);
  });
});
