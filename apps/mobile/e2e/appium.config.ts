export interface SimulatorCapabilityInput {
  appiumPort: number;
  bundleId: string;
  deviceName: string;
  platformVersion?: string;
}

export interface PhysicalDeviceCapabilityInput {
  appiumPort: number;
  bundleId: string;
  deviceName: string;
  deviceUdid: string;
  platformVersion?: string;
  xcodeOrgId?: string;
  xcodeSigningId?: string;
  updatedWdaBundleId?: string;
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

export function createPhysicalDeviceCapabilities(
  input: PhysicalDeviceCapabilityInput
) {
  const xcodeSigningId = input.xcodeSigningId ?? "Apple Development";

  return {
    platformName: "iOS",
    "appium:automationName": "XCUITest",
    "appium:udid": input.deviceUdid,
    "appium:deviceName": input.deviceName,
    "appium:bundleId": input.bundleId,
    "appium:wdaLocalPort": deriveWdaLocalPort(input.appiumPort),
    "appium:newCommandTimeout": 120,
    "appium:noReset": true,
    ...(input.xcodeOrgId ? { "appium:xcodeOrgId": input.xcodeOrgId } : {}),
    ...(xcodeSigningId ? { "appium:xcodeSigningId": xcodeSigningId } : {}),
    ...(input.updatedWdaBundleId
      ? { "appium:updatedWDABundleId": input.updatedWdaBundleId }
      : {}),
    ...(input.platformVersion
      ? { "appium:platformVersion": input.platformVersion }
      : {})
  };
}
