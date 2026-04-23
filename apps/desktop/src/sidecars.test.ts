import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import rootPkg from "../../../package.json";
import desktopPkg from "../package.json";
import tauriConf from "../src-tauri/tauri.conf.json";

describe("desktop sidecar packaging", () => {
  it("keeps release builds free of dev-only version and sidecar staging hooks", () => {
    expect(tauriConf.build.beforeBuildCommand).not.toContain("sync-version.sh");
    expect(tauriConf.build.beforeBuildCommand).not.toContain("build:sidecars");
    expect(desktopPkg.scripts?.dev).not.toContain("sync-version.sh");
    expect(rootPkg.scripts?.dev).not.toContain("sync-version.sh");
  });

  it("stages and builds all desktop sidecars, including kanna-server", () => {
    const buildSidecarsScript = desktopPkg.scripts?.["build:sidecars"];
    const rootBuildSidecarsScript = rootPkg.scripts?.["build:desktop-sidecars"];
    const stageSidecarsScript = tauriConf.bundle.externalBin.join("\n");
    expect(buildSidecarsScript).toBe("pnpm -C ../.. run build:desktop-sidecars");
    expect(rootBuildSidecarsScript).toContain(
      'cargo build --target "$TARGET" --manifest-path packages/terminal-recovery/Cargo.toml',
    );
    expect(rootBuildSidecarsScript).toContain(
      'cargo build --target "$TARGET" --manifest-path crates/kanna-server/Cargo.toml',
    );
    expect(rootBuildSidecarsScript).toContain('env -u CARGO_TARGET_DIR cargo build');
    expect(rootBuildSidecarsScript).toContain('TARGET="$(rustc -vV');
    expect(rootBuildSidecarsScript).toContain('--target "$TARGET"');
    expect(rootBuildSidecarsScript).toContain("scripts/stage-sidecars.sh");
    expect(rootBuildSidecarsScript).toContain('--target "$TARGET"');
    expect(tauriConf.bundle.externalBin).toContain("binaries/kanna-terminal-recovery");
    expect(stageSidecarsScript).toContain("binaries/kanna-terminal-recovery");
    expect(stageSidecarsScript).toContain("binaries/kanna-daemon");
    expect(stageSidecarsScript).toContain("binaries/kanna-cli");
    expect(stageSidecarsScript).toContain("binaries/kanna-server");
  });

  it("stages and bundles the task transfer sidecar", () => {
    const buildSidecarsScript = desktopPkg.scripts?.["build:sidecars"];
    const rootBuildSidecarsScript = rootPkg.scripts?.["build:desktop-sidecars"];
    const stageSidecarsScript = tauriConf.bundle.externalBin.join("\n");
    expect(buildSidecarsScript).toBe("pnpm -C ../.. run build:desktop-sidecars");
    expect(rootBuildSidecarsScript).toContain(
      'cargo build --target "$TARGET" --manifest-path crates/task-transfer/Cargo.toml',
    );
    expect(tauriConf.bundle.externalBin).toContain("binaries/kanna-task-transfer");
    expect(stageSidecarsScript).toContain("binaries/kanna-task-transfer");
  });

  it("keeps Bazel release bundles in sync with the desktop sidecar set", () => {
    const repoRoot = resolve(import.meta.dirname, "../../..");
    const bazelBuild = readFileSync(resolve(repoRoot, "BUILD.bazel"), "utf8");
    const moduleBazel = readFileSync(resolve(repoRoot, "MODULE.bazel"), "utf8");

    expect(bazelBuild).toContain('name = "kanna_bundle_inputs_release_arm64"');
    expect(bazelBuild).toContain('name = "kanna_bundle_inputs_release_x86_64"');
    expect(bazelBuild).toContain('":kanna_cli_release_arm64"');
    expect(bazelBuild).toContain('":kanna_daemon_release_arm64"');
    expect(bazelBuild).toContain('":kanna_terminal_recovery_release_arm64"');
    expect(bazelBuild).toContain('":kanna_server_release_arm64"');
    expect(bazelBuild).toContain('":kanna_task_transfer_release_arm64"');
    expect(bazelBuild).toContain('":kanna_cli_release_x86_64"');
    expect(bazelBuild).toContain('":kanna_daemon_release_x86_64"');
    expect(bazelBuild).toContain('":kanna_terminal_recovery_release_x86_64"');
    expect(bazelBuild).toContain('":kanna_server_release_x86_64"');
    expect(bazelBuild).toContain('":kanna_task_transfer_release_x86_64"');
    expect(moduleBazel).toContain('name = "kanna_server_crates"');
    expect(moduleBazel).toContain('manifests = ["//:Cargo.server.toml"]');
    expect(moduleBazel).toContain('name = "task_transfer_crates"');
    expect(moduleBazel).toContain('manifests = ["//crates/task-transfer:Cargo.toml"]');
  });

  it("builds sidecars as a prerequisite and keeps beforeDevCommand limited to vite", () => {
    expect(desktopPkg.scripts?.dev).not.toContain("build:sidecars");
    expect(desktopPkg.scripts?.dev).toContain("vite");
    expect(tauriConf.build.beforeDevCommand).toBe("pnpm run dev");
    expect(tauriConf.build.beforeBuildCommand).toBe("pnpm run build");
    expect(rootPkg.scripts?.dev).toBe("./scripts/dev.sh");
  });
});
