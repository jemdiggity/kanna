import { describe, expect, it } from "vitest";
import { smokeSpecPaths } from "./run";

describe("mobile smoke runner", () => {
  it("registers the list-detail-back smoke spec", () => {
    expect(smokeSpecPaths).toContain("specs/smoke/list-detail-back.e2e.ts");
  });
});
