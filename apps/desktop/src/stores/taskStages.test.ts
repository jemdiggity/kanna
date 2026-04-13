import { describe, expect, it } from "vitest";
import { TEARDOWN_STAGE, isTeardownStage, normalizePipelineStage } from "./taskStages";

describe("taskStages", () => {
  it("uses teardown as the canonical stage name", () => {
    expect(TEARDOWN_STAGE).toBe("teardown");
  });

  it("normalizes legacy torndown rows to teardown", () => {
    expect(isTeardownStage("teardown")).toBe(true);
    expect(isTeardownStage("torndown")).toBe(true);
    expect(normalizePipelineStage("teardown")).toBe("teardown");
    expect(normalizePipelineStage("torndown")).toBe("teardown");
    expect(normalizePipelineStage("in progress")).toBe("in progress");
  });
});
