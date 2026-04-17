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

shared_target_for_repo() {
  local repo_root="$1"
  printf '%s/Library/Caches/kanna/rust-target/%s/dev' "$TMPDIR_ROOT/home" "$(printf %s "$repo_root" | md5)"
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

assert_tmux_log_contains "new-session -d"
assert_tmux_log_contains "-s kanna-v0_0_30 -n desktop"
assert_tmux_log_contains "KANNA_DB_PATH=$TMPDIR_ROOT/home/Library/Application Support/build.kanna/kanna-wt-v0.0.30.db"
assert_tmux_log_contains "KANNA_DB_NAME=kanna-wt-v0.0.30.db"
assert_tmux_log_contains "KANNA_DAEMON_DIR=$WORKTREE_ONE/.kanna-daemon"
assert_tmux_log_contains "CARGO_TARGET_DIR=$(shared_target_for_repo "$REPO_ONE_ROOT")"

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
assert_tmux_log_contains "CARGO_TARGET_DIR=$(shared_target_for_repo "$REPO_ONE_ROOT")"

reset_logs
RESULT="$(run_dev_sh "$WORKTREE_THREE" "$REPO_TWO_ROOT/.git" start)"
expect_success "dev.sh different repo start" "$RESULT" >/dev/null
assert_tmux_log_contains "CARGO_TARGET_DIR=$(shared_target_for_repo "$REPO_TWO_ROOT")"

if [ "$(shared_target_for_repo "$REPO_ONE_ROOT")" = "$(shared_target_for_repo "$REPO_TWO_ROOT")" ]; then
  printf 'expected different repos to use different shared target dirs\n' >&2
  exit 1
fi

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

assert_tmux_log_contains "new-window -t kanna-v0_0_30 -n mobile -c $WORKTREE_ONE/apps/mobile EXPO_PUBLIC_KANNA_SERVER_URL=http://127.0.0.1:48120 pnpm run dev -- --port 1437"
assert_tmux_log_contains "EXPO_PUBLIC_KANNA_SERVER_URL=http://127.0.0.1:48120"

reset_logs
RESULT="$(run_dev_sh "$WORKTREE_ONE" "$REPO_ONE_ROOT/.git" --mobile env KANNA_MOBILE_SERVER_HOST=127.0.0.1)"
expect_success "dev.sh --mobile default port" "$RESULT" >/dev/null

assert_tmux_log_contains "new-window -t kanna-v0_0_30 -n mobile -c $WORKTREE_ONE/apps/mobile EXPO_PUBLIC_KANNA_SERVER_URL=http://127.0.0.1:48120 pnpm run dev -- --port 8081"

reset_logs
RESULT="$(run_dev_sh "$WORKTREE_ONE" "$REPO_ONE_ROOT/.git" --mobile env KANNA_MOBILE_SERVER_URL=http://desktop.lan:48120)"
expect_success "dev.sh --mobile explicit server url" "$RESULT" >/dev/null

assert_tmux_log_contains "EXPO_PUBLIC_KANNA_SERVER_URL=http://desktop.lan:48120"

reset_logs
RESULT="$(run_mobile_dev_sh "$WORKTREE_ONE" "$REPO_ONE_ROOT/.git" env KANNA_MOBILE_PORT=1555 KANNA_MOBILE_SERVER_HOST=127.0.0.1)"
expect_success "mobile-dev.sh" "$RESULT" >/dev/null

assert_tmux_log_contains "new-window -t kanna-v0_0_30 -n mobile -c $WORKTREE_ONE/apps/mobile EXPO_PUBLIC_KANNA_SERVER_URL=http://127.0.0.1:48120 pnpm run dev -- --port 1555"

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
RESULT="$(run_dev_sh "$ROOT_CHECKOUT" "$ROOT_CHECKOUT/.git" start env KANNA_DB_NAME=dev-root.db)"
expect_success "dev.sh root checkout start" "$RESULT" >/dev/null

if grep -Fq "CARGO_TARGET_DIR=" "$TMUX_LOG"; then
  printf 'expected non-worktree start not to export CARGO_TARGET_DIR, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

printf 'ok\n'
