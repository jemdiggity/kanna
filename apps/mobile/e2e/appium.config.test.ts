import { describe, expect, it } from "vitest";
import { createSimulatorCapabilities, deriveWdaLocalPort } from "./appium.config";

describe("mobile Appium config", () => {
  it("derives WDA from the assigned Appium port", () => {
    expect(deriveWdaLocalPort(4723)).toBe(4724);
  });

  it("builds simulator capabilities with the configured bundle id", () => {
    expect(
      createSimulatorCapabilities({
        appiumPort: 4723,
        deviceName: "iPhone 15",
        bundleId: "com.anonymous.kanna-mobile"
      })
    ).toMatchObject({
      platformName: "iOS",
      "appium:automationName": "XCUITest",
      "appium:deviceName": "iPhone 15",
      "appium:bundleId": "com.anonymous.kanna-mobile",
      "appium:wdaLocalPort": 4724
    });
  });
});
