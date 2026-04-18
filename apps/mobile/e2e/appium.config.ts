export interface SimulatorCapabilityInput {
  appiumPort: number;
  bundleId: string;
  deviceName: string;
  platformVersion?: string;
}

export function deriveWdaLocalPort(appiumPort: number): number {
  return appiumPort + 1;
}

export function createSimulatorCapabilities(input: SimulatorCapabilityInput) {
  return {
    platformName: "iOS",
    "appium:automationName": "XCUITest",
    "appium:deviceName": input.deviceName,
    "appium:bundleId": input.bundleId,
    "appium:wdaLocalPort": deriveWdaLocalPort(input.appiumPort),
    "appium:newCommandTimeout": 120,
    "appium:noReset": true,
    ...(input.platformVersion
      ? { "appium:platformVersion": input.platformVersion }
      : {})
  };
}
