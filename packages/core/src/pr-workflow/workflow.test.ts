import { describe, it, expect } from "vitest";
import { validatePRCreation } from "./workflow.js";

describe("validatePRCreation", () => {
  it("succeeds when stage is in_progress and no PR exists", () => {
    expect(() => validatePRCreation("in_progress", null)).not.toThrow();
  });

  it("throws when stage is queued", () => {
    expect(() => validatePRCreation("queued", null)).toThrow(
      /in_progress/
    );
  });

  it("throws when stage is needs_review", () => {
    expect(() => validatePRCreation("needs_review", null)).toThrow(
      /in_progress/
    );
  });

  it("throws when stage is merged", () => {
    expect(() => validatePRCreation("merged", null)).toThrow(/in_progress/);
  });

  it("throws when stage is closed", () => {
    expect(() => validatePRCreation("closed", null)).toThrow(/in_progress/);
  });

  it("throws when a PR already exists (in_progress)", () => {
    expect(() => validatePRCreation("in_progress", 42)).toThrow(/#42/);
  });

  it("throws when a PR already exists regardless of stage", () => {
    expect(() => validatePRCreation("needs_review", 7)).toThrow();
  });
});
