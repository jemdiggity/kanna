import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type MobileE2eTarget = "simulator" | "device";

interface MobileAppConfig {
  expo?: {
    ios?: {
      appleTeamId?: string;
      bundleIdentifier?: string;
    };
  };
}

export interface MobileE2eEnv {
  appiumPort: number;
  bundleId: string;
  desktopServerUrl: string;
  target: MobileE2eTarget;
  deviceName?: string;
  deviceUdid?: string;
  xcodeOrgId?: string;
  xcodeSigningId?: string;
  updatedWdaBundleId?: string;
}

function readMobileAppConfig(): MobileAppConfig {
  const appConfigUrl = new URL("../../app.json", import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(appConfigUrl.href), "utf8")) as MobileAppConfig;
}

export function resolveRequiredMobileE2eEnv(
  env: Record<string, string | undefined>
): MobileE2eEnv {
  const rawAppiumPort = env.KANNA_APPIUM_PORT?.trim();
  if (!rawAppiumPort) {
    throw new Error(
      "KANNA_APPIUM_PORT is required. Start Kanna with ./scripts/dev.sh --mobile."
    );
  }

  const appiumPort = Number.parseInt(rawAppiumPort, 10);
  if (Number.isNaN(appiumPort)) {
    throw new Error(`KANNA_APPIUM_PORT must be an integer, got: ${rawAppiumPort}`);
  }

  const desktopServerUrl = env.EXPO_PUBLIC_KANNA_SERVER_URL?.trim();
  if (!desktopServerUrl) {
    throw new Error(
      "EXPO_PUBLIC_KANNA_SERVER_URL is required. Start Kanna with ./scripts/dev.sh --mobile."
    );
  }

  const target = env.KANNA_IOS_E2E_TARGET?.trim() === "device" ? "device" : "simulator";
  const appConfig = readMobileAppConfig();
  const defaultBundleId =
    appConfig.expo?.ios?.bundleIdentifier?.trim() || "com.anonymous.kanna-mobile";
  const bundleId = env.KANNA_IOS_BUNDLE_ID?.trim() || defaultBundleId;
  const xcodeOrgId =
    env.KANNA_IOS_XCODE_ORG_ID?.trim() || appConfig.expo?.ios?.appleTeamId?.trim() || undefined;
  const xcodeSigningId = env.KANNA_IOS_XCODE_SIGNING_ID?.trim() || "Apple Development";
  const updatedWdaBundleId =
    env.KANNA_IOS_WDA_BUNDLE_ID?.trim() || `${bundleId}.webdriveragentrunner`;

  return {
    appiumPort,
    bundleId,
    desktopServerUrl,
    target,
    deviceName: env.KANNA_IOS_SIMULATOR_NAME?.trim() || undefined,
    deviceUdid: env.KANNA_IOS_DEVICE_UDID?.trim() || undefined,
    xcodeOrgId,
    xcodeSigningId,
    updatedWdaBundleId
  };
}
