import { describe, expect, it } from "vitest";
import { shouldSelectNextOnCloseTransition } from "./taskCloseSelection";
import { TEARDOWN_STAGE } from "./taskStages";

describe("shouldSelectNextOnCloseTransition", () => {
  it("selects immediately when a normal task enters teardown", () => {
    expect(
      shouldSelectNextOnCloseTransition({
        selectNext: true,
        wasBlocked: false,
        previousStage: "in progress",
        nextStage: TEARDOWN_STAGE,
      }),
    ).toBe(true);
  });

  it("does not select when selection handoff is disabled", () => {
    expect(
      shouldSelectNextOnCloseTransition({
        selectNext: false,
        wasBlocked: false,
        previousStage: "in progress",
        nextStage: TEARDOWN_STAGE,
      }),
    ).toBe(false);
  });

  it("does not treat blocked-task close as teardown entry", () => {
    expect(
      shouldSelectNextOnCloseTransition({
        selectNext: true,
        wasBlocked: true,
        previousStage: "in progress",
        nextStage: "done",
      }),
    ).toBe(false);
  });

  it("does not reselect on final close after teardown", () => {
    expect(
      shouldSelectNextOnCloseTransition({
        selectNext: true,
        wasBlocked: false,
        previousStage: TEARDOWN_STAGE,
        nextStage: "done",
      }),
    ).toBe(false);
  });
});
