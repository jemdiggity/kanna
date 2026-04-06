import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ship script release retry behavior", () => {
  it("checks for an existing release before rebuilding an already-synced version", () => {
    const shipScript = readFileSync(
      new URL("../../../scripts/ship.sh", import.meta.url),
      "utf8",
    );

    expect(shipScript).toContain('gh release view "v$VERSION"');
  });

  it("does not require a new version-bump commit when the target version is already staged", () => {
    const shipScript = readFileSync(
      new URL("../../../scripts/ship.sh", import.meta.url),
      "utf8",
    );

    expect(shipScript).toContain('git -C "$ROOT" diff --cached --quiet');
    expect(shipScript).toContain("No version file changes to commit");
  });

  it("reports the GitHub release URL from gh instead of a hardcoded repository path", () => {
    const shipScript = readFileSync(
      new URL("../../../scripts/ship.sh", import.meta.url),
      "utf8",
    );

    expect(shipScript).toContain('gh release view "v$VERSION" --json url --jq \'.url\'');
    expect(shipScript).not.toContain(
      "https://github.com/jemdiggity/kanna-tauri/releases/tag/v$VERSION",
    );
  });
});
