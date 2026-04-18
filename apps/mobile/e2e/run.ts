import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Browser } from "webdriverio";
import {
  createPhysicalDeviceCapabilities,
  createSimulatorCapabilities
} from "./appium.config";
import {
  assertXcuitestDriverInstalled,
  listXcuitestConnectedDeviceUdids,
  startLocalAppiumServer,
  waitForLocalAppiumServer
} from "./helpers/appium";
import {
  assertDesktopServerReachable,
  resolveDesktopServerUrlForTarget
} from "./helpers/desktop";
import { ensureExpoServer } from "./helpers/metro";
import {
  assertPhysicalDeviceAppInstalled,
  resolvePhysicalDevice
} from "./helpers/device";
import { resolveRequiredMobileE2eEnv } from "./helpers/env";
import { createMobileSession } from "./helpers/session";
import {
  assertSimulatorAppInstalled,
  bootSimulator,
  resolveSimulatorDevice
} from "./helpers/simulator";
import { runListDetailBackSmoke } from "./specs/smoke/list-detail-back.e2e";

export const smokeSpecPaths = ["specs/smoke/list-detail-back.e2e.ts"];
export const supportedSmokeTargets = ["simulator", "device"] as const;

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "smoke";
  if (mode !== "smoke") {
    throw new Error(`Unsupported mobile E2E mode: ${mode}`);
  }

  const env = resolveRequiredMobileE2eEnv(
    process.env as Record<string, string | undefined>
  );
  const desktopServerUrl = resolveDesktopServerUrlForTarget(
    env.desktopServerUrl,
    env.target
  );
  process.env.EXPO_PUBLIC_KANNA_SERVER_URL = desktopServerUrl;
  await assertXcuitestDriverInstalled(process.env as Record<string, string | undefined>);
  await assertDesktopServerReachable(desktopServerUrl);
  const expoServer = await ensureExpoServer({
    desktopServerUrl,
    metroPort: env.metroPort,
    projectRoot: resolve(dirname(fileURLToPath(import.meta.url)), "..")
  });

  const appiumServer = startLocalAppiumServer(
    env.appiumPort,
    process.env as Record<string, string | undefined>
  );
  let driver: Browser | null = null;

  try {
    await waitForLocalAppiumServer(env.appiumPort);

    let capabilities: Record<string, unknown>;

    if (env.target === "device") {
      const appiumVisibleUdids = await listXcuitestConnectedDeviceUdids(
        process.env as Record<string, string | undefined>
      );
      const device = await resolvePhysicalDevice(
        env.deviceUdid,
        appiumVisibleUdids,
        env.physicalDeviceName
      );
      await assertPhysicalDeviceAppInstalled(device, env.bundleId, env.metroPort);
      capabilities = createPhysicalDeviceCapabilities({
        appiumPort: env.appiumPort,
        bundleId: env.bundleId,
        deviceName: device.name,
        deviceUdid: device.udid,
        platformVersion: device.platformVersion,
        xcodeOrgId: env.xcodeOrgId,
        xcodeSigningId: env.xcodeSigningId,
        updatedWdaBundleId: env.updatedWdaBundleId
      });
    } else {
      const device = await resolveSimulatorDevice(env.deviceName);
      await bootSimulator(device);
      await assertSimulatorAppInstalled(device, env.bundleId);
      capabilities = createSimulatorCapabilities({
        appiumPort: env.appiumPort,
        bundleId: env.bundleId,
        deviceName: device.name
      });
    }

    driver = await createMobileSession({
      port: env.appiumPort,
      capabilities
    });

    await runListDetailBackSmoke(driver);
  } finally {
    if (driver) {
      await driver.deleteSession();
    }
    appiumServer.kill("SIGTERM");
    await expoServer.stop();
  }
}

const isEntrypoint =
  typeof process.argv[1] === "string" &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isEntrypoint) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
