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
    const buildSidecarsScript = readFileSync(
      resolve(repoRoot, "scripts/build-sidecars.sh"),
      "utf8",
    );
    const stageSidecarsScript = readFileSync(
      resolve(repoRoot, "scripts/stage-sidecars.sh"),
      "utf8",
    );
    expect(desktopPkg.scripts?.["build:sidecars"]).toBe("../../scripts/build-sidecars.sh");
    expect(buildSidecarsScript).toContain("packages/terminal-recovery/Cargo.toml");
    expect(buildSidecarsScript).toContain("crates/kanna-server/Cargo.toml");
    expect(buildSidecarsScript).toContain(".build/sidecar-target");
    expect(tauriConf.bundle.externalBin).toContain("binaries/kanna-terminal-recovery");
    expect(stageSidecarsScript).toContain("kanna-terminal-recovery");
    expect(stageSidecarsScript).toContain("kanna-daemon");
    expect(stageSidecarsScript).toContain("kanna-cli");
    expect(stageSidecarsScript).toContain("kanna-server");
    expect(stageSidecarsScript).toContain("--build-dir");
  });

  it("builds sidecars as a prerequisite and keeps beforeDevCommand limited to vite", () => {
    expect(desktopPkg.scripts?.dev).not.toContain("build:sidecars");
    expect(desktopPkg.scripts?.dev).toContain("vite");
    expect(tauriConf.build.beforeDevCommand).toBe("pnpm run dev");
    expect(tauriConf.build.beforeBuildCommand).toBe("pnpm run build");
    expect(rootPkg.scripts?.dev).toBe("./scripts/dev.sh");
  });
});
