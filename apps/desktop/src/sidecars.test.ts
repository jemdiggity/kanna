import { readFileSync } from "node:fs";
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

  it("stages the daemon, cli, and terminal recovery sidecars", () => {
    const stageSidecarsScript = readFileSync(
      new URL("../../../scripts/stage-sidecars.sh", import.meta.url),
      "utf8",
    );
    const shipScript = readFileSync(
      new URL("../../../scripts/ship.sh", import.meta.url),
      "utf8",
    );
    expect(desktopPkg.scripts?.["build:sidecars"]).toContain("packages/terminal-recovery/Cargo.toml");
    expect(tauriConf.bundle.externalBin).toContain("binaries/kanna-terminal-recovery");
    expect(stageSidecarsScript).toContain("kanna-terminal-recovery");
    expect(stageSidecarsScript).toContain("kanna-daemon");
    expect(stageSidecarsScript).toContain("kanna-cli");
    expect(shipScript).toContain("packages/terminal-recovery/Cargo.toml");
  });

  it("builds sidecars as a prerequisite and keeps beforeDevCommand limited to vite", () => {
    expect(desktopPkg.scripts?.dev).not.toContain("build:sidecars");
    expect(desktopPkg.scripts?.dev).toContain("vite");
    expect(tauriConf.build.beforeDevCommand).toBe("bun run dev");
    expect(tauriConf.build.beforeBuildCommand).toBe("bun run build");
    expect(rootPkg.scripts?.dev).toBe("./scripts/dev.sh");
  });
});
