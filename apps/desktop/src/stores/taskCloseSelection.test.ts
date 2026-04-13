import { describe, expect, it } from "vitest";
import { shouldSelectNextOnCloseTransition } from "./taskCloseSelection";

describe("shouldSelectNextOnCloseTransition", () => {
  it("selects immediately when a normal task enters torndown", () => {
    expect(
      shouldSelectNextOnCloseTransition({
        selectNext: true,
        wasBlocked: false,
        previousStage: "in progress",
        nextStage: "torndown",
      }),
    ).toBe(true);
  });

  it("does not select when selection handoff is disabled", () => {
    expect(
      shouldSelectNextOnCloseTransition({
        selectNext: false,
        wasBlocked: false,
        previousStage: "in progress",
        nextStage: "torndown",
      }),
    ).toBe(false);
  });

  it("does not treat blocked-task close as torndown entry", () => {
    expect(
      shouldSelectNextOnCloseTransition({
        selectNext: true,
        wasBlocked: true,
        previousStage: "in progress",
        nextStage: "done",
      }),
    ).toBe(false);
  });

  it("does not reselect on final close after torndown", () => {
    expect(
      shouldSelectNextOnCloseTransition({
        selectNext: true,
        wasBlocked: false,
        previousStage: "torndown",
        nextStage: "done",
      }),
    ).toBe(false);
  });
});
