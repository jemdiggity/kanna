import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const defaultTauriIconSha256 =
  "3dc10493b7de48a61de58f768f8a5708d3a44a068c148cedf0502b9b9b71ba5d";

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

describe("ship script release retry behavior", () => {
  it("uses the VERSION file as the source of truth for the current version", () => {
    const shipScript = readFileSync(
      resolve(repoRoot, "scripts/ship.sh"),
      "utf8",
    );

    expect(shipScript).toContain("SOURCE_VERSION=$(read_current_version)");
    expect(shipScript).toContain('IFS=\'.\' read -r MAJOR MINOR PATCH <<< "$SOURCE_VERSION"');
    expect(shipScript).not.toContain(
      "IFS='.' read -r MAJOR MINOR PATCH <<< \"$LAST_VERSION\"",
    );
  });

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

  it("sources desktop_crates from the narrow desktop workspace manifest", () => {
    const moduleBazel = readFileSync(resolve(repoRoot, "MODULE.bazel"), "utf8");

    expect(moduleBazel).toContain('name = "desktop_crates"');
    expect(moduleBazel).toContain('cargo_lockfile = "//:Cargo.desktop.lock"');
    expect(moduleBazel).toContain('manifests = ["//:Cargo.desktop.toml"]');
    expect(moduleBazel).not.toContain('cargo_lockfile = "//apps/desktop/src-tauri:Cargo.lock"');
    expect(moduleBazel).not.toContain('manifests = ["//:Cargo.toml"]');
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

  it("uses the same dmg asset name in dry-run and release without signed in the filename", () => {
    const shipScript = readFileSync(
      resolve(repoRoot, "scripts/ship.sh"),
      "utf8",
    );

    expect(shipScript).toContain('echo "Kanna_${VERSION}_${suffix}.dmg"');
    expect(shipScript).not.toContain('echo "Kanna_${VERSION}_${suffix}-signed.dmg"');
  });

  it("does not emit signed in bazel dmg output filenames", () => {
    const rootBuild = readFileSync(
      resolve(repoRoot, "BUILD.bazel"),
      "utf8",
    );

    expect(rootBuild).toContain('output_name = "release/Kanna-arm64.dmg"');
    expect(rootBuild).toContain('output_name = "release/Kanna-x86_64.dmg"');
    expect(rootBuild).toContain('output_name = "release/signed/Kanna-arm64.dmg"');
    expect(rootBuild).toContain('output_name = "release/signed/Kanna-x86_64.dmg"');
    expect(rootBuild).not.toContain('output_name = "release/Kanna-arm64-signed.dmg"');
    expect(rootBuild).not.toContain('output_name = "release/Kanna-x86_64-signed.dmg"');
  });

  it("uses the same desktop bundle identifier in Bazel and tauri config", () => {
    const rootBuild = readFileSync(
      resolve(repoRoot, "BUILD.bazel"),
      "utf8",
    );
    const tauriConfig = readFileSync(
      resolve(repoRoot, "apps/desktop/src-tauri/tauri.conf.json"),
      "utf8",
    );

    expect(tauriConfig).toContain('"identifier": "build.kanna"');
    expect(rootBuild).toContain('bundle_id = "build.kanna"');
    expect(rootBuild).not.toContain('bundle_id = "com.kanna.app"');
  });

  it("uses the custom macOS app icon for Bazel app and DMG builds", () => {
    const rootBuild = readFileSync(
      resolve(repoRoot, "BUILD.bazel"),
      "utf8",
    );
    const tauriConfig = readFileSync(
      resolve(repoRoot, "apps/desktop/src-tauri/tauri.conf.json"),
      "utf8",
    );
    const macosIcon = readFileSync(
      resolve(repoRoot, "apps/desktop/src-tauri/icons/icon.icns"),
    );

    expect(rootBuild).toContain(
      'srcs = ["//apps/desktop/src-tauri:icons/icon.icns"]',
    );
    expect(rootBuild).toContain('volume_icon = ":desktop_macos_icon"');
    expect(tauriConfig).toContain('"icons/icon.icns"');
    expect(sha256(macosIcon)).not.toBe(defaultTauriIconSha256);
  });
});

describe("desktop version wiring", () => {
  it("routes desktop app version through crate constants so Bazel can override it from VERSION", () => {
    const desktopLib = readFileSync(
      resolve(repoRoot, "apps/desktop/src-tauri/src/lib.rs"),
      "utf8",
    );
    const fsCommands = readFileSync(
      resolve(repoRoot, "apps/desktop/src-tauri/src/commands/fs.rs"),
      "utf8",
    );

    expect(desktopLib).toContain(
      'pub(crate) const KANNA_VERSION: &str = env!("KANNA_VERSION");',
    );
    expect(desktopLib).toContain(".short_version(Some(KANNA_VERSION))");
    expect(fsCommands).toContain("version: crate::KANNA_VERSION.to_string(),");
  });

  it("does not hardcode the Bazel desktop app version in BUILD.bazel", () => {
    const desktopBuild = readFileSync(
      resolve(repoRoot, "apps/desktop/src-tauri/BUILD.bazel"),
      "utf8",
    );

    expect(desktopBuild).toContain('name = "kanna_desktop_lib_rs"');
    expect(desktopBuild).toContain('"//:VERSION"');
    expect(desktopBuild).toContain(
      'version = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8").strip()',
    );
    expect(desktopBuild).not.toContain('"KANNA_VERSION": "0.0.33"');
  });
});

describe("updater release assets", () => {
  it("requires updater signing inputs before publishing a release", () => {
    const shipScript = readFileSync(
      resolve(repoRoot, "scripts/ship.sh"),
      "utf8",
    );

    expect(shipScript).toContain("KANNA_UPDATER_PUBKEY");
    expect(shipScript).toContain("TAURI_PRIVATE_KEY_PATH");
    expect(shipScript).toContain("TAURI_PRIVATE_KEY_PASSWORD");
  });

  it("creates architecture-specific updater tarballs and signatures", () => {
    const shipScript = readFileSync(
      resolve(repoRoot, "scripts/ship.sh"),
      "utf8",
    );

    expect(shipScript).toContain('echo "Kanna_${VERSION}_${suffix}.app.tar.gz"');
    expect(shipScript).toContain("tauri signer sign");
    expect(shipScript).toContain('local generated_sig="${bundle_path}.sig"');
    expect(shipScript).toContain('mv "$generated_sig" "$signature_path"');
    expect(shipScript).not.toContain(
      'pnpm --dir "$ROOT/apps/desktop" exec tauri signer sign "$bundle_path" > "$signature_path"',
    );
    expect(shipScript).toContain(".app.tar.gz.sig");
  });

  it("publishes a latest.json manifest alongside the release assets", () => {
    const shipScript = readFileSync(
      resolve(repoRoot, "scripts/ship.sh"),
      "utf8",
    );

    expect(shipScript).toContain('gh release view "v$VERSION" --json body,publishedAt');
    expect(shipScript).toContain('RELEASE_BODY="$(read_release_metadata_field "$release_metadata_json" body)"');
    expect(shipScript).toContain(
      'RELEASE_PUBLISHED_AT="$(read_release_metadata_field "$release_metadata_json" publishedAt)"',
    );
    expect(shipScript).toContain('write_latest_json "$RELEASE_BODY" "$RELEASE_PUBLISHED_AT"');
    expect(shipScript).toContain('const notes = process.env.RELEASE_NOTES;');
    expect(shipScript).toContain('const pubDate = process.env.PUBLISHED_AT;');
    expect(shipScript).not.toContain("new Date().toISOString()");
    expect(shipScript).toContain("latest.json");
    expect(shipScript).toContain("darwin-aarch64");
    expect(shipScript).toContain("darwin-x86_64");
    expect(shipScript).toContain('gh release create "v$VERSION" "${DMG_PATHS[@]}" "${UPDATER_PATHS[@]}" \\');
    expect(shipScript).not.toContain('gh release create "v$VERSION" "${DMG_PATHS[@]}" "${UPDATER_PATHS[@]}" "$LATEST_JSON"');
    expect(shipScript).toContain('gh release upload "v$VERSION" "$LATEST_JSON" --clobber');
    expect(shipScript).toContain("gh release upload");
  });
});
