import { describe, expect, it } from "vitest";
import { getTaskCloseBehavior } from "./taskCloseBehavior";

describe("getTaskCloseBehavior", () => {
  it("enters teardown on first close when teardown commands exist", () => {
    expect(
      getTaskCloseBehavior({
        wasBlocked: false,
        currentStage: "in progress",
        hasTeardownCommands: true,
      }),
    ).toBe("enter-teardown");
  });

  it("finishes immediately on first close when teardown commands do not exist", () => {
    expect(
      getTaskCloseBehavior({
        wasBlocked: false,
        currentStage: "in progress",
        hasTeardownCommands: false,
      }),
    ).toBe("finish");
  });

  it("finishes blocked tasks immediately", () => {
    expect(
      getTaskCloseBehavior({
        wasBlocked: true,
        currentStage: "in progress",
        hasTeardownCommands: true,
      }),
    ).toBe("finish");
  });

  it("finishes tasks that are already in teardown", () => {
    expect(
      getTaskCloseBehavior({
        wasBlocked: false,
        currentStage: "teardown",
        hasTeardownCommands: true,
      }),
    ).toBe("finish");
  });

  it("treats legacy torndown as already in teardown", () => {
    expect(
      getTaskCloseBehavior({
        wasBlocked: false,
        currentStage: "torndown",
        hasTeardownCommands: true,
      }),
    ).toBe("finish");
  });
});
