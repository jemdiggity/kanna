#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA_PATH="$ROOT_DIR/.kanna/config.schema.json"
CONFIG_PATH="$ROOT_DIR/.kanna/config.json"
WORKFLOW_PATH="$ROOT_DIR/.github/workflows/config-schema-pages.yml"
BUILD_SCRIPT_PATH="$ROOT_DIR/scripts/build-pages-schema.sh"

node - "$SCHEMA_PATH" "$CONFIG_PATH" <<'NODE'
const fs = require("fs");

const [schemaPath, configPath] = process.argv.slice(2);
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

if (schema.$id !== "https://schemas.kanna.build/config.schema.json") {
  throw new Error(`unexpected $id: ${schema.$id}`);
}

if (schema.type !== "object") {
  throw new Error(`expected object schema, got ${schema.type}`);
}

if (schema.additionalProperties !== false) {
  throw new Error("expected top-level additionalProperties=false");
}

for (const key of ["$schema", "pipeline", "setup", "teardown", "test", "ports", "stage_order", "workspace"]) {
  if (!schema.properties || !(key in schema.properties)) {
    throw new Error(`missing top-level schema property: ${key}`);
  }
}

if (config.$schema !== "https://schemas.kanna.build/config.schema.json") {
  throw new Error(`unexpected config $schema: ${config.$schema}`);
}
NODE

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

"$ROOT_DIR/scripts/build-pages-schema.sh" "$TMP_DIR"

test -f "$TMP_DIR/config.schema.json"
test -f "$TMP_DIR/CNAME"
cmp "$SCHEMA_PATH" "$TMP_DIR/config.schema.json"

if [ "$(cat "$TMP_DIR/CNAME")" != "schemas.kanna.build" ]; then
  echo "unexpected CNAME contents" >&2
  exit 1
fi

grep -Fq 'actions/configure-pages@v5' "$WORKFLOW_PATH"
grep -Fq 'actions/upload-pages-artifact@v3' "$WORKFLOW_PATH"
grep -Fq 'actions/deploy-pages@v4' "$WORKFLOW_PATH"
grep -Fq 'scripts/build-pages-schema.sh' "$WORKFLOW_PATH"
grep -Fq 'schemas.kanna.build' "$BUILD_SCRIPT_PATH"
