#!/bin/bash
# Start (or restart) the Kanna dev environment in a tmux session.
#
# Usage:
#   ./scripts/dev.sh              # start desktop only
#   ./scripts/dev.sh --mobile     # start desktop + mobile pipeline
#   ./scripts/dev.sh stop         # stop the session
#   ./scripts/dev.sh stop -k      # stop the session and kill the daemon
#   ./scripts/dev.sh restart      # stop + start
#   ./scripts/dev.sh restart -k   # stop (kill daemon) + start
#   ./scripts/dev.sh log          # print desktop log
#   ./scripts/dev.sh log relay    # print relay log (--mobile)
#   ./scripts/dev.sh log server   # print kanna-server log (--mobile)
#   ./scripts/dev.sh log mobile   # print tauri ios dev log (--mobile)
#   ./scripts/dev.sh seed         # seed the DB with test data (no server start)
#   ./scripts/dev.sh start --seed # start + seed
set -e
ROOT="$(git rev-parse --show-toplevel)"
export KANNA_BUILD_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
export KANNA_BUILD_COMMIT="$(git rev-parse --short HEAD)"

desktop_bundle_identifier() {
  local conf="$ROOT/apps/desktop/src-tauri/tauri.conf.json"
  if [ -f "$conf" ]; then
    if command -v jq >/dev/null 2>&1; then
      jq -r '.identifier // "build.kanna"' "$conf" 2>/dev/null || echo "build.kanna"
      return
    fi
    if command -v python3 >/dev/null 2>&1; then
      python3 - "$conf" 2>/dev/null <<'PY' || echo "build.kanna"
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    print(json.load(fh).get("identifier", "build.kanna"))
PY
      return
    fi
  fi

  echo "build.kanna"
}

DESKTOP_BUNDLE_IDENTIFIER="$(desktop_bundle_identifier)"

canonical_tmux_session_name() {
  printf '%s' "$1" | tr '.' '_'
}

# Auto-detect worktree by checking if we're inside .kanna-worktrees/
if [ -n "$KANNA_WORKTREE" ] || echo "$ROOT" | grep -q '\.kanna-worktrees/'; then
  export KANNA_WORKTREE=1
  WORKTREE_NAME="$(basename "$ROOT")"
  export KANNA_BUILD_WORKTREE="$WORKTREE_NAME"
  SESSION="$(canonical_tmux_session_name "kanna-${WORKTREE_NAME}")"
else
  unset KANNA_BUILD_WORKTREE 2>/dev/null || true
  SESSION="$(canonical_tmux_session_name "kanna")"
fi

# Read ports from .kanna/config.json
read_port() {
  local key="$1"
  local default="$2"
  if command -v jq >/dev/null 2>&1; then
    jq -r ".ports.${key} // ${default}" "$ROOT/.kanna/config.json" 2>/dev/null || echo "$default"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import json; d=json.load(open('$ROOT/.kanna/config.json')); print(d.get('ports',{}).get('$key',$default))" 2>/dev/null || echo "$default"
  else
    echo "$default"
  fi
}

resolve_db_name() {
  if [ -n "${KANNA_WORKTREE:-}" ]; then
    printf 'kanna-wt-%s.db\n' "$(basename "$ROOT")"
  else
    printf 'kanna-v2.db\n'
  fi
}

resolve_db_path() {
  printf '%s/Library/Application Support/%s/%s\n' "$HOME" "$DESKTOP_BUNDLE_IDENTIFIER" "$(resolve_db_name)"
}

resolve_daemon_dir() {
  if [ -n "${KANNA_WORKTREE:-}" ]; then
    printf '%s/.kanna-daemon\n' "$ROOT"
  else
    printf '%s/Library/Application Support/Kanna\n' "$HOME"
  fi
}

RESOLVED_DB_PATH="$(resolve_db_path)"
RESOLVED_DB_NAME="$(basename "$RESOLVED_DB_PATH")"
RESOLVED_DAEMON_DIR="$(resolve_daemon_dir)"
export KANNA_DB_NAME="$RESOLVED_DB_NAME"
export KANNA_DB_PATH="$RESOLVED_DB_PATH"
export KANNA_DAEMON_DIR="$RESOLVED_DAEMON_DIR"

start_mobile() {
  local RELAY_PORT
  RELAY_PORT="$(read_port KANNA_RELAY_PORT 9080)"
  local MOBILE_PORT
  MOBILE_PORT="$(read_port KANNA_MOBILE_PORT 1421)"
  local CONFIG_DIR="$ROOT/.kanna-mobile"
  local SERVER_CONFIG="$CONFIG_DIR/server.toml"
  local DAEMON_DIR="$ROOT/.kanna-daemon"
  local DB_PATH="$KANNA_DB_PATH"

  # Install relay deps if needed
  if [ ! -d "$ROOT/services/relay/node_modules" ]; then
    echo "Installing relay dependencies..."
    (cd "$ROOT/services/relay" && bun install)
  fi

  # Generate kanna-server config
  mkdir -p "$CONFIG_DIR"
  cat > "$SERVER_CONFIG" <<EOF
relay_url = "ws://localhost:${RELAY_PORT}"
device_token = "local-dev-token"
daemon_dir = "${DAEMON_DIR}"
db_path = "${DB_PATH}"
EOF

  echo "  Relay:   localhost:${RELAY_PORT}"
  echo "  Server:  ${SERVER_CONFIG}"
  echo "  Mobile:  tauri ios dev (port ${MOBILE_PORT})"

  # Write mobile tauri.conf.local.json with the isolated port
  local MOBILE_LOCAL_CONF="$ROOT/apps/mobile/src-tauri/tauri.conf.local.json"
  cat > "$MOBILE_LOCAL_CONF" <<MEOF
{
  "build": {
    "devUrl": "http://localhost:${MOBILE_PORT}"
  }
}
MEOF

  # Window: relay broker
  tmux new-window -t "$SESSION" -n relay -c "$ROOT/services/relay"
  tmux send-keys -t "$SESSION:relay" \
    "PORT=${RELAY_PORT} SKIP_AUTH=true bun run dev" Enter

  # Wait for relay to start
  sleep 2

  # Window: kanna-server
  tmux new-window -t "$SESSION" -n server -c "$ROOT"
  tmux send-keys -t "$SESSION:server" \
    "KANNA_SERVER_CONFIG=${SERVER_CONFIG} RUST_LOG=info cargo run --manifest-path crates/kanna-server/Cargo.toml" Enter

  # Write mobile tauri.conf.local.json with the isolated port
  local MOBILE_LOCAL_CONF="$ROOT/apps/mobile/src-tauri/tauri.conf.local.json"
  cat > "$MOBILE_LOCAL_CONF" <<MEOF
{
  "build": {
    "devUrl": "http://localhost:${MOBILE_PORT}"
  }
}
MEOF

  # Window: tauri ios dev
  tmux new-window -t "$SESSION" -n mobile -c "$ROOT/apps/mobile"
  tmux send-keys -t "$SESSION:mobile" \
    "KANNA_DEV_PORT=${MOBILE_PORT} KANNA_RELAY_PORT=${RELAY_PORT} bunx tauri ios dev" Enter
}

start() {
  # SAFETY: never run the dev server against the production database
  if [ "$KANNA_DB_NAME" = "kanna-v2.db" ]; then
    echo "REFUSED: dev.sh will not start against the production database (kanna-v2.db)."
    echo "Run from a worktree, or set KANNA_DB_NAME to a non-production name."
    exit 1
  fi

  if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "Session '$SESSION' already running. Use 'restart' or 'stop'."
    exit 1
  fi
  local DESKTOP_CWD="$ROOT/apps/desktop"
  tmux new-session -d -s "$SESSION" -n desktop -c "$DESKTOP_CWD"
  # Forward all KANNA_* env vars into the tmux session
  EXPORTS="$(env | grep '^KANNA_' | sed "s/^\([^=]*\)=\(.*\)/export \1='\2'/" | tr '\n' ' ')"

  # Build dev sidecars before tauri dev so externalBin inputs exist and are
  # owned by the dev path instead of beforeBuildCommand.
  DEV_CMD="bun run build:sidecars && bun tauri dev"
  LOCAL_CONF="$ROOT/apps/desktop/src-tauri/tauri.conf.local.json"
  if [ -n "$KANNA_WORKTREE" ] && [ -n "$KANNA_DEV_PORT" ]; then
    cat > "$LOCAL_CONF" <<LOCALEOF
{
  "build": {
    "devUrl": "http://localhost:$KANNA_DEV_PORT"
  }
}
LOCALEOF
    DEV_CMD="bun run build:sidecars && bun tauri dev --config $LOCAL_CONF"
  fi

  if [ -n "$EXPORTS" ]; then
    tmux send-keys -t "$SESSION:desktop" "$EXPORTS&& $DEV_CMD" Enter
  else
    tmux send-keys -t "$SESSION:desktop" "$DEV_CMD" Enter
  fi

  if $MOBILE; then
    start_mobile
  fi

  echo "Started tmux session '$SESSION'. Attach with: tmux attach -t $SESSION"
}

kill_daemon() {
  local pid_file="$ROOT/.kanna-daemon/daemon.pid"
  if [ -f "$pid_file" ]; then
    local pid
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      echo "Killed daemon (pid=$pid)."
    else
      echo "Daemon not running (stale pid=$pid)."
      rm -f "$pid_file"
    fi
  else
    echo "No daemon pid file found."
  fi
}

stop() {
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    # Send Ctrl-C to all windows
    for win in $(tmux list-windows -t "$SESSION" -F '#{window_name}' 2>/dev/null); do
      tmux send-keys -t "$SESSION:$win" C-c 2>/dev/null || true
    done
    sleep 1
    tmux kill-session -t "$SESSION" 2>/dev/null || true
    echo "Stopped."
  else
    echo "No session running."
  fi
  if $KILL_DAEMON; then
    kill_daemon
  fi
}

log() {
  local window="${1:-desktop}"
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    tmux capture-pane -t "$SESSION:$window" -p -S -50
  else
    echo "No session running."
  fi
}

seed() {
  # SAFETY: never seed the production database
  if [ "$KANNA_DB_NAME" = "kanna-v2.db" ]; then
    echo "REFUSED: will not seed production database (kanna-v2.db)."
    echo "Run from a worktree, or set KANNA_DB_NAME to a non-production name."
    exit 1
  fi

  local SEED_SQL="$ROOT/apps/desktop/tests/e2e/seed.sql"

  if [ ! -f "$SEED_SQL" ]; then
    echo "Seed file not found: $SEED_SQL"
    exit 1
  fi

  mkdir -p "$(dirname "$KANNA_DB_PATH")"
  sqlite3 "$KANNA_DB_PATH" < "$SEED_SQL"
  echo "Seeded $KANNA_DB_PATH"
}

ATTACH=false
KILL_DAEMON=false
SEED=false
MOBILE=false
for arg in "$@"; do
  case "$arg" in
    --attach|-a) ATTACH=true ;;
    --kill-daemon|-k) KILL_DAEMON=true ;;
    --seed|-s) SEED=true ;;
    --mobile|-m) MOBILE=true ;;
  esac
done

CMD="${1:-start}"
# Don't treat flags as the command
case "$CMD" in
  --*|-*) CMD="start" ;;
esac

case "$CMD" in
  start)
    start
    if $SEED; then
      seed
    fi
    if $ATTACH; then
      tmux attach -t "$SESSION"
    fi
    ;;
  stop)    stop ;;
  restart)
    stop
    sleep 1
    start
    if $SEED; then
      seed
    fi
    if $ATTACH; then
      tmux attach -t "$SESSION"
    fi
    ;;
  log)     log "$2" ;;
  seed)    seed ;;
  *)       echo "Usage: $0 {start|stop|restart|log [window]|seed} [--mobile] [--seed] [--attach] [--kill-daemon]" ;;
esac
