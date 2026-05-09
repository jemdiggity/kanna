import { describe, expect, it } from "vitest";
import {
  createPhysicalDeviceCapabilities,
  createSimulatorCapabilities
} from "./appium.config";

describe("mobile Appium config", () => {
  it("builds simulator capabilities with the configured bundle id", () => {
    expect(
      createSimulatorCapabilities({
        wdaLocalPort: 4730,
        deviceName: "iPhone 15",
        bundleId: "build.kanna.mobile"
      })
    ).toMatchObject({
      platformName: "iOS",
      "appium:automationName": "XCUITest",
      "appium:deviceName": "iPhone 15",
      "appium:bundleId": "build.kanna.mobile",
      "appium:wdaLocalPort": 4730
    });
  });

  it("builds real-device capabilities with the selected UDID", () => {
    expect(
      createPhysicalDeviceCapabilities({
        wdaLocalPort: 4730,
        bundleId: "build.kanna.mobile",
        deviceName: "Jeremy's iPhone",
        deviceUdid: "00008110-001234560E10801E",
        xcodeOrgId: "GY3LFAA59P",
        updatedWdaBundleId: "build.kanna.mobile.webdriveragentrunner"
      })
    ).toMatchObject({
      platformName: "iOS",
      "appium:automationName": "XCUITest",
      "appium:udid": "00008110-001234560E10801E",
      "appium:deviceName": "Jeremy's iPhone",
      "appium:bundleId": "build.kanna.mobile",
      "appium:wdaLocalPort": 4730,
      "appium:forceAppLaunch": true,
      "appium:shouldTerminateApp": true,
      "appium:xcodeOrgId": "GY3LFAA59P",
      "appium:xcodeSigningId": "Apple Development",
      "appium:updatedWDABundleId": "build.kanna.mobile.webdriveragentrunner"
    });
  });
});
