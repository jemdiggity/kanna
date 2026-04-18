import {
  assertXcuitestDriverInstalled,
  listInstalledAppiumDrivers
} from "./helpers/appium";
import { resolveRequiredMobileE2eEnv } from "./helpers/env";
import {
  assertSimulatorAppInstalled,
  bootSimulator,
  resolveSimulatorDevice
} from "./helpers/simulator";

async function main(): Promise<void> {
  const processEnv = process.env as Record<string, string | undefined>;
  const env = resolveRequiredMobileE2eEnv(processEnv);
  await assertXcuitestDriverInstalled(processEnv);
  const device = await resolveSimulatorDevice(env.deviceName);
  await bootSimulator(device);
  await assertSimulatorAppInstalled(device, env.bundleId);

  const driverSummary = await listInstalledAppiumDrivers(processEnv);
  const statusResponse = await fetch(`${env.desktopServerUrl}/v1/status`);
  if (!statusResponse.ok) {
    throw new Error(
      `Desktop mobile server check failed for ${env.desktopServerUrl}: ${statusResponse.status}`
    );
  }

  const serverStatus = (await statusResponse.json()) as Record<string, unknown>;
  process.stdout.write(
    `${JSON.stringify(
      {
        appiumPort: env.appiumPort,
        bundleId: env.bundleId,
        desktopServerUrl: env.desktopServerUrl,
        deviceName: device.name,
        driverVersion: driverSummary.xcuitest?.version ?? null,
        serverState: serverStatus.state ?? null
      },
      null,
      2
    )}\n`
  );
}

void main();
