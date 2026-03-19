#!/bin/bash
# Sync VERSION file to all package.json and tauri.conf.json files
set -e
ROOT="$(git rev-parse --show-toplevel)"
VERSION="$(cat "$ROOT/VERSION" | tr -d '[:space:]')"

# Update package.json files that have a version field
for f in "$ROOT"/package.json "$ROOT"/apps/*/package.json "$ROOT"/packages/*/package.json; do
  [ -f "$f" ] || continue
  if grep -q '"version"' "$f"; then
    sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$f"
  fi
done

# Update tauri.conf.json
TAURI_CONF="$ROOT/apps/desktop/src-tauri/tauri.conf.json"
if [ -f "$TAURI_CONF" ]; then
  sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$TAURI_CONF"
fi

# Update Cargo.toml for daemon
DAEMON_TOML="$ROOT/crates/daemon/Cargo.toml"
if [ -f "$DAEMON_TOML" ]; then
  sed -i '' "s/^version = \"[^\"]*\"/version = \"$VERSION\"/" "$DAEMON_TOML"
fi
