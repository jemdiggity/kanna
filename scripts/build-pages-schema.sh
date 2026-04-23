#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:?usage: build-pages-schema.sh <out-dir>}"

mkdir -p "$OUT_DIR"
cp "$ROOT_DIR/.kanna/config.schema.json" "$OUT_DIR/config.schema.json"
printf 'schemas.kanna.build\n' > "$OUT_DIR/CNAME"
