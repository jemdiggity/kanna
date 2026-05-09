import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CommandRunner } from "./process";

export interface SetupCheck {
  name: string;
  ok: boolean;
  message: string;
}

export interface SetupResult {
  ok: boolean;
  checks: SetupCheck[];
}

async function commandVersion(runner: CommandRunner, command: string, args: string[]): Promise<string | null> {
  const result = await runner.run(command, args);
  if (result.exitCode !== 0) return null;
  return result.stdout.trim() || result.stderr.trim() || command;
}

export async function checkSetupPrerequisites(runner: CommandRunner, repoRoot: string): Promise<SetupResult> {
  const checks: SetupCheck[] = [];
  const xcode = await runner.run("xcode-select", ["-p"]);
  checks.push({ name: "xcode", ok: xcode.exitCode === 0, message: xcode.exitCode === 0 ? xcode.stdout.trim() : "install with: xcode-select --install" });

  for (const [name, command, args] of [
    ["rust", "rustc", ["--version"]],
    ["cargo", "cargo", ["--version"]],
    ["node", "node", ["--version"]],
    ["pnpm", "pnpm", ["--version"]],
    ["bazel", "bazel", ["version"]],
    ["git", "git", ["--version"]],
    ["zig", "zig", ["version"]],
    ["tmux", "tmux", ["-V"]]
  ] as const) {
    const version = await commandVersion(runner, command, [...args]);
    checks.push({ name, ok: version !== null, message: version ?? `missing command: ${command}` });
  }

  checks.push({
    name: "node_modules",
    ok: existsSync(join(repoRoot, "node_modules")),
    message: existsSync(join(repoRoot, "node_modules")) ? "present" : "run ./kd setup"
  });

  return { ok: checks.every((check) => check.ok), checks };
}

export async function installSetupDependencies(runner: CommandRunner, repoRoot: string): Promise<void> {
  const result = await runner.run("pnpm", ["install"], { cwd: repoRoot });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "pnpm install failed");
  }
}
