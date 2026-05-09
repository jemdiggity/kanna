import type { CommandRunner } from "./process";

export interface PortStatus {
  name: string;
  port: number;
  listening: boolean;
  pids: string[];
}

export async function getPortStatuses(runner: CommandRunner, ports: Record<string, number>): Promise<PortStatus[]> {
  const statuses: PortStatus[] = [];
  for (const [name, port] of Object.entries(ports)) {
    const result = await runner.run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
    const pids = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    statuses.push({
      name,
      port,
      listening: result.exitCode === 0 && pids.length > 0,
      pids
    });
  }
  return statuses;
}
