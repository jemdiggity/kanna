import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bazelOutputBase, cleanWorkspace } from "../src/runtime/clean";
import { buildConfigSchemaPages } from "../src/runtime/pages";
import {
  bazelTargetForLabel,
  bumpVersion,
  releaseAssetName,
  releaseRepoSlug,
  signedAppTargetForLabel,
  updaterAssetName,
  updaterBundleTargetForLabel,
  updaterPlatformKey,
  updaterSignatureName
} from "../src/runtime/release";

describe("clean runtime", () => {
  it("removes workspace-local build artifacts without removing shared caches by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "kd-clean-"));
    const home = join(root, "home");
    const repo = join(root, "repo");
    const sharedRust = join(home, "Library", "Caches", "kanna", "rust-build");
    for (const dir of [
      join(repo, ".build"),
      join(repo, "apps", "desktop", "src-tauri", "target"),
      bazelOutputBase(repo, home, "tester"),
      sharedRust
    ]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "artifact.txt"), "x");
    }

    const result = cleanWorkspace({ repoRoot: repo, homeDir: home, userName: "tester", all: false, dry: false, sharedRustBuild: false });

    expect(result.removals.map((removal) => removal.path)).toContain(bazelOutputBase(repo, home, "tester"));
    expect(existsSync(join(repo, ".build"))).toBe(false);
    expect(existsSync(sharedRust)).toBe(true);
    await rm(root, { recursive: true, force: true });
  });
});

describe("pages runtime", () => {
  it("builds the config schema Pages artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "kd-pages-"));
    mkdirSync(join(root, ".kanna"), { recursive: true });
    writeFileSync(join(root, ".kanna", "config.schema.json"), '{"type":"object"}\n');

    const [schema, cname] = buildConfigSchemaPages({ repoRoot: root, outDir: join(root, "out") });

    expect(readFileSync(schema, "utf8")).toBe('{"type":"object"}\n');
    expect(readFileSync(cname, "utf8")).toBe("schemas.kanna.build\n");
    await rm(root, { recursive: true, force: true });
  });
});

describe("release runtime", () => {
  it("builds release names and targets without shell scripts", () => {
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(releaseAssetName("1.2.4", "arm64")).toBe("Kanna_1.2.4_arm64.dmg");
    expect(updaterAssetName("1.2.4", "x86_64")).toBe("Kanna_1.2.4_x86_64.app.tar.gz");
    expect(updaterSignatureName("1.2.4", "x86_64")).toBe("Kanna_1.2.4_x86_64.app.tar.gz.sig");
    expect(updaterPlatformKey("arm64")).toBe("darwin-aarch64");
    expect(bazelTargetForLabel("arm64", true)).toBe("//:kanna_signed_dmg_release_arm64");
    expect(bazelTargetForLabel("arm64", false)).toBe("//:kanna_notarized_dmg_release_arm64");
    expect(signedAppTargetForLabel("x86_64")).toBe("//:kanna_signed_app_release_x86_64");
    expect(updaterBundleTargetForLabel("x86_64")).toBe("//:kanna_updater_bundle_release_x86_64");
    expect(releaseRepoSlug("git@github.com:jemdiggity/kanna.git")).toBe("jemdiggity/kanna");
  });
});
