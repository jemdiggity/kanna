import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import rootPkg from "../../../package.json";
import desktopPkg from "../package.json";
import tauriConf from "../src-tauri/tauri.conf.json";

describe("desktop sidecar packaging", () => {
  it("references the terminal recovery sidecar everywhere it needs to be staged", () => {
    const stageSidecarsScript = readFileSync(
      new URL("../../../scripts/stage-sidecars.sh", import.meta.url),
      "utf8",
    );

    expect(desktopPkg.scripts?.["build:sidecars"]).toContain("kanna-terminal-recovery");
    expect(tauriConf.bundle.externalBin).toContain("binaries/kanna-terminal-recovery");
    expect(stageSidecarsScript).toContain("kanna-terminal-recovery");
  });

  it("builds sidecars as a prerequisite and keeps beforeDevCommand limited to vite", () => {
    expect(desktopPkg.scripts?.dev).not.toContain("build:sidecars");
    expect(desktopPkg.scripts?.dev).toContain("vite");
    expect(tauriConf.build.beforeDevCommand).toBe("bun run dev");
    expect(tauriConf.build.beforeBuildCommand).toContain("build:sidecars");
    expect(rootPkg.scripts?.dev).toContain("build:sidecars");
  });
});
