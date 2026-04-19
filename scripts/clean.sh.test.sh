#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMPDIR_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

WORKSPACE="$TMPDIR_ROOT/workspace"
TEST_HOME="$TMPDIR_ROOT/home"
mkdir -p "$WORKSPACE/.build" "$WORKSPACE/apps/desktop/src-tauri/target" "$WORKSPACE/scripts"
cp "$ROOT_DIR/scripts/clean.sh" "$WORKSPACE/scripts/clean.sh"
SCRIPT="$WORKSPACE/scripts/clean.sh"

USER_NAME="${USER:-$(id -un)}"
OUTPUT_BASE_HASH="$(printf %s "$WORKSPACE" | md5)"
BAZEL_OUTPUT_BASE="$TEST_HOME/Library/Caches/bazel/_bazel_${USER_NAME}/${OUTPUT_BASE_HASH}"
mkdir -p "$BAZEL_OUTPUT_BASE/execroot/_main/bazel-out"
printf 'artifact\n' > "$BAZEL_OUTPUT_BASE/execroot/_main/bazel-out/fake.txt"

SHARED_DISK_CACHE="$TEST_HOME/Library/Caches/kanna-bazel/disk-cache"
SHARED_REPO_CACHE="$TEST_HOME/Library/Caches/kanna-bazel/repository-cache"
SHARED_RUST_BUILD_CACHE="$TEST_HOME/Library/Caches/kanna/rust-build"
mkdir -p "$SHARED_DISK_CACHE" "$SHARED_REPO_CACHE"
mkdir -p "$SHARED_RUST_BUILD_CACHE"
printf 'keep\n' > "$SHARED_DISK_CACHE/keep.txt"
printf 'keep\n' > "$SHARED_REPO_CACHE/keep.txt"
printf 'keep\n' > "$SHARED_RUST_BUILD_CACHE/keep.txt"

run_clean() {
  local cwd="$1"
  shift
  (
    cd "$cwd"
    HOME="$TEST_HOME" USER="$USER_NAME" bash "$SCRIPT" "$@"
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

if [ ! -f "$SHARED_RUST_BUILD_CACHE/keep.txt" ]; then
  printf 'expected shared rust build cache to remain intact\n' >&2
  exit 1
fi

DRY_SHARED_OUTPUT="$(run_clean "$WORKSPACE" --dry --shared-rust-build)"
if [[ "$DRY_SHARED_OUTPUT" != *"$SHARED_RUST_BUILD_CACHE"* ]]; then
  printf 'expected --dry --shared-rust-build output to mention shared rust build cache, got:\n%s\n' "$DRY_SHARED_OUTPUT" >&2
  exit 1
fi

if [ ! -f "$SHARED_RUST_BUILD_CACHE/keep.txt" ]; then
  printf 'expected dry shared rust build clean to leave cache intact\n' >&2
  exit 1
fi

run_clean "$WORKSPACE" --shared-rust-build

if [ -e "$SHARED_RUST_BUILD_CACHE" ]; then
  printf 'expected --shared-rust-build to remove shared rust build cache\n' >&2
  exit 1
fi
