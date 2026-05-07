import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSidecarCargoCommands, stageSidecars } from "../src/runtime/sidecars";

describe("sidecar runtime", () => {
  it("builds each desktop sidecar for the host target", () => {
    expect(buildSidecarCargoCommands("aarch64-apple-darwin")).toEqual([
      ["cargo", ["build", "--target", "aarch64-apple-darwin", "--manifest-path", "crates/daemon/Cargo.toml"]],
      ["cargo", ["build", "--target", "aarch64-apple-darwin", "--manifest-path", "crates/kanna-cli/Cargo.toml"]],
      ["cargo", ["build", "--target", "aarch64-apple-darwin", "--manifest-path", "crates/kanna-mcp/Cargo.toml"]],
      ["cargo", ["build", "--target", "aarch64-apple-darwin", "--manifest-path", "crates/kanna-server/Cargo.toml"]],
      ["cargo", ["build", "--target", "aarch64-apple-darwin", "--manifest-path", "crates/task-transfer/Cargo.toml"]],
      ["cargo", ["build", "--target", "aarch64-apple-darwin", "--manifest-path", "packages/terminal-recovery/Cargo.toml"]]
    ]);
  });

  it("stages built sidecars with target suffixes", () => {
    const root = mkdtempSync(join(tmpdir(), "kandev-sidecars-"));
    const src = join(root, ".build", "aarch64-apple-darwin", "debug");
    mkdirSync(src, { recursive: true });
    for (const name of [
      "kanna-daemon",
      "kanna-cli",
      "kanna-mcp",
      "kanna-terminal-recovery",
      "kanna-server",
      "kanna-task-transfer"
    ]) {
      writeFileSync(join(src, name), name);
    }

    const staged = stageSidecars({ repoRoot: root, target: "aarch64-apple-darwin", profile: "debug", buildDir: ".build" });

    expect(staged.map((path) => path.replace(root, ""))).toEqual([
      "/apps/desktop/src-tauri/binaries/kanna-daemon-aarch64-apple-darwin",
      "/apps/desktop/src-tauri/binaries/kanna-cli-aarch64-apple-darwin",
      "/apps/desktop/src-tauri/binaries/kanna-mcp-aarch64-apple-darwin",
      "/apps/desktop/src-tauri/binaries/kanna-terminal-recovery-aarch64-apple-darwin",
      "/apps/desktop/src-tauri/binaries/kanna-server-aarch64-apple-darwin",
      "/apps/desktop/src-tauri/binaries/kanna-task-transfer-aarch64-apple-darwin"
    ]);
  });
});
