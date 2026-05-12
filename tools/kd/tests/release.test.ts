import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CommandRunner } from "../src/runtime/process";
import { createUpdaterBundle, type ReleaseShipInput } from "../src/runtime/release";

interface CommandCall {
  command: string;
  args: string[];
  options?: { cwd?: string; env?: NodeJS.ProcessEnv };
}

describe("release updater bundling", () => {
  // A regular full kd release ship -> updater install E2E would need signed release
  // artifacts, both macOS architectures, GitHub release metadata/assets, and a
  // WebDriver-driven installed app. The existing opt-in full-bundle updater E2E
  // builds its own temporary debug bundle instead of executing this release helper.
  // A feasible regular E2E would need a hermetic release backend with small signed
  // fixtures and a local updater manifest server. This test keeps the regression
  // guard at the production bundle helper boundary: command-runner env propagation,
  // copying the Bazel-created updater archive, and signer output placement.
  it("copies the Bazel updater bundle and renames the generated signature", async () => {
    const root = await mkdtemp(join(tmpdir(), "kd-release-"));
    try {
      const repoRoot = join(root, "repo");
      const bundleSource = join(repoRoot, "bazel-out", "release", "Kanna-arm64.app.tar.gz");
      const bundlePath = join(repoRoot, ".build", "release", "Kanna_1.2.4_arm64.app.tar.gz");
      const signaturePath = join(repoRoot, ".build", "release", "custom-updater.sig");
      const privateKeyPath = join(root, "updater-private.key");

      mkdirSync(join(repoRoot, "bazel-out", "release"), { recursive: true });
      mkdirSync(join(repoRoot, ".build", "release"), { recursive: true });
      writeFileSync(bundleSource, "bazel updater archive\n");
      writeFileSync(privateKeyPath, "private key\n");

      const calls: CommandCall[] = [];
      const runner: CommandRunner = {
        async run(command, args, options) {
          calls.push({ command, args, options });

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

      await createUpdaterBundle(input, bundleSource, bundlePath, signaturePath);

      expect(readFileSync(bundlePath, "utf8")).toBe("bazel updater archive\n");
      expect(readFileSync(signaturePath, "utf8")).toBe("signed bundle\n");
      expect(calls.some((call) => call.command === "tar")).toBe(false);
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
