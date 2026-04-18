export interface MobileE2eEnv {
  appiumPort: number;
  bundleId: string;
  desktopServerUrl: string;
  deviceName?: string;
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

  return {
    appiumPort,
    bundleId: env.KANNA_IOS_BUNDLE_ID?.trim() || "com.anonymous.kanna-mobile",
    desktopServerUrl,
    deviceName: env.KANNA_IOS_SIMULATOR_NAME?.trim() || undefined
  };
}
