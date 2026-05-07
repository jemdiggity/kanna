import { join } from "node:path";

export interface BuiltCommand {
  command: string;
  args: string[];
}

export function buildMobileTestCommand(repoRoot: string): BuiltCommand {
  return {
    command: "pnpm",
    args: ["--dir", join(repoRoot, "apps", "mobile"), "test"]
  };
}

export function buildMobileDeviceSmokeCommand(repoRoot: string): BuiltCommand {
  return {
    command: "pnpm",
    args: ["--dir", join(repoRoot, "apps", "mobile"), "run", "test:e2e:device:smoke"]
  };
}
