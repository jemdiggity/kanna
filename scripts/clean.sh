#!/bin/bash
# Clean Tauri/Rust/Bazel build artifacts to reclaim disk space.
#
# Usage:
#   ./scripts/clean.sh          # clean Rust target dirs + local Bazel output
#   ./scripts/clean.sh --all    # also remove node_modules, dist, .turbo
#   ./scripts/clean.sh --dry    # show what would be removed and sizes
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

ALL=false
DRY=false

for arg in "$@"; do
  case "$arg" in
    --all) ALL=true ;;
    --dry) DRY=true ;;
    -h|--help)
      sed -n '2,6p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
  esac
done

cleaned=0

remove() {
  local path="$1"
  if [ -e "$path" ]; then
    local size
    size="$(du -sh "$path" 2>/dev/null | cut -f1)"
    if $DRY; then
      echo "[dry run] would remove $path ($size)"
    else
      echo "removing $path ($size)"
      rm -rf "$path"
    fi
    cleaned=1
  fi
}

bazel_output_base() {
  local user_name hash

  if ! command -v md5 >/dev/null 2>&1; then
    echo "error: md5 is required to derive the Bazel output base" >&2
    exit 1
  fi

  user_name="${USER:-$(id -un)}"
  hash="$(printf %s "$ROOT" | md5)"
  printf '%s/Library/Caches/bazel/_bazel_%s/%s\n' "$HOME" "$user_name" "$hash"
}

# Rust final build outputs (.cargo/config.toml sets target-dir = ".build").
# Shared Cargo intermediates under ~/Library/Caches/kanna/rust-build are kept.
remove "$ROOT/.build"
# Tauri CLI runs cargo from apps/desktop/src-tauri/, which uses default target dir
remove "$ROOT/apps/desktop/src-tauri/target"
# Bazel local output base for this workspace only
remove "$(bazel_output_base)"

if $ALL; then
  # Frontend build output
  remove "$ROOT/apps/desktop/dist"

  # Node modules
  remove "$ROOT/node_modules"
  remove "$ROOT/apps/desktop/node_modules"
  remove "$ROOT/packages/core/node_modules"
  remove "$ROOT/packages/db/node_modules"

  # Turbo cache
  remove "$ROOT/.turbo"
fi

if [ "$cleaned" -eq 0 ]; then
  echo "nothing to clean"
elif $DRY; then
  echo ""
  echo "run without --dry to remove"
fi
