import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import rootPkg from "../../../package.json";
import desktopPkg from "../package.json";
import tauriConf from "../src-tauri/tauri.conf.json";

const repoRoot = resolve(process.cwd(), "../..");

describe("desktop sidecar packaging", () => {
  it("keeps release builds free of dev-only version and sidecar staging hooks", () => {
    expect(tauriConf.build.beforeBuildCommand).not.toContain("sync-version.sh");
    expect(tauriConf.build.beforeBuildCommand).not.toContain("build:sidecars");
    expect(desktopPkg.scripts?.dev).not.toContain("sync-version.sh");
    expect(rootPkg.scripts?.dev).not.toContain("sync-version.sh");
  });

  it("stages and builds all desktop sidecars, including kanna-server", () => {
    const stageSidecarsScript = readFileSync(
      resolve(repoRoot, "scripts/stage-sidecars.sh"),
      "utf8",
    );
    expect(desktopPkg.scripts?.["build:sidecars"]).toContain("packages/terminal-recovery/Cargo.toml");
    expect(desktopPkg.scripts?.["build:sidecars"]).toContain("crates/kanna-server/Cargo.toml");
    expect(tauriConf.bundle.externalBin).toContain("binaries/kanna-terminal-recovery");
    expect(stageSidecarsScript).toContain("kanna-terminal-recovery");
    expect(stageSidecarsScript).toContain("kanna-daemon");
    expect(stageSidecarsScript).toContain("kanna-cli");
    expect(stageSidecarsScript).toContain("kanna-server");
  });

  it("stages and bundles the task transfer sidecar", () => {
    const stageSidecarsScript = readFileSync(
      new URL("../../../scripts/stage-sidecars.sh", import.meta.url),
      "utf8",
    );
    const shipScript = readFileSync(
      new URL("../../../scripts/ship.sh", import.meta.url),
      "utf8",
    );
    expect(desktopPkg.scripts?.["build:sidecars"]).toContain("crates/task-transfer/Cargo.toml");
    expect(tauriConf.bundle.externalBin).toContain("binaries/kanna-task-transfer");
    expect(stageSidecarsScript).toContain("kanna-task-transfer");
    expect(shipScript).toContain("crates/task-transfer/Cargo.toml");
  });

  it("builds sidecars as a prerequisite and keeps beforeDevCommand limited to vite", () => {
    expect(desktopPkg.scripts?.dev).not.toContain("build:sidecars");
    expect(desktopPkg.scripts?.dev).toContain("vite");
    expect(tauriConf.build.beforeDevCommand).toBe("pnpm run dev");
    expect(tauriConf.build.beforeBuildCommand).toBe("pnpm run build");
    expect(rootPkg.scripts?.dev).toBe("./scripts/dev.sh");
  });
});
