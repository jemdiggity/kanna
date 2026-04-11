import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");

describe("ship script release retry behavior", () => {
  it("checks for an existing release before rebuilding an already-synced version", () => {
    const shipScript = readFileSync(
      resolve(repoRoot, "scripts/ship.sh"),
      "utf8",
    );

    expect(shipScript).toContain('gh release view "v$VERSION"');
  });

  it("does not require a new version-bump commit when the target version is already staged", () => {
    const shipScript = readFileSync(
      resolve(repoRoot, "scripts/ship.sh"),
      "utf8",
    );

    expect(shipScript).toContain('git -C "$ROOT" diff --cached --quiet');
    expect(shipScript).toContain("No version file changes to commit");
  });

  it("reports the GitHub release URL from gh instead of a hardcoded repository path", () => {
    const shipScript = readFileSync(
      resolve(repoRoot, "scripts/ship.sh"),
      "utf8",
    );

    expect(shipScript).toContain('gh release view "v$VERSION" --json url --jq \'.url\'');
    expect(shipScript).not.toContain(
      "https://github.com/jemdiggity/kanna-tauri/releases/tag/v$VERSION",
    );
  });

  it("resolves final Bazel outputs with cquery instead of assuming a bazel-bin path", () => {
    const shipScript = readFileSync(
      resolve(repoRoot, "scripts/ship.sh"),
      "utf8",
    );

    expect(shipScript).toContain("bazel cquery");
    expect(shipScript).toContain("--output=files");
    expect(shipScript).not.toContain('DMG_SOURCE="$BAZEL_BIN/release/');
  });
});

describe("release bundle naming", () => {
  it("emits signed app bundles as Kanna.app for both architectures", () => {
    const rootBuild = readFileSync(
      resolve(repoRoot, "BUILD.bazel"),
      "utf8",
    );

    expect(rootBuild).toContain('output_name = "release/arm64/Kanna.app"');
    expect(rootBuild).toContain('output_name = "release/x86_64/Kanna.app"');
    expect(rootBuild).not.toContain('output_name = "release/Kanna-arm64.app"');
    expect(rootBuild).not.toContain('output_name = "release/Kanna-x86_64.app"');
  });
});
