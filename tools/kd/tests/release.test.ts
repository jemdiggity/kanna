import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { CommandRunner } from "../src/runtime/process";
import { createUpdaterBundle, type ReleaseShipInput } from "../src/runtime/release";

interface CommandCall {
  command: string;
  args: string[];
  options?: { cwd?: string; env?: NodeJS.ProcessEnv };
}

function runSystemCommand(command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) {
  const result = spawnSync(command, args, {
    cwd: options?.cwd,
    env: options?.env,
    encoding: "utf8"
  });

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? ""
  };
}

function maybeAddMacExtendedAttribute(path: string): void {
  if (process.platform !== "darwin") return;

  spawnSync("xattr", ["-w", "com.kanna.appledouble-test", "present", path], {
    encoding: "utf8"
  });
}

describe("release updater bundling", () => {
  // A regular full kd release ship -> updater install E2E would need signed release
  // artifacts, both macOS architectures, GitHub release metadata/assets, and a
  // WebDriver-driven installed app. The existing opt-in full-bundle updater E2E
  // builds its own temporary debug bundle instead of executing this release helper.
  // A feasible regular E2E would need a hermetic release backend with small signed
  // fixtures and a local updater manifest server. This test keeps the regression
  // guard at the production bundle helper boundary: command-runner env propagation,
  // real tar archive contents, and signer output placement.
  it("runs tar with COPYFILE_DISABLE, avoids AppleDouble entries, and renames the generated signature", async () => {
    const root = await mkdtemp(join(tmpdir(), "kd-release-"));
    try {
      const repoRoot = join(root, "repo");
      const appSource = join(repoRoot, "bazel-out", "release", "arm64", "Kanna.app");
      const bundlePath = join(repoRoot, ".build", "release", "Kanna_1.2.4_arm64.app.tar.gz");
      const signaturePath = join(repoRoot, ".build", "release", "custom-updater.sig");
      const privateKeyPath = join(root, "updater-private.key");

      mkdirSync(join(appSource, "Contents"), { recursive: true });
      mkdirSync(join(repoRoot, ".build", "release"), { recursive: true });
      writeFileSync(join(appSource, "Contents", "Info.plist"), "<plist />\n");
      writeFileSync(privateKeyPath, "private key\n");
      maybeAddMacExtendedAttribute(appSource);

      const calls: CommandCall[] = [];
      const runner: CommandRunner = {
        async run(command, args, options) {
          calls.push({ command, args, options });

          if (command === "tar") {
            return runSystemCommand(command, args, options);
          }

          if (command === "pnpm") {
            const signedBundlePath = args.at(-1);
            expect(signedBundlePath).toBe(bundlePath);
            writeFileSync(`${signedBundlePath}.sig`, "signed bundle\n");
            return { exitCode: 0, stdout: "", stderr: "" };
          }

          return { exitCode: 1, stdout: "", stderr: `unexpected command ${command}` };
        }
      };
      const input: ReleaseShipInput = {
        repoRoot,
        bump: "patch",
        archLabels: ["arm64"],
        release: false,
        dryRun: true,
        env: {
          KANNA_UPDATER_PUBKEY: "pubkey",
          TAURI_PRIVATE_KEY_PATH: privateKeyPath,
          TAURI_PRIVATE_KEY_PASSWORD: "password",
          PATH: process.env.PATH
        },
        runner
      };

      await createUpdaterBundle(input, appSource, bundlePath, signaturePath);

      const tarCall = calls.find((call) => call.command === "tar");
      expect(tarCall?.args).toEqual(["-C", join(repoRoot, "bazel-out", "release", "arm64"), "-czf", bundlePath, basename(appSource)]);
      expect(tarCall?.options?.env?.COPYFILE_DISABLE).toBe("1");

      const archiveList = runSystemCommand("tar", ["-tzf", bundlePath]);
      expect(archiveList.exitCode).toBe(0);
      const entries = archiveList.stdout.trim().split("\n").filter(Boolean);
      expect(entries).toContain("Kanna.app/");
      expect(entries.some((entry) => entry === "._Kanna.app" || entry.includes("/._"))).toBe(false);

      expect(readFileSync(signaturePath, "utf8")).toBe("signed bundle\n");
      expect(calls.find((call) => call.command === "pnpm")?.args).toEqual([
        "--dir",
        join(repoRoot, "apps", "desktop"),
        "exec",
        "tauri",
        "signer",
        "sign",
        "--private-key-path",
        privateKeyPath,
        "--password",
        "password",
        bundlePath
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
