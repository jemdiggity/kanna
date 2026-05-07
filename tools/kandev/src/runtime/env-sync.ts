import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function writeCargoConfig(repoRoot: string, homeDir: string): string {
  const path = join(repoRoot, ".cargo", "config.toml");
  mkdirSync(join(repoRoot, ".cargo"), { recursive: true });
  writeFileSync(path, `[build]\ntarget-dir = ".build"\nbuild-dir = "${homeDir}/Library/Caches/kanna/rust-build"\n`);
  return path;
}
