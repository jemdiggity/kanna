#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/dev.sh"
MOBILE_SCRIPT="$ROOT_DIR/scripts/mobile-dev.sh"
TMPDIR_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

REPO_ONE_ROOT="$TMPDIR_ROOT/repo-one"
WORKTREE_ONE="$REPO_ONE_ROOT/.kanna-worktrees/v0.0.30"
WORKTREE_TWO="$REPO_ONE_ROOT/.kanna-worktrees/v0.0.31"
REPO_TWO_ROOT="$TMPDIR_ROOT/repo-two"
WORKTREE_THREE="$REPO_TWO_ROOT/.kanna-worktrees/v0.0.32"
ROOT_CHECKOUT="$TMPDIR_ROOT/root-checkout"

FAKE_BIN="$TMPDIR_ROOT/bin"
TMUX_STATE="$TMPDIR_ROOT/tmux-state"
TMUX_LOG="$TMPDIR_ROOT/tmux-log"
SQLITE_LOG="$TMPDIR_ROOT/sqlite-log"

mkdir -p "$FAKE_BIN"
: > "$TMUX_STATE"
: > "$TMUX_LOG"
: > "$SQLITE_LOG"

setup_worktree_fixture() {
  local worktree_root="$1"
  mkdir -p \
    "$worktree_root/apps/desktop/src-tauri" \
    "$worktree_root/apps/desktop/tests/e2e" \
    "$worktree_root/apps/desktop" \
    "$worktree_root/apps/mobile"
  printf '%s\n' '-- seed fixture' > "$worktree_root/apps/desktop/tests/e2e/seed.sql"
}

setup_worktree_fixture "$WORKTREE_ONE"
setup_worktree_fixture "$WORKTREE_TWO"
setup_worktree_fixture "$WORKTREE_THREE"
setup_worktree_fixture "$ROOT_CHECKOUT"
mkdir -p "$REPO_ONE_ROOT/.git" "$REPO_TWO_ROOT/.git" "$ROOT_CHECKOUT/.git"

cat > "$FAKE_BIN/git" <<EOF
#!/bin/bash
set -euo pipefail
case "\$*" in
  "rev-parse --show-toplevel")
    printf '%s\n' "\${GIT_FAKE_TOPLEVEL:?}"
    ;;
  "rev-parse --git-common-dir")
    printf '%s\n' "\${GIT_FAKE_COMMON_DIR:?}"
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

session_key() {
  printf '%s|%s' "\$1" "\$2"
}

session_exists() {
  local server="\$1"
  local session="\$2"
  grep -Fxq "\$(session_key "\$server" "\$session")" "\$state_file"
}

server="default"
if [ "\${1:-}" = "-L" ]; then
  server="\$(normalize "\${2:-}")"
  shift 2
fi

cmd="\${1:-}"
shift || true
printf 'server=%s cmd=%s args=%s\n' "\$server" "\$cmd" "\$*" >> "\$log_file"

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
    normalized_target="\$(normalize "\$target")"
    if session_exists "\$server" "\$normalized_target"; then
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
    if session_exists "\$server" "\$normalized_session"; then
      printf 'duplicate session: %s on server %s\n' "\$normalized_session" "\$server" >&2
      exit 1
    fi
    printf '%s\n' "\$(session_key "\$server" "\$normalized_session")" >> "\$state_file"
    ;;
  send-keys|capture-pane|new-window|kill-session|list-windows|attach|set-option)
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
      target_session="\$(normalize "\${target%%:*}")"
      if ! session_exists "\$server" "\$target_session"; then
        printf "can't find session: %s on server %s\n" "\$target_session" "\$server" >&2
        exit 1
      fi
    fi
    if [ "\$cmd" = "list-windows" ]; then
      printf 'desktop\n'
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

reset_logs() {
  rm -f "$TMUX_STATE" "$TMUX_LOG"
  : > "$TMUX_STATE"
  : > "$TMUX_LOG"
}

run_dev_sh() {
  local worktree_root="$1"
  local common_dir="$2"
  local cmd="$3"
  shift 3 || true
  set +e
  local output
  output="$(
    env -i \
      PATH="$FAKE_BIN:/usr/bin:/bin:/sbin" \
      HOME="$TMPDIR_ROOT/home" \
      GIT_FAKE_TOPLEVEL="$worktree_root" \
      GIT_FAKE_COMMON_DIR="$common_dir" \
      KANNA_DEV_PORT=1452 \
      "$@" \
      bash "$SCRIPT" "$cmd" 2>&1
  )"
  local status=$?
  set -e
  printf '%s\n===STATUS:%s===\n' "$output" "$status"
}

run_mobile_dev_sh() {
  local worktree_root="$1"
  local common_dir="$2"
  shift 2 || true
  set +e
  local output
  output="$(
    env -i \
      PATH="$FAKE_BIN:/usr/bin:/bin:/sbin" \
      HOME="$TMPDIR_ROOT/home" \
      GIT_FAKE_TOPLEVEL="$worktree_root" \
      GIT_FAKE_COMMON_DIR="$common_dir" \
      KANNA_DEV_PORT=1452 \
      "$@" \
      bash "$MOBILE_SCRIPT" 2>&1
  )"
  local status=$?
  set -e
  printf '%s\n===STATUS:%s===\n' "$output" "$status"
}

expect_success() {
  local label="$1"
  local result="$2"
  local output="${result%===STATUS:*===}"
  local status="${result##*===STATUS:}"
  status="${status%===}"

  if [ "$status" -ne 0 ]; then
    printf '%s exited with status %s\n' "$label" "$status" >&2
    printf '%s\n' "$output" >&2
    exit 1
  fi

  printf '%s' "$output"
}

shared_build_dir() {
  printf '%s/Library/Caches/kanna/rust-build' "$TMPDIR_ROOT/home"
}

assert_tmux_log_contains() {
  local needle="$1"
  if ! grep -Fq -- "$needle" "$TMUX_LOG"; then
    printf 'expected tmux log to contain %s, got:\n' "$needle" >&2
    cat "$TMUX_LOG" >&2
    exit 1
  fi
}

RESULT="$(run_dev_sh "$WORKTREE_ONE" "$REPO_ONE_ROOT/.git" start)"
OUTPUT="$(expect_success "dev.sh start" "$RESULT")"

if ! grep -Fq "Started tmux session 'kanna-v0_0_30'" <<<"$OUTPUT"; then
  printf 'expected sanitized session name in output, got:\n%s\n' "$OUTPUT" >&2
  exit 1
fi

if ! grep -Fq "Attach with: tmux -L kanna-v0_0_30 attach -t kanna-v0_0_30" <<<"$OUTPUT"; then
  printf 'expected attach command to include tmux server, got:\n%s\n' "$OUTPUT" >&2
  exit 1
fi

assert_tmux_log_contains "server=kanna-v0_0_30 cmd=new-session"
assert_tmux_log_contains "server=kanna-v0_0_30 cmd=set-option"
assert_tmux_log_contains "-s kanna-v0_0_30 -n desktop"
assert_tmux_log_contains "KANNA_DB_PATH=$TMPDIR_ROOT/home/Library/Application Support/build.kanna/kanna-wt-v0.0.30.db"
assert_tmux_log_contains "KANNA_DB_NAME=kanna-wt-v0.0.30.db"
assert_tmux_log_contains "KANNA_DAEMON_DIR=$WORKTREE_ONE/.kanna-daemon"
assert_tmux_log_contains "CARGO_BUILD_BUILD_DIR=$(shared_build_dir)"

if grep -Fq "CARGO_TARGET_DIR=" "$TMUX_LOG"; then
  printf 'expected worktree start not to export shared CARGO_TARGET_DIR, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

if ! grep -Fq "KANNA_TRANSFER_ROOT=$WORKTREE_ONE/.kanna-transfer" "$TMUX_LOG"; then
  printf 'expected default worktree transfer root in tmux command, got:\n' >&2
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

reset_logs
RESULT="$(run_dev_sh "$WORKTREE_ONE" "$REPO_ONE_ROOT/.git" restart)"
OUTPUT="$(expect_success "dev.sh restart" "$RESULT")"

if ! grep -Fq "Started tmux session 'kanna-v0_0_30'" <<<"$OUTPUT"; then
  printf 'expected restart to start sanitized tmux session, got:\n%s\n' "$OUTPUT" >&2
  exit 1
fi

reset_logs
RESULT="$(run_dev_sh "$WORKTREE_TWO" "$REPO_ONE_ROOT/.git" start)"
expect_success "dev.sh second worktree start" "$RESULT" >/dev/null
assert_tmux_log_contains "server=kanna-v0_0_31 cmd=new-session"
assert_tmux_log_contains "CARGO_BUILD_BUILD_DIR=$(shared_build_dir)"

reset_logs
RESULT="$(run_dev_sh "$WORKTREE_THREE" "$REPO_TWO_ROOT/.git" start)"
expect_success "dev.sh different repo start" "$RESULT" >/dev/null
assert_tmux_log_contains "server=kanna-v0_0_32 cmd=new-session"
assert_tmux_log_contains "CARGO_BUILD_BUILD_DIR=$(shared_build_dir)"

reset_logs
RESULT="$(run_dev_sh "$WORKTREE_ONE" "$REPO_ONE_ROOT/.git" start env KANNA_DB_NAME=shared.db)"
expect_success "dev.sh worktree start with inherited KANNA_DB_NAME" "$RESULT" >/dev/null

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

reset_logs
RESULT="$(run_dev_sh "$WORKTREE_ONE" "$REPO_ONE_ROOT/.git" start env KANNA_DAEMON_DIR=/tmp/shared-daemon-dir)"
expect_success "dev.sh with KANNA_DAEMON_DIR" "$RESULT" >/dev/null

if ! grep -Fq "KANNA_DAEMON_DIR=$WORKTREE_ONE/.kanna-daemon" "$TMUX_LOG"; then
  printf 'expected inherited KANNA_DAEMON_DIR to be ignored, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

rm -f "$TMUX_STATE" "$TMUX_LOG"
: > "$TMUX_STATE"
: > "$TMUX_LOG"

RESULT="$(run_dev_sh "$ROOT_CHECKOUT" "$ROOT_CHECKOUT/.git" start env KANNA_DB_NAME=dev-root.db KANNA_TRANSFER_ROOT=/tmp/shared-transfer-root)"
OUTPUT="${RESULT%===STATUS:*===}"
STATUS="${RESULT##*===STATUS:}"
STATUS="${STATUS%===}"

if [ "$STATUS" -ne 0 ]; then
  printf 'dev.sh with KANNA_TRANSFER_ROOT exited with status %s\n' "$STATUS" >&2
  printf '%s\n' "$OUTPUT" >&2
  exit 1
fi

if ! grep -Fq "KANNA_TRANSFER_ROOT=/tmp/shared-transfer-root" "$TMUX_LOG"; then
  printf 'expected inherited KANNA_TRANSFER_ROOT to be forwarded for non-worktree runs, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

rm -f "$TMUX_STATE" "$TMUX_LOG"
: > "$TMUX_STATE"
: > "$TMUX_LOG"

RESULT="$(run_dev_sh "$ROOT_CHECKOUT" "$ROOT_CHECKOUT/.git" start env KANNA_DB_NAME=dev-root.db KANNA_TRANSFER_PORT=4567)"
OUTPUT="${RESULT%===STATUS:*===}"
STATUS="${RESULT##*===STATUS:}"
STATUS="${STATUS%===}"

if [ "$STATUS" -ne 0 ]; then
  printf 'dev.sh with KANNA_TRANSFER_PORT exited with status %s\n' "$STATUS" >&2
  printf '%s\n' "$OUTPUT" >&2
  exit 1
fi

if ! grep -Fq "KANNA_TRANSFER_PORT=4567" "$TMUX_LOG"; then
  printf 'expected inherited KANNA_TRANSFER_PORT to be forwarded to tmux, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

: > "$SQLITE_LOG"
RESULT="$(run_dev_sh "$WORKTREE_ONE" "$REPO_ONE_ROOT/.git" seed env KANNA_DB_NAME=shared.db)"
expect_success "dev.sh seed with KANNA_DB_NAME" "$RESULT" >/dev/null

if ! grep -Fxq "$TMPDIR_ROOT/home/Library/Application Support/build.kanna/kanna-wt-v0.0.30.db" "$SQLITE_LOG"; then
  printf 'expected seed to ignore explicit KANNA_DB_NAME, got:\n' >&2
  cat "$SQLITE_LOG" >&2
  exit 1
fi

reset_logs
RESULT="$(run_dev_sh "$WORKTREE_ONE" "$REPO_ONE_ROOT/.git" --mobile env KANNA_MOBILE_PORT=1437 KANNA_MOBILE_SERVER_HOST=127.0.0.1)"
expect_success "dev.sh --mobile" "$RESULT" >/dev/null

assert_tmux_log_contains "server=kanna-v0_0_30 cmd=new-window args=-t kanna-v0_0_30 -n mobile -c $WORKTREE_ONE/apps/mobile EXPO_PUBLIC_KANNA_SERVER_URL=http://127.0.0.1:48120 pnpm run dev -- --port 1437"
assert_tmux_log_contains "EXPO_PUBLIC_KANNA_SERVER_URL=http://127.0.0.1:48120"

reset_logs
RESULT="$(run_dev_sh "$WORKTREE_ONE" "$REPO_ONE_ROOT/.git" --mobile env KANNA_MOBILE_SERVER_HOST=127.0.0.1)"
expect_success "dev.sh --mobile default port" "$RESULT" >/dev/null

assert_tmux_log_contains "server=kanna-v0_0_30 cmd=new-window args=-t kanna-v0_0_30 -n mobile -c $WORKTREE_ONE/apps/mobile EXPO_PUBLIC_KANNA_SERVER_URL=http://127.0.0.1:48120 pnpm run dev -- --port 8081"

reset_logs
RESULT="$(run_dev_sh "$WORKTREE_ONE" "$REPO_ONE_ROOT/.git" --mobile env KANNA_MOBILE_SERVER_URL=http://desktop.lan:48120)"
expect_success "dev.sh --mobile explicit server url" "$RESULT" >/dev/null

assert_tmux_log_contains "EXPO_PUBLIC_KANNA_SERVER_URL=http://desktop.lan:48120"

reset_logs
RESULT="$(run_mobile_dev_sh "$WORKTREE_ONE" "$REPO_ONE_ROOT/.git" env KANNA_MOBILE_PORT=1555 KANNA_MOBILE_SERVER_HOST=127.0.0.1)"
expect_success "mobile-dev.sh" "$RESULT" >/dev/null

assert_tmux_log_contains "server=kanna-v0_0_30 cmd=new-window args=-t kanna-v0_0_30 -n mobile -c $WORKTREE_ONE/apps/mobile EXPO_PUBLIC_KANNA_SERVER_URL=http://127.0.0.1:48120 pnpm run dev -- --port 1555"

reset_logs
RESULT="$(run_dev_sh "$WORKTREE_ONE" "$REPO_ONE_ROOT/.git" --mobile env KANNA_MOBILE_SERVER_HOST=127.0.0.1 KANNA_MOBILE_SERVER_PORT=48129)"
expect_success "dev.sh --mobile server port override" "$RESULT" >/dev/null

assert_tmux_log_contains "server=kanna-v0_0_30 cmd=new-window args=-t kanna-v0_0_30 -n mobile -c $WORKTREE_ONE/apps/mobile EXPO_PUBLIC_KANNA_SERVER_URL=http://127.0.0.1:48129 pnpm run dev -- --port 8081"

reset_logs
RESULT="$(run_dev_sh "$WORKTREE_ONE" "$REPO_ONE_ROOT/.git" start env KANNA_DB_PATH=/tmp/shared-kanna.db)"
expect_success "dev.sh with KANNA_DB_PATH" "$RESULT" >/dev/null

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

reset_logs
RESULT="$(run_dev_sh "$WORKTREE_ONE" "$REPO_ONE_ROOT/.git" start env KANNA_APPIUM_PORT=4780)"
expect_success "dev.sh with KANNA_APPIUM_PORT" "$RESULT" >/dev/null

assert_tmux_log_contains "KANNA_APPIUM_PORT=4780"

reset_logs
printf '%s\n' 'kanna-v0_0_30|kanna-v0_0_30' > "$TMUX_STATE"
RESULT="$(run_dev_sh "$WORKTREE_ONE" "$REPO_ONE_ROOT/.git" log)"
expect_success "dev.sh log" "$RESULT" >/dev/null
assert_tmux_log_contains "server=kanna-v0_0_30 cmd=capture-pane"

reset_logs
printf '%s\n' 'kanna-v0_0_30|kanna-v0_0_30' > "$TMUX_STATE"
RESULT="$(run_dev_sh "$WORKTREE_ONE" "$REPO_ONE_ROOT/.git" stop)"
expect_success "dev.sh stop" "$RESULT" >/dev/null
assert_tmux_log_contains "server=kanna-v0_0_30 cmd=list-windows"
assert_tmux_log_contains "server=kanna-v0_0_30 cmd=send-keys"
assert_tmux_log_contains "server=kanna-v0_0_30 cmd=kill-session"

reset_logs
RESULT="$(run_dev_sh "$WORKTREE_ONE" "$REPO_ONE_ROOT/.git" --attach)"
expect_success "dev.sh --attach" "$RESULT" >/dev/null
assert_tmux_log_contains "server=kanna-v0_0_30 cmd=attach"

reset_logs
printf '%s\n' 'alpha|alpha' > "$TMUX_STATE"
RESULT="$(run_dev_sh "$ROOT_CHECKOUT" "$ROOT_CHECKOUT/.git" start env KANNA_DB_NAME=dev-root.db KANNA_TMUX_SESSION=beta)"
expect_success "dev.sh explicit tmux session override" "$RESULT" >/dev/null
assert_tmux_log_contains "server=beta cmd=new-session"

reset_logs
RESULT="$(run_dev_sh "$ROOT_CHECKOUT" "$ROOT_CHECKOUT/.git" start env KANNA_DB_NAME=dev-root.db)"
expect_success "dev.sh root checkout start" "$RESULT" >/dev/null
assert_tmux_log_contains "server=kanna cmd=new-session"

if grep -Fq "CARGO_TARGET_DIR=" "$TMUX_LOG"; then
  printf 'expected non-worktree start not to export CARGO_TARGET_DIR, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

if grep -Fq "CARGO_BUILD_BUILD_DIR=" "$TMUX_LOG"; then
  printf 'expected non-worktree start not to export CARGO_BUILD_BUILD_DIR, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

printf 'ok\n'
