#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT/packages/terminal-recovery/dist"
DEST_DIR="$ROOT/.build/tauri-resources/terminal-recovery"

mkdir -p "$DEST_DIR"

if [[ ! -f "$SRC_DIR/index.js" ]]; then
    echo "Error: $SRC_DIR/index.js not found. Build terminal recovery first." >&2
    exit 1
fi

cp "$SRC_DIR/index.js" "$DEST_DIR/index.js"

echo "    Staged terminal recovery runtime → $DEST_DIR"
