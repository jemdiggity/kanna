#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/build-sidecars.sh"
TMPDIR_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

FIXTURE_REPO="$TMPDIR_ROOT/repo"
FIXTURE_SCRIPT="$FIXTURE_REPO/scripts/build-sidecars.sh"
FIXTURE_STAGE_SCRIPT="$FIXTURE_REPO/scripts/stage-sidecars.sh"
FAKE_BIN="$TMPDIR_ROOT/bin"
CARGO_LOG="$TMPDIR_ROOT/cargo.log"
STAGE_LOG="$TMPDIR_ROOT/stage.log"

mkdir -p "$FIXTURE_REPO/scripts" "$FAKE_BIN"
cp "$SCRIPT" "$FIXTURE_SCRIPT"
chmod +x "$FIXTURE_SCRIPT"

cat > "$FIXTURE_STAGE_SCRIPT" <<'EOF'
#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >> "$STAGE_LOG"
EOF
chmod +x "$FIXTURE_STAGE_SCRIPT"

cat > "$FAKE_BIN/cargo" <<'EOF'
#!/bin/bash
set -euo pipefail

manifest=""
target=""
profile="debug"

while [ $# -gt 0 ]; do
  case "$1" in
    --manifest-path)
      manifest="$2"
      shift 2
      ;;
    --target)
      target="$2"
      shift 2
      ;;
    --release)
      profile="release"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

printf 'manifest=%s target=%s profile=%s target_dir=%s\n' \
  "$manifest" "$target" "$profile" "$CARGO_TARGET_DIR" >> "$CARGO_LOG"

case "$manifest" in
  *crates/daemon/Cargo.toml) bin="kanna-daemon" ;;
  *crates/kanna-cli/Cargo.toml) bin="kanna-cli" ;;
  *crates/kanna-server/Cargo.toml) bin="kanna-server" ;;
  *packages/terminal-recovery/Cargo.toml) bin="kanna-terminal-recovery" ;;
  *)
    printf 'unexpected manifest: %s\n' "$manifest" >&2
    exit 1
    ;;
esac

mkdir -p "$CARGO_TARGET_DIR/$target/$profile"
printf '%s\n' "$bin" > "$CARGO_TARGET_DIR/$target/$profile/$bin"
EOF
chmod +x "$FAKE_BIN/cargo"

OUTPUT="$(
  cd "$FIXTURE_REPO"
  env \
    PATH="$FAKE_BIN:/usr/bin:/bin:/sbin" \
    CARGO_LOG="$CARGO_LOG" \
    STAGE_LOG="$STAGE_LOG" \
    CARGO_TARGET_DIR="$TMPDIR_ROOT/shared-target" \
    bash "$FIXTURE_SCRIPT" --target aarch64-apple-darwin --release
)"

if ! grep -Fq "Built sidecars in" <<<"$OUTPUT"; then
  printf 'expected build output, got:\n%s\n' "$OUTPUT" >&2
  exit 1
fi

EXPECTED_TARGET_DIR="$FIXTURE_REPO/.build/sidecar-target"
for bin in kanna-daemon kanna-cli kanna-server kanna-terminal-recovery; do
  if ! grep -Fq "target_dir=$EXPECTED_TARGET_DIR" "$CARGO_LOG"; then
    printf 'expected cargo to build into %s, got:\n' "$EXPECTED_TARGET_DIR" >&2
    cat "$CARGO_LOG" >&2
    exit 1
  fi
done

if grep -Fq "$TMPDIR_ROOT/shared-target" "$CARGO_LOG"; then
  printf 'expected build-sidecars to ignore inherited shared CARGO_TARGET_DIR, got:\n' >&2
  cat "$CARGO_LOG" >&2
  exit 1
fi

if ! grep -Fq -- "--build-dir $EXPECTED_TARGET_DIR --target aarch64-apple-darwin --release" "$STAGE_LOG"; then
  printf 'expected stage-sidecars to receive the isolated build dir, got:\n' >&2
  cat "$STAGE_LOG" >&2
  exit 1
fi

printf 'ok\n'
