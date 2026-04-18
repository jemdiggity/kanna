import { pathToFileURL } from "node:url";
import { createSimulatorCapabilities } from "./appium.config";
import {
  assertXcuitestDriverInstalled,
  startLocalAppiumServer,
  waitForLocalAppiumServer
} from "./helpers/appium";
import { resolveRequiredMobileE2eEnv } from "./helpers/env";
import { createMobileSession } from "./helpers/session";
import {
  assertSimulatorAppInstalled,
  bootSimulator,
  resolveSimulatorDevice
} from "./helpers/simulator";
import { runListDetailBackSmoke } from "./specs/smoke/list-detail-back.e2e";

export const smokeSpecPaths = ["specs/smoke/list-detail-back.e2e.ts"];

async function assertDesktopServerReachable(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/v1/status`);
  if (!response.ok) {
    throw new Error(`Desktop mobile server check failed: ${response.status}`);
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "smoke";
  if (mode !== "smoke") {
    throw new Error(`Unsupported mobile E2E mode: ${mode}`);
  }

  const env = resolveRequiredMobileE2eEnv(
    process.env as Record<string, string | undefined>
  );
  await assertXcuitestDriverInstalled(process.env as Record<string, string | undefined>);
  const device = await resolveSimulatorDevice(env.deviceName);
  await assertDesktopServerReachable(env.desktopServerUrl);

  await bootSimulator(device);
  await assertSimulatorAppInstalled(device, env.bundleId);

  const appiumServer = startLocalAppiumServer(
    env.appiumPort,
    process.env as Record<string, string | undefined>
  );
  await waitForLocalAppiumServer(env.appiumPort);

  const driver = await createMobileSession({
    port: env.appiumPort,
    capabilities: createSimulatorCapabilities({
      appiumPort: env.appiumPort,
      bundleId: env.bundleId,
      deviceName: device.name
    })
  });

  try {
    await runListDetailBackSmoke(driver);
  } finally {
    await driver.deleteSession();
    appiumServer.kill("SIGTERM");
  }
}

const isEntrypoint =
  typeof process.argv[1] === "string" &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isEntrypoint) {
  void main();
}
