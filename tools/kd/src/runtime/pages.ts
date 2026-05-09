import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface BuildConfigSchemaPagesInput {
  repoRoot: string;
  outDir: string;
}

export function buildConfigSchemaPages(input: BuildConfigSchemaPagesInput): string[] {
  mkdirSync(input.outDir, { recursive: true });
  const schemaOut = join(input.outDir, "config.schema.json");
  const cnameOut = join(input.outDir, "CNAME");
  copyFileSync(join(input.repoRoot, ".kanna", "config.schema.json"), schemaOut);
  writeFileSync(cnameOut, "schemas.kanna.build\n");
  return [schemaOut, cnameOut];
}
