#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/stage-sidecars.sh"
TMPDIR_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

FIXTURE_REPO="$TMPDIR_ROOT/repo"
FIXTURE_SCRIPT="$FIXTURE_REPO/scripts/stage-sidecars.sh"
BUILD_DIR="$FIXTURE_REPO/.build"
BINARIES_DIR="$FIXTURE_REPO/apps/desktop/src-tauri/binaries"
HOST_TARGET="$(rustc -vV | awk '/^host:/ {print $2}')"

mkdir -p "$FIXTURE_REPO/scripts" "$BINARIES_DIR" "$BUILD_DIR/$HOST_TARGET/debug"
cp "$SCRIPT" "$FIXTURE_SCRIPT"
chmod +x "$FIXTURE_SCRIPT"

for bin in kanna-daemon kanna-cli kanna-terminal-recovery kanna-server kanna-task-transfer; do
  printf 'fixture-%s\n' "$bin" > "$BUILD_DIR/$HOST_TARGET/debug/$bin"
  chmod +x "$BUILD_DIR/$HOST_TARGET/debug/$bin"
done

OUTPUT="$(
  cd "$FIXTURE_REPO"
  CARGO_TARGET_DIR="$TMPDIR_ROOT/shared-target" \
    bash "$FIXTURE_SCRIPT"
)"

if ! grep -Fq "Staged sidecars for" <<<"$OUTPUT"; then
  printf 'expected staging output, got:\n%s\n' "$OUTPUT" >&2
  exit 1
fi

for bin in kanna-daemon kanna-cli kanna-terminal-recovery kanna-server kanna-task-transfer; do
  if ! compgen -G "$BINARIES_DIR/${bin}-*" >/dev/null; then
    printf 'expected staged binary for %s\n' "$bin" >&2
    exit 1
  fi
done

printf 'ok\n'
