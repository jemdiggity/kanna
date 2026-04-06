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

  it("packages terminal recovery as bundled runtime resources instead of a pkg sidecar", () => {
    const stageSidecarsScript = readFileSync(
      new URL("../../../scripts/stage-sidecars.sh", import.meta.url),
      "utf8",
    );
    const stageRecoveryRuntimeScript = readFileSync(
      new URL("../../../scripts/stage-terminal-recovery-runtime.sh", import.meta.url),
      "utf8",
    );
    const recoveryPkg = readFileSync(
      new URL("../../../packages/terminal-recovery/package.json", import.meta.url),
      "utf8",
    );

    expect(desktopPkg.scripts?.["build:sidecars"]).toContain("stage-terminal-recovery-runtime.sh");
    expect(tauriConf.bundle.externalBin).not.toContain("binaries/kanna-terminal-recovery");
    expect(tauriConf.bundle.externalBin).toContain("binaries/kanna-node-runtime");
    expect(
      tauriConf.bundle.resources["../../../.build/tauri-resources/terminal-recovery/"],
    ).toBe("terminal-recovery/");
    expect(stageSidecarsScript).not.toContain("kanna-terminal-recovery");
    expect(stageSidecarsScript).toContain("kanna-node-runtime");
    expect(stageRecoveryRuntimeScript).toContain("terminal-recovery/dist");
    expect(recoveryPkg).not.toContain("pkg");
  });

  it("builds sidecars as a prerequisite and keeps beforeDevCommand limited to vite", () => {
    expect(desktopPkg.scripts?.dev).not.toContain("build:sidecars");
    expect(desktopPkg.scripts?.dev).toContain("vite");
    expect(tauriConf.build.beforeDevCommand).toBe("bun run dev");
    expect(tauriConf.build.beforeBuildCommand).toBe("bun run build");
    expect(rootPkg.scripts?.dev).toBe("./scripts/dev.sh");
  });
});
