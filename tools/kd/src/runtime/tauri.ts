import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "./files";

export function writeTauriLocalConfig(repoRoot: string, devPort: number): string {
  const path = join(repoRoot, "apps", "desktop", "src-tauri", "tauri.conf.local.json");
  writeJsonFile(path, {
    build: {
      devUrl: `http://localhost:${devPort}`
    }
  });
  return path;
}

interface TauriConfig {
  identifier?: unknown;
}

export function readDesktopBundleIdentifier(repoRoot: string): string {
  const path = join(repoRoot, "apps", "desktop", "src-tauri", "tauri.conf.json");
  const config = readJsonFile(path) as TauriConfig;
  return typeof config.identifier === "string" && config.identifier.trim() ? config.identifier : "build.kanna";
}
