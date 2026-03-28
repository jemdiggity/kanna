/**
 * Built-in stage display order used when no repo-level override is configured.
 * Stages not listed here sort alphabetically after the listed ones.
 */
export const DEFAULT_STAGE_ORDER: readonly string[] = ["merge", "pr", "in progress"];

export interface RepoConfig {
  pipeline?: string;
  setup?: string[];
  teardown?: string[];
  test?: string[];
  ports?: Record<string, number>;
  stage_order?: string[];
}

export function parseRepoConfig(json: string): RepoConfig {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const config: RepoConfig = {};

  if (typeof raw.pipeline === "string") {
    config.pipeline = raw.pipeline;
  }

  if (Array.isArray(raw.setup) && raw.setup.every((s) => typeof s === "string")) {
    config.setup = raw.setup as string[];
  }

  if (Array.isArray(raw.teardown) && raw.teardown.every((s) => typeof s === "string")) {
    config.teardown = raw.teardown as string[];
  }

  if (Array.isArray(raw.test) && raw.test.every((s) => typeof s === "string")) {
    config.test = raw.test as string[];
  }

  if (raw.ports && typeof raw.ports === "object" && !Array.isArray(raw.ports)) {
    const ports: Record<string, number> = {};
    for (const [name, value] of Object.entries(raw.ports as Record<string, unknown>)) {
      if (typeof value === "number") ports[name] = value;
    }
    if (Object.keys(ports).length > 0) config.ports = ports;
  }

  if (Array.isArray(raw.stage_order) && raw.stage_order.every((s) => typeof s === "string")) {
    config.stage_order = raw.stage_order as string[];
  }

  return config;
}
