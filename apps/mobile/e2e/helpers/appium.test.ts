import { describe, expect, it } from "vitest";
import {
  getDefaultAppiumHome,
  isXcuitestDriverCompatible
} from "./appium";

describe("mobile Appium helpers", () => {
  it("uses the standard Appium home directory by default", () => {
    expect(getDefaultAppiumHome("/Users/tester")).toBe("/Users/tester/.appium");
  });

  it("accepts xcuitest drivers built for Appium 2", () => {
    expect(
      isXcuitestDriverCompatible({
        appiumVersion: "^2.5.4"
      })
    ).toBe(true);
  });

  it("rejects xcuitest drivers built for Appium 3", () => {
    expect(
      isXcuitestDriverCompatible({
        appiumVersion: "^3.0.0-rc.2"
      })
    ).toBe(false);
  });
});
