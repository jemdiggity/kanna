import { pauseForSlowMode } from "./slowMode";

export async function pauseForAppReady(instanceLabel: string): Promise<void> {
  await pauseForSlowMode(`${instanceLabel} app ready`);
}

export async function pauseBeforeTestTarget(testTarget: string): Promise<void> {
  await pauseForSlowMode(`before ${testTarget}`);
}
