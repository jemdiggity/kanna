import { describe, expect, it } from "vitest";
import { shouldMountBaseBranchDropdownPreview } from "./previewMode";

describe("shouldMountBaseBranchDropdownPreview", () => {
  it("enables the base-branch dropdown preview when requested in a preview-capable runtime", () => {
    expect(shouldMountBaseBranchDropdownPreview("?preview=base-branch-dropdown", {
      dev: true,
      mode: "development",
      vitest: undefined,
    })).toBe(true);
  });

  it("keeps the normal app path for non-preview requests", () => {
    expect(shouldMountBaseBranchDropdownPreview("", {
      dev: true,
      mode: "development",
      vitest: undefined,
    })).toBe(false);
  });

  it("allows the preview path to be tested outside a dev runtime", () => {
    expect(shouldMountBaseBranchDropdownPreview("?preview=base-branch-dropdown", {
      dev: false,
      mode: "test",
      vitest: "true",
    })).toBe(true);
  });
});
