#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/dev.sh"
TMPDIR_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

TEST_ROOT="$TMPDIR_ROOT/.kanna-worktrees/v0.0.30"
FAKE_BIN="$TMPDIR_ROOT/bin"
TMUX_STATE="$TMPDIR_ROOT/tmux-state"
TMUX_LOG="$TMPDIR_ROOT/tmux-log"
SQLITE_LOG="$TMPDIR_ROOT/sqlite-log"
mkdir -p "$TEST_ROOT/apps/desktop/src-tauri" "$TEST_ROOT/apps/desktop/tests/e2e" "$TEST_ROOT/apps/desktop" "$FAKE_BIN"
: > "$TMUX_STATE"
: > "$TMUX_LOG"
: > "$SQLITE_LOG"
printf '%s\n' '-- seed fixture' > "$TEST_ROOT/apps/desktop/tests/e2e/seed.sql"

cat > "$FAKE_BIN/git" <<EOF
#!/bin/bash
set -euo pipefail
case "\$*" in
  "rev-parse --show-toplevel")
    printf '%s\n' "$TEST_ROOT"
    ;;
  "rev-parse --abbrev-ref HEAD")
    printf 'HEAD\n'
    ;;
  "rev-parse --short HEAD")
    printf 'deadbeef\n'
    ;;
  *)
    printf 'unexpected fake git invocation: %s\n' "\$*" >&2
    exit 1
    ;;
esac
EOF

cat > "$FAKE_BIN/tmux" <<EOF
#!/bin/bash
set -euo pipefail

state_file="$TMUX_STATE"
log_file="$TMUX_LOG"

normalize() {
  printf '%s' "\$1" | tr '.' '_'
}

session_exists() {
  grep -Fxq "\$1" "\$state_file"
}

cmd="\$1"
shift || true

case "\$cmd" in
  has-session)
    target=""
    while [ \$# -gt 0 ]; do
      case "\$1" in
        -t)
          target="\$2"
          shift 2
          ;;
        *)
          shift
          ;;
      esac
    done
    if session_exists "\$target"; then
      exit 0
    fi
    exit 1
    ;;
  new-session)
    session=""
    while [ \$# -gt 0 ]; do
      case "\$1" in
        -s)
          session="\$2"
          shift 2
          ;;
        *)
          shift
          ;;
      esac
    done
    normalized_session="\$(normalize "\$session")"
    if session_exists "\$normalized_session"; then
      printf 'duplicate session: %s\n' "\$normalized_session" >&2
      exit 1
    fi
    printf '%s\n' "\$normalized_session" >> "\$state_file"
    ;;
  send-keys|capture-pane|new-window|kill-session|list-windows|attach)
    printf '%s %s\n' "\$cmd" "\$*" >> "\$log_file"
    target=""
    while [ \$# -gt 0 ]; do
      case "\$1" in
        -t)
          target="\$2"
          shift 2
          ;;
        *)
          shift
          ;;
      esac
    done
    if [ -n "\$target" ]; then
      target_session="\${target%%:*}"
      if ! session_exists "\$target_session"; then
        printf "can't find session: %s\n" "\$target_session" >&2
        exit 1
      fi
    fi
    ;;
  *)
    printf 'unexpected fake tmux invocation: %s %s\n' "\$cmd" "\$*" >&2
    exit 1
    ;;
esac
EOF

cat > "$FAKE_BIN/sqlite3" <<EOF
#!/bin/bash
set -euo pipefail
printf '%s\n' "\$1" >> "$SQLITE_LOG"
cat >/dev/null
EOF

chmod +x "$FAKE_BIN/git" "$FAKE_BIN/tmux" "$FAKE_BIN/sqlite3"

run_dev_sh() {
  local cmd="$1"
  shift || true
  set +e
  local output
  output="$(
    PATH="$FAKE_BIN:/usr/bin:/bin" \
    HOME="$TMPDIR_ROOT/home" \
    env \
      -u KANNA_DB_PATH \
      -u KANNA_DB_NAME \
      -u KANNA_DAEMON_DIR \
      KANNA_WORKTREE=1 \
      KANNA_DEV_PORT=1452 \
      HOME="$TMPDIR_ROOT/home" \
      "$@" \
      bash "$SCRIPT" "$cmd" 2>&1
  )"
  local status=$?
  set -e
  printf '%s\n===STATUS:%s===\n' "$output" "$status"
}

RESULT="$(run_dev_sh start)"
OUTPUT="${RESULT%===STATUS:*===}"
STATUS="${RESULT##*===STATUS:}"
STATUS="${STATUS%===}"

if [ "$STATUS" -ne 0 ]; then
  printf 'dev.sh exited with status %s\n' "$STATUS" >&2
  printf '%s\n' "$OUTPUT" >&2
  exit 1
fi

if ! grep -Fq "Started tmux session 'kanna-v0_0_30'" <<<"$OUTPUT"; then
  printf 'expected sanitized session name in output, got:\n%s\n' "$OUTPUT" >&2
  exit 1
fi

if ! grep -Fq "send-keys -t kanna-v0_0_30:desktop" "$TMUX_LOG"; then
  printf 'expected send-keys to target sanitized tmux session, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

if ! grep -Fq "KANNA_DB_PATH='$TMPDIR_ROOT/home/Library/Application Support/build.kanna/kanna-wt-v0.0.30.db'" "$TMUX_LOG"; then
  printf 'expected default worktree db path in tmux command, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

if ! grep -Fq "KANNA_DB_NAME='kanna-wt-v0.0.30.db'" "$TMUX_LOG"; then
  printf 'expected default worktree db name in tmux command, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

if ! grep -Fq "KANNA_DAEMON_DIR='$TEST_ROOT/.kanna-daemon'" "$TMUX_LOG"; then
  printf 'expected default worktree daemon dir in tmux command, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

rm -f "$TMUX_STATE" "$TMUX_LOG"
: > "$TMUX_STATE"
: > "$TMUX_LOG"

RESULT="$(run_dev_sh restart)"
OUTPUT="${RESULT%===STATUS:*===}"
STATUS="${RESULT##*===STATUS:}"
STATUS="${STATUS%===}"

if [ "$STATUS" -ne 0 ]; then
  printf 'dev.sh restart exited with status %s\n' "$STATUS" >&2
  printf '%s\n' "$OUTPUT" >&2
  exit 1
fi

if ! grep -Fq "Started tmux session 'kanna-v0_0_30'" <<<"$OUTPUT"; then
  printf 'expected restart to start sanitized tmux session, got:\n%s\n' "$OUTPUT" >&2
  exit 1
fi

rm -f "$TMUX_STATE" "$TMUX_LOG"
: > "$TMUX_STATE"
: > "$TMUX_LOG"

RESULT="$(run_dev_sh start env KANNA_DB_NAME=shared.db)"
OUTPUT="${RESULT%===STATUS:*===}"
STATUS="${RESULT##*===STATUS:}"
STATUS="${STATUS%===}"

if [ "$STATUS" -ne 0 ]; then
  printf 'dev.sh with KANNA_DB_NAME exited with status %s\n' "$STATUS" >&2
  printf '%s\n' "$OUTPUT" >&2
  exit 1
fi

if ! grep -Fq "KANNA_DB_PATH='$TMPDIR_ROOT/home/Library/Application Support/build.kanna/kanna-wt-v0.0.30.db'" "$TMUX_LOG"; then
  printf 'expected inherited KANNA_DB_NAME to be ignored, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

if ! grep -Fq "KANNA_DB_NAME='kanna-wt-v0.0.30.db'" "$TMUX_LOG"; then
  printf 'expected derived worktree KANNA_DB_NAME to remain canonical, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

rm -f "$TMUX_STATE" "$TMUX_LOG"
: > "$TMUX_STATE"
: > "$TMUX_LOG"

RESULT="$(run_dev_sh start env KANNA_DAEMON_DIR=/tmp/shared-daemon-dir)"
OUTPUT="${RESULT%===STATUS:*===}"
STATUS="${RESULT##*===STATUS:}"
STATUS="${STATUS%===}"

if [ "$STATUS" -ne 0 ]; then
  printf 'dev.sh with KANNA_DAEMON_DIR exited with status %s\n' "$STATUS" >&2
  printf '%s\n' "$OUTPUT" >&2
  exit 1
fi

if ! grep -Fq "KANNA_DAEMON_DIR='$TEST_ROOT/.kanna-daemon'" "$TMUX_LOG"; then
  printf 'expected inherited KANNA_DAEMON_DIR to be ignored, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

: > "$SQLITE_LOG"
RESULT="$(run_dev_sh seed env KANNA_DB_NAME=shared.db)"
OUTPUT="${RESULT%===STATUS:*===}"
STATUS="${RESULT##*===STATUS:}"
STATUS="${STATUS%===}"

if [ "$STATUS" -ne 0 ]; then
  printf 'dev.sh seed with KANNA_DB_NAME exited with status %s\n' "$STATUS" >&2
  printf '%s\n' "$OUTPUT" >&2
  exit 1
fi

if ! grep -Fxq "$TMPDIR_ROOT/home/Library/Application Support/build.kanna/kanna-wt-v0.0.30.db" "$SQLITE_LOG"; then
  printf 'expected seed to ignore explicit KANNA_DB_NAME, got:\n' >&2
  cat "$SQLITE_LOG" >&2
  exit 1
fi

rm -f "$TMUX_STATE" "$TMUX_LOG"
: > "$TMUX_STATE"
: > "$TMUX_LOG"

RESULT="$(run_dev_sh start env KANNA_DB_PATH=/tmp/shared-kanna.db)"
OUTPUT="${RESULT%===STATUS:*===}"
STATUS="${RESULT##*===STATUS:}"
STATUS="${STATUS%===}"

if [ "$STATUS" -ne 0 ]; then
  printf 'dev.sh with KANNA_DB_PATH exited with status %s\n' "$STATUS" >&2
  printf '%s\n' "$OUTPUT" >&2
  exit 1
fi

if ! grep -Fq "KANNA_DB_PATH='$TMPDIR_ROOT/home/Library/Application Support/build.kanna/kanna-wt-v0.0.30.db'" "$TMUX_LOG"; then
  printf 'expected inherited KANNA_DB_PATH to be ignored, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

if ! grep -Fq "KANNA_DB_NAME='kanna-wt-v0.0.30.db'" "$TMUX_LOG"; then
  printf 'expected KANNA_DB_NAME to remain worktree-derived, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

printf 'ok\n'
