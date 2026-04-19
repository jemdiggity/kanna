# Tmux Workspace Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `scripts/dev.sh` run each workspace against its own tmux server, with the tmux server name matching the already-derived tmux session name.

**Architecture:** Keep the existing session-name derivation logic and promote that same canonicalized value to `TMUX_SERVER`. Add a single tmux wrapper in `scripts/dev.sh` so every tmux lifecycle operation uses `tmux -L "$TMUX_SERVER"`, then update the shell harness in `scripts/dev.sh.test.sh` to model server-scoped state and assert the new contract. Update the checked-in workflow docs so they describe separate tmux servers instead of only separate tmux sessions.

**Tech Stack:** Bash, tmux, shell test harness in `scripts/dev.sh.test.sh`

---

### Task 1: Make the Shell Harness Prove Server-Scoped Isolation

**Files:**
- Modify: `scripts/dev.sh.test.sh`
- Test: `scripts/dev.sh.test.sh`

- [ ] **Step 1: Write the failing test harness changes for tmux server selection**

Add server-aware state helpers and log parsing to the fake tmux binary in `scripts/dev.sh.test.sh` so the test harness expects `-L <server>` before the tmux subcommand:

```bash
normalize() {
  printf '%s' "$1" | tr '.' '_'
}

session_key() {
  printf '%s|%s\n' "$1" "$2"
}

session_exists() {
  local server="$1"
  local session="$2"
  grep -Fxq "$(session_key "$server" "$session")" "$state_file"
}

server="default"
if [ "${1:-}" = "-L" ]; then
  server="$(normalize "$2")"
  shift 2
fi

cmd="$1"
shift || true
printf 'server=%s cmd=%s args=%s\n' "$server" "$cmd" "$*" >> "$log_file"
```

Update `new-session`, `has-session`, and targeted commands to use `session_exists "$server" "$target_session"` and persist state as `server|session` pairs:

```bash
if session_exists "$server" "$normalized_session"; then
  printf 'duplicate session: %s on server %s\n' "$normalized_session" "$server" >&2
  exit 1
fi
printf '%s\n' "$(session_key "$server" "$normalized_session")" >> "$state_file"
```

- [ ] **Step 2: Add explicit expectations that `scripts/dev.sh` uses the workspace tmux server**

Replace the old generic log assertions with server-aware ones:

```bash
assert_tmux_log_contains "server=kanna-v0_0_30 cmd=new-session"
assert_tmux_log_contains "server=kanna-v0_0_30 cmd=set-option"
assert_tmux_log_contains "server=kanna-v0_0_30 cmd=new-window"
assert_tmux_log_contains "server=kanna cmd=new-session"
```

Add an attach-string expectation for the user-facing output:

```bash
if ! grep -Fq "Attach with: tmux -L kanna-v0_0_30 attach -t kanna-v0_0_30" <<<"$OUTPUT"; then
  printf 'expected attach command to include tmux server, got:\n%s\n' "$OUTPUT" >&2
  exit 1
fi
```

- [ ] **Step 3: Add an isolation regression that fails on shared-server behavior**

Add a test shape that proves two sessions with the same name can coexist if they are on different tmux servers:

```bash
reset_logs
printf '%s\n' "alpha|kanna" > "$TMUX_STATE"

RESULT="$(run_dev_sh "$ROOT_CHECKOUT" "$ROOT_CHECKOUT/.git" start env KANNA_DB_NAME=dev-root.db KANNA_TMUX_SESSION=beta)"
expect_success "dev.sh explicit tmux session override" "$RESULT" >/dev/null
assert_tmux_log_contains "server=beta cmd=new-session"

RESULT="$(run_dev_sh "$ROOT_CHECKOUT" "$ROOT_CHECKOUT/.git" start env KANNA_DB_NAME=dev-root-second.db KANNA_TMUX_SESSION=alpha)"
OUTPUT="${RESULT%===STATUS:*===}"
STATUS="${RESULT##*===STATUS:}"
STATUS="${STATUS%===}"
if [ "$STATUS" -eq 0 ]; then
  printf 'expected duplicate session on same tmux server to fail\n' >&2
  exit 1
fi
```

The point of this step is to make the harness distinguish “same session name on same server” from “same session name on different server.”

- [ ] **Step 4: Run the shell harness to verify it fails for the right reason**

Run: `bash scripts/dev.sh.test.sh`

Expected: FAIL because `scripts/dev.sh` still invokes plain `tmux` and still prints `tmux attach -t ...` without `-L`.

- [ ] **Step 5: Commit the failing test harness**

```bash
git add scripts/dev.sh.test.sh
git commit -m "test: require tmux server isolation in dev.sh"
```

### Task 2: Route All dev.sh tmux Operations Through a Workspace Server

**Files:**
- Modify: `scripts/dev.sh`
- Test: `scripts/dev.sh.test.sh`

- [ ] **Step 1: Add a single tmux wrapper after session resolution**

Introduce `TMUX_SERVER` and a wrapper immediately after the existing `SESSION` derivation:

```bash
if [ -n "${KANNA_TMUX_SESSION:-}" ]; then
  SESSION="$(canonical_tmux_session_name "$KANNA_TMUX_SESSION")"
elif [ -n "${KANNA_WORKTREE:-}" ]; then
  SESSION="$(canonical_tmux_session_name "kanna-${WORKTREE_NAME}")"
else
  SESSION="$(canonical_tmux_session_name "kanna")"
fi

TMUX_SERVER="$SESSION"

tmux_cmd() {
  tmux -L "$TMUX_SERVER" "$@"
}
```

- [ ] **Step 2: Replace every raw tmux call with the wrapper**

Update `start_mobile`, `start`, `stop`, `log`, and both attach sites so they all call `tmux_cmd`:

```bash
tmux_cmd new-window -t "$SESSION" -n mobile -c "$MOBILE_CWD" \
  "EXPO_PUBLIC_KANNA_SERVER_URL=${MOBILE_SERVER_URL} pnpm run dev -- --port ${MOBILE_PORT}"

if tmux_cmd has-session -t "$SESSION" 2>/dev/null; then
  echo "Session '$SESSION' already running. Use 'restart' or 'stop'."
  exit 1
fi

tmux_cmd new-session -d "${TMUX_ENV[@]}" -s "$SESSION" -n desktop -c "$DESKTOP_CWD" "$DEV_CMD"
tmux_cmd set-option -t "$SESSION" remain-on-exit on >/dev/null
```

And in the stop/log/attach paths:

```bash
for win in $(tmux_cmd list-windows -t "$SESSION" -F '#{window_name}' 2>/dev/null); do
  tmux_cmd send-keys -t "$SESSION:$win" C-c 2>/dev/null || true
done

tmux_cmd kill-session -t "$SESSION" 2>/dev/null || true
tmux_cmd capture-pane -t "$SESSION:$window" -p -S -50
tmux_cmd attach -t "$SESSION"
```

- [ ] **Step 3: Update the user-facing attach message**

Change the start output so it teaches the correct manual attach command:

```bash
echo "Started tmux session '$SESSION'. Attach with: tmux -L $TMUX_SERVER attach -t $SESSION"
```

- [ ] **Step 4: Run the shell harness to verify the implementation passes**

Run: `bash scripts/dev.sh.test.sh`

Expected: PASS with final output `ok`

- [ ] **Step 5: Commit the wrapper-based implementation**

```bash
git add scripts/dev.sh scripts/dev.sh.test.sh
git commit -m "feat: isolate dev tmux servers per workspace"
```

### Task 3: Align the Checked-In Workflow Docs

**Files:**
- Modify: `AGENTS.md`
- Test: `AGENTS.md`

- [ ] **Step 1: Update the worktree isolation description**

Change the existing tmux bullet from session-only wording to server-and-session wording:

```md
- **Separate tmux server** — worktrees use a tmux server named `kanna-{worktree-dir}` instead of the default `kanna`, and `dev.sh` creates the desktop/mobile windows inside a same-named session on that server
```

- [ ] **Step 2: Keep the launcher guidance consistent**

Adjust the startup guidance where it says the script “runs in a background tmux session” so it reflects the per-workspace tmux server boundary:

```md
Always use `./scripts/dev.sh` to start the dev server — never run `pnpm run dev`, `pnpm exec tauri dev`, or `cargo tauri dev` directly. `pnpm run dev` bypasses the worktree-aware setup and can launch Vite/Tauri on the wrong port. `dev.sh` auto-detects the worktree context, sets `KANNA_WORKTREE=1`, derives the worktree DB/daemon/tmux server internally, and runs in a background tmux session.
```

- [ ] **Step 3: Verify the doc text is internally consistent**

Run: `rg -n "Separate tmux|background tmux session|tmux server" AGENTS.md`

Expected: the worktree isolation text mentions a separate tmux server and does not leave behind contradictory session-only wording in the edited sections.

- [ ] **Step 4: Commit the doc alignment**

```bash
git add AGENTS.md
git commit -m "docs: describe tmux server isolation for worktrees"
```

### Task 4: Final Verification Before Completion

**Files:**
- Modify: none
- Test: `scripts/dev.sh.test.sh`

- [ ] **Step 1: Run the targeted regression test**

Run: `bash scripts/dev.sh.test.sh`

Expected: PASS with final output `ok`

- [ ] **Step 2: Review the final diff for the intended scope**

Run: `git diff -- scripts/dev.sh scripts/dev.sh.test.sh AGENTS.md`

Expected: only the tmux wrapper, tmux-server-aware harness updates, attach message, and doc wording changes appear.

- [ ] **Step 3: Summarize the behavioral contract in the final handoff**

Include these points in the completion summary:

```text
- each workspace now talks to tmux with -L <session-name>
- manual attach uses tmux -L <server> attach -t <session>
- the shell harness now keys tmux state by server and session, so isolation is tested instead of assumed
```
