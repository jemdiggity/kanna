import type { CommandRunner } from "./process";

export interface CommandAvailability {
  name: string;
  found: boolean;
  path?: string;
}

export interface DoctorResult {
  ok: boolean;
  commands: CommandAvailability[];
}

export async function checkRequiredCommands(runner: CommandRunner, commands: string[]): Promise<DoctorResult> {
  const results: CommandAvailability[] = [];
  for (const name of commands) {
    const result = await runner.run("command", ["-v", name]);
    const path = result.stdout.trim();
    results.push(result.exitCode === 0 && path ? { name, found: true, path } : { name, found: false });
  }
  return {
    ok: results.every((result) => result.found),
    commands: results
  };
}
