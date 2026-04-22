import { describe, expect, it, vi } from "vitest";

vi.mock("./slowMode", () => ({
  pauseForSlowMode: vi.fn(async () => {}),
}));

import { pauseForAppReady, pauseBeforeTestTarget } from "./runSlowMode";
import { pauseForSlowMode } from "./slowMode";

describe("runSlowMode", () => {
  it("pauses with a descriptive label after an app instance becomes ready", async () => {
    await pauseForAppReady("primary");

    expect(pauseForSlowMode).toHaveBeenCalledWith("primary app ready");
  });

  it("pauses with a descriptive label before a test target runs", async () => {
    await pauseBeforeTestTarget("tests/e2e/mock/app-launch.test.ts");

    expect(pauseForSlowMode).toHaveBeenCalledWith(
      "before tests/e2e/mock/app-launch.test.ts",
    );
  });
});
