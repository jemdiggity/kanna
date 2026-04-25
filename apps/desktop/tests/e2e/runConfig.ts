import { join } from "node:path";

export interface InstanceConfig {
  baseUrl: string;
  daemonDir: string;
  env: Record<string, string>;
  startCommand: string[];
  stopCommand: string[];
  webDriverPort: number;
}

export interface CreateInstanceConfigInput {
  daemonDir: string;
  dbName: string;
  devPortEnvValue: number;
  effectiveWebDriverPort: number;
  env: Record<string, string>;
  sessionName: string;
  transferPortEnvValue: number;
  webDriverPortEnvValue: number;
}

export function createInstanceConfig(input: CreateInstanceConfigInput): InstanceConfig {
  return {
    baseUrl: `http://127.0.0.1:${input.effectiveWebDriverPort}`,
    daemonDir: input.daemonDir,
    env: input.env,
    startCommand: [
      "./scripts/dev.sh",
      "start",
      "--db",
      input.dbName,
      "--delete-db",
      "--daemon-dir",
      input.daemonDir,
      "--transfer-root",
      join(input.daemonDir, "transfer-root"),
    ],
    stopCommand: [
      "./scripts/dev.sh",
      "stop",
      "--kill-daemon",
      "--daemon-dir",
      input.daemonDir,
    ],
    webDriverPort: input.effectiveWebDriverPort,
  };
}
