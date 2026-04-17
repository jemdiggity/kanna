#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMPDIR_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

WORKSPACE="$TMPDIR_ROOT/workspace"
mkdir -p "$WORKSPACE/.build" "$WORKSPACE/apps/desktop/src-tauri/target" "$WORKSPACE/scripts"
cp "$ROOT_DIR/scripts/clean.sh" "$WORKSPACE/scripts/clean.sh"
SCRIPT="$WORKSPACE/scripts/clean.sh"

USER_NAME="${USER:-$(id -un)}"
OUTPUT_BASE_HASH="$(printf %s "$WORKSPACE" | md5)"
BAZEL_OUTPUT_BASE="$HOME/Library/Caches/bazel/_bazel_${USER_NAME}/${OUTPUT_BASE_HASH}"
mkdir -p "$BAZEL_OUTPUT_BASE/execroot/_main/bazel-out"
printf 'artifact\n' > "$BAZEL_OUTPUT_BASE/execroot/_main/bazel-out/fake.txt"

SHARED_DISK_CACHE="$HOME/Library/Caches/kanna-bazel/disk-cache"
SHARED_REPO_CACHE="$HOME/Library/Caches/kanna-bazel/repository-cache"
mkdir -p "$SHARED_DISK_CACHE" "$SHARED_REPO_CACHE"
printf 'keep\n' > "$SHARED_DISK_CACHE/keep.txt"
printf 'keep\n' > "$SHARED_REPO_CACHE/keep.txt"

run_clean() {
  local cwd="$1"
  shift
  (
    cd "$cwd"
    bash "$SCRIPT" "$@"
  )
}

DRY_OUTPUT="$(run_clean "$WORKSPACE" --dry)"
if [[ "$DRY_OUTPUT" != *"$BAZEL_OUTPUT_BASE"* ]]; then
  printf 'expected --dry output to mention bazel output base, got:\n%s\n' "$DRY_OUTPUT" >&2
  exit 1
fi

if [ ! -d "$BAZEL_OUTPUT_BASE" ]; then
  printf 'expected --dry run to leave bazel output base intact\n' >&2
  exit 1
fi

run_clean "$WORKSPACE"

if [ -d "$BAZEL_OUTPUT_BASE" ]; then
  printf 'expected default clean to remove bazel output base: %s\n' "$BAZEL_OUTPUT_BASE" >&2
  exit 1
fi

if [ -d "$WORKSPACE/.build" ]; then
  printf 'expected clean to remove .build\n' >&2
  exit 1
fi

if [ -d "$WORKSPACE/apps/desktop/src-tauri/target" ]; then
  printf 'expected clean to remove src-tauri target\n' >&2
  exit 1
fi

if [ ! -f "$SHARED_DISK_CACHE/keep.txt" ]; then
  printf 'expected shared bazel disk cache to remain intact\n' >&2
  exit 1
fi

if [ ! -f "$SHARED_REPO_CACHE/keep.txt" ]; then
  printf 'expected shared bazel repository cache to remain intact\n' >&2
  exit 1
fi
