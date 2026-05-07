import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface KannaRepoConfig {
  ports: Record<string, number>;
}

interface RawKannaRepoConfig {
  ports?: Record<string, unknown>;
}

export function parseKannaRepoConfig(raw: unknown): KannaRepoConfig {
  const record = raw && typeof raw === "object" ? (raw as RawKannaRepoConfig) : {};
  const ports: Record<string, number> = {};
  for (const [key, value] of Object.entries(record.ports ?? {})) {
    if (typeof value === "number" && Number.isInteger(value)) {
      ports[key] = value;
    }
  }
  return { ports };
}

export function readKannaRepoConfig(repoRoot: string): KannaRepoConfig {
  const path = join(repoRoot, ".kanna", "config.json");
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return parseKannaRepoConfig(parsed);
}
