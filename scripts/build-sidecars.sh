#!/bin/bash
# Build desktop sidecars into a repo-local target dir, then stage them for Tauri.
#
# Usage:
#   ./scripts/build-sidecars.sh
#   ./scripts/build-sidecars.sh --release --target aarch64-apple-darwin
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR_TARGET_DIR="$ROOT/.build/sidecar-target"
TARGET=""
PROFILE="debug"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --release)
            PROFILE="release"
            shift
            ;;
        --target)
            TARGET="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

if [[ -z "$TARGET" ]]; then
    TARGET="$(rustc -vV | awk '/^host:/ {print $2}')"
fi

build_args=(--target "$TARGET")
if [[ "$PROFILE" = "release" ]]; then
    build_args+=(--release)
fi

build_sidecar() {
    local manifest="$1"

    CARGO_TARGET_DIR="$SIDECAR_TARGET_DIR" cargo build \
        --manifest-path "$manifest" \
        "${build_args[@]}"
}

build_sidecar "$ROOT/crates/daemon/Cargo.toml"
build_sidecar "$ROOT/crates/kanna-cli/Cargo.toml"
build_sidecar "$ROOT/crates/kanna-server/Cargo.toml"
build_sidecar "$ROOT/packages/terminal-recovery/Cargo.toml"

stage_args=(--build-dir "$SIDECAR_TARGET_DIR" --target "$TARGET")
if [[ "$PROFILE" = "release" ]]; then
    stage_args+=(--release)
fi

"$ROOT/scripts/stage-sidecars.sh" "${stage_args[@]}"

echo "Built sidecars in $SIDECAR_TARGET_DIR for $TARGET ($PROFILE)"
