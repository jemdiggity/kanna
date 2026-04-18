#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/dev.sh"
MOBILE_SCRIPT="$ROOT_DIR/scripts/mobile-dev.sh"
TMPDIR_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

TEST_ROOT="$TMPDIR_ROOT/.kanna-worktrees/v0.0.30"
FAKE_BIN="$TMPDIR_ROOT/bin"
TMUX_STATE="$TMPDIR_ROOT/tmux-state"
TMUX_LOG="$TMPDIR_ROOT/tmux-log"
SQLITE_LOG="$TMPDIR_ROOT/sqlite-log"
mkdir -p "$TEST_ROOT/apps/desktop/src-tauri" "$TEST_ROOT/apps/desktop/tests/e2e" "$TEST_ROOT/apps/desktop" "$FAKE_BIN"
mkdir -p "$TEST_ROOT/apps/mobile" "$TEST_ROOT/services/relay/node_modules"
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
    printf '%s %s\n' "\$cmd" "\$*" >> "\$log_file"
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
  send-keys|capture-pane|new-window|kill-session|list-windows|attach|set-option)
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
      -u KANNA_APPIUM_PORT \
      -u KANNA_MOBILE_PORT \
      -u KANNA_MOBILE_SERVER_HOST \
      -u KANNA_MOBILE_SERVER_URL \
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

run_mobile_dev_sh() {
  set +e
  local output
  output="$(
    PATH="$FAKE_BIN:/usr/bin:/bin" \
    HOME="$TMPDIR_ROOT/home" \
    env \
      -u KANNA_DB_PATH \
      -u KANNA_DB_NAME \
      -u KANNA_DAEMON_DIR \
      -u KANNA_APPIUM_PORT \
      -u KANNA_MOBILE_PORT \
      -u KANNA_MOBILE_SERVER_HOST \
      -u KANNA_MOBILE_SERVER_URL \
      KANNA_WORKTREE=1 \
      KANNA_DEV_PORT=1452 \
      HOME="$TMPDIR_ROOT/home" \
      "$@" \
      bash "$MOBILE_SCRIPT" 2>&1
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

if ! grep -Fq "new-session -d" "$TMUX_LOG" || ! grep -Fq -- "-s kanna-v0_0_30" "$TMUX_LOG"; then
  printf 'expected new-session to target sanitized tmux session, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

if ! grep -Fq "KANNA_DB_PATH=$TMPDIR_ROOT/home/Library/Application Support/build.kanna/kanna-wt-v0.0.30.db" "$TMUX_LOG"; then
  printf 'expected default worktree db path in tmux command, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

if ! grep -Fq "KANNA_DB_NAME=kanna-wt-v0.0.30.db" "$TMUX_LOG"; then
  printf 'expected default worktree db name in tmux command, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

if ! grep -Fq "KANNA_DAEMON_DIR=$TEST_ROOT/.kanna-daemon" "$TMUX_LOG"; then
  printf 'expected default worktree daemon dir in tmux command, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

for leaked in KANNA_TASK_ID= KANNA_CLI_DB_PATH= KANNA_SOCKET_PATH= KANNA_CLI_PATH=; do
  if grep -Fq "$leaked" "$TMUX_LOG"; then
    printf 'expected tmux launch env to omit leaked task-local var %s, got:\n' "$leaked" >&2
    cat "$TMUX_LOG" >&2
    exit 1
  fi
done

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

if ! grep -Fq "KANNA_DB_PATH=$TMPDIR_ROOT/home/Library/Application Support/build.kanna/kanna-wt-v0.0.30.db" "$TMUX_LOG"; then
  printf 'expected inherited KANNA_DB_NAME to be ignored, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

if ! grep -Fq "KANNA_DB_NAME=kanna-wt-v0.0.30.db" "$TMUX_LOG"; then
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

if ! grep -Fq "KANNA_DAEMON_DIR=$TEST_ROOT/.kanna-daemon" "$TMUX_LOG"; then
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
  printf 'expected seed to ignore inherited KANNA_DB_NAME in worktrees, got:\n' >&2
  cat "$SQLITE_LOG" >&2
  exit 1
fi

rm -f "$TMUX_STATE" "$TMUX_LOG"
: > "$TMUX_STATE"
: > "$TMUX_LOG"

RESULT="$(run_dev_sh --mobile env KANNA_RELAY_PORT=9087 KANNA_MOBILE_PORT=1437 KANNA_MOBILE_SERVER_HOST=127.0.0.1)"
OUTPUT="${RESULT%===STATUS:*===}"
STATUS="${RESULT##*===STATUS:}"
STATUS="${STATUS%===}"

if [ "$STATUS" -ne 0 ]; then
  printf 'expected dev.sh --mobile to start the Expo app alongside desktop dev, got:\n' >&2
  printf '%s\n' "$OUTPUT" >&2
  exit 1
fi

if ! grep -Fq "new-window -t kanna-v0_0_30 -n mobile -c $TEST_ROOT/apps/mobile EXPO_PUBLIC_KANNA_SERVER_URL=http://127.0.0.1:48120 pnpm run dev -- --port 1437" "$TMUX_LOG"; then
  printf 'expected dev.sh --mobile to launch Expo in the mobile window, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

if ! grep -Fq "EXPO_PUBLIC_KANNA_SERVER_URL=http://127.0.0.1:48120" "$TMUX_LOG"; then
  printf 'expected dev.sh --mobile to inject the Expo server URL, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

rm -f "$TMUX_STATE" "$TMUX_LOG"
: > "$TMUX_STATE"
: > "$TMUX_LOG"

RESULT="$(run_dev_sh --mobile env KANNA_MOBILE_SERVER_HOST=127.0.0.1)"
OUTPUT="${RESULT%===STATUS:*===}"
STATUS="${RESULT##*===STATUS:}"
STATUS="${STATUS%===}"

if [ "$STATUS" -ne 0 ]; then
  printf 'expected dev.sh --mobile to use the default Expo port, got:\n' >&2
  printf '%s\n' "$OUTPUT" >&2
  exit 1
fi

if ! grep -Fq "new-window -t kanna-v0_0_30 -n mobile -c $TEST_ROOT/apps/mobile EXPO_PUBLIC_KANNA_SERVER_URL=http://127.0.0.1:48120 pnpm run dev -- --port 8081" "$TMUX_LOG"; then
  printf 'expected dev.sh --mobile to default to port 8081 for Expo, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

rm -f "$TMUX_STATE" "$TMUX_LOG"
: > "$TMUX_STATE"
: > "$TMUX_LOG"

RESULT="$(run_dev_sh --mobile env KANNA_MOBILE_SERVER_URL=http://desktop.lan:48120)"
OUTPUT="${RESULT%===STATUS:*===}"
STATUS="${RESULT##*===STATUS:}"
STATUS="${STATUS%===}"

if [ "$STATUS" -ne 0 ]; then
  printf 'expected dev.sh --mobile to honor explicit server URL override, got:\n' >&2
  printf '%s\n' "$OUTPUT" >&2
  exit 1
fi

if ! grep -Fq "EXPO_PUBLIC_KANNA_SERVER_URL=http://desktop.lan:48120" "$TMUX_LOG"; then
  printf 'expected dev.sh --mobile to pass the explicit server URL override to Expo, got:\n' >&2
  cat "$TMUX_LOG" >&2
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

if ! grep -Fq "KANNA_DB_PATH=$TMPDIR_ROOT/home/Library/Application Support/build.kanna/kanna-wt-v0.0.30.db" "$TMUX_LOG"; then
  printf 'expected inherited KANNA_DB_PATH to be ignored, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

if ! grep -Fq "KANNA_DB_NAME=kanna-wt-v0.0.30.db" "$TMUX_LOG"; then
  printf 'expected KANNA_DB_NAME to remain worktree-derived, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

rm -f "$TMUX_STATE" "$TMUX_LOG"
: > "$TMUX_STATE"
: > "$TMUX_LOG"

RESULT="$(run_dev_sh start env KANNA_APPIUM_PORT=4780)"
OUTPUT="${RESULT%===STATUS:*===}"
STATUS="${RESULT##*===STATUS:}"
STATUS="${STATUS%===}"

if [ "$STATUS" -ne 0 ]; then
  printf 'dev.sh with KANNA_APPIUM_PORT exited with status %s\n' "$STATUS" >&2
  printf '%s\n' "$OUTPUT" >&2
  exit 1
fi

if ! grep -Fq "KANNA_APPIUM_PORT=4780" "$TMUX_LOG"; then
  printf 'expected KANNA_APPIUM_PORT to be propagated into tmux, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

rm -f "$TMUX_STATE" "$TMUX_LOG"
: > "$TMUX_STATE"
: > "$TMUX_LOG"

RESULT="$(run_mobile_dev_sh env KANNA_MOBILE_PORT=1555 KANNA_MOBILE_SERVER_HOST=127.0.0.1)"
OUTPUT="${RESULT%===STATUS:*===}"
STATUS="${RESULT##*===STATUS:}"
STATUS="${STATUS%===}"

if [ "$STATUS" -ne 0 ]; then
  printf 'mobile-dev.sh exited with status %s\n' "$STATUS" >&2
  printf '%s\n' "$OUTPUT" >&2
  exit 1
fi

if ! grep -Fq "new-window -t kanna-v0_0_30 -n mobile -c $TEST_ROOT/apps/mobile EXPO_PUBLIC_KANNA_SERVER_URL=http://127.0.0.1:48120 pnpm run dev -- --port 1555" "$TMUX_LOG"; then
  printf 'expected mobile-dev.sh to delegate to the Expo mobile workflow, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

printf 'ok\n'
