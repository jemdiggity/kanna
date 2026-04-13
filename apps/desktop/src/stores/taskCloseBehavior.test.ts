import { describe, expect, it } from "vitest";
import { getTaskCloseBehavior } from "./taskCloseBehavior";

describe("getTaskCloseBehavior", () => {
  it("keeps normal tasks in teardown on first close", () => {
    expect(
      getTaskCloseBehavior({
        wasBlocked: false,
        currentStage: "in progress",
      }),
    ).toBe("enter-teardown");
  });

  it("finishes blocked tasks immediately", () => {
    expect(
      getTaskCloseBehavior({
        wasBlocked: true,
        currentStage: "in progress",
      }),
    ).toBe("finish");
  });

  it("finishes tasks that are already in teardown", () => {
    expect(
      getTaskCloseBehavior({
        wasBlocked: false,
        currentStage: "teardown",
      }),
    ).toBe("finish");
  });

  it("treats legacy torndown as already in teardown", () => {
    expect(
      getTaskCloseBehavior({
        wasBlocked: false,
        currentStage: "torndown",
      }),
    ).toBe("finish");
  });
});
