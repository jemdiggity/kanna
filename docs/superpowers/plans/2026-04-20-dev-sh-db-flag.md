# dev.sh DB Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single explicit `--db <full-path>` flag to `scripts/dev.sh` so worktree runs can intentionally override the database path/name without re-enabling inherited env overrides.

**Architecture:** Keep the existing worktree safety boundary: inherited `KANNA_DB_NAME` and `KANNA_DB_PATH` remain ignored in worktrees. Add one CLI-owned override channel that is parsed before DB resolution, sets `KANNA_DB_PATH`, derives `KANNA_DB_NAME` from the basename, and is reused by `start`, `restart`, and `seed`.

**Tech Stack:** Bash, existing shell test harness in `scripts/dev.sh.test.sh`, pnpm desktop E2E runner

---

### Task 1: Lock the desired CLI behavior in shell tests

**Files:**
- Modify: `scripts/dev.sh.test.sh`
- Test: `scripts/dev.sh.test.sh`

- [ ] **Step 1: Write the failing test for `start --db` in a worktree**

```bash
reset_logs
RESULT="$(run_dev_sh "$WORKTREE_ONE" "$REPO_ONE_ROOT/.git" start --db /tmp/e2e/explicit.db)"
expect_success "dev.sh start --db" "$RESULT" >/dev/null

if ! grep -Fq "KANNA_DB_PATH=/tmp/e2e/explicit.db" "$TMUX_LOG"; then
  printf 'expected --db path to be forwarded, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi

if ! grep -Fq "KANNA_DB_NAME=explicit.db" "$TMUX_LOG"; then
  printf 'expected --db to derive KANNA_DB_NAME from basename, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi
```

- [ ] **Step 2: Write the failing test for `seed --db` in a worktree**

```bash
: > "$SQLITE_LOG"
RESULT="$(run_dev_sh "$WORKTREE_ONE" "$REPO_ONE_ROOT/.git" seed --db /tmp/e2e/seed.db)"
expect_success "dev.sh seed --db" "$RESULT" >/dev/null

if ! grep -Fxq "/tmp/e2e/seed.db" "$SQLITE_LOG"; then
  printf 'expected seed --db to target explicit database path, got:\n' >&2
  cat "$SQLITE_LOG" >&2
  exit 1
fi
```

- [ ] **Step 3: Run the shell harness to verify the new assertions fail before code changes**

Run: `bash scripts/dev.sh.test.sh`
Expected: FAIL in the new `--db` assertions because `scripts/dev.sh` does not parse `--db` yet.

### Task 2: Implement the `--db` flag in `dev.sh`

**Files:**
- Modify: `scripts/dev.sh`
- Test: `scripts/dev.sh.test.sh`

- [ ] **Step 1: Add a parsed explicit DB override**

```bash
EXPLICIT_DB_PATH=""

while [ $# -gt 0 ]; do
  case "$1" in
    --db)
      EXPLICIT_DB_PATH="${2:?--db requires a full database path}"
      shift 2
      ;;
  esac
done
```

- [ ] **Step 2: Feed the explicit path into DB resolution without changing inherited-env behavior**

```bash
resolve_db_name() {
  if [ -n "${EXPLICIT_DB_PATH:-}" ]; then
    basename "$EXPLICIT_DB_PATH"
    return
  fi
  if [ -z "${KANNA_WORKTREE:-}" ] && [ -n "${KANNA_DB_NAME:-}" ]; then
    printf '%s\n' "$KANNA_DB_NAME"
    return
  fi
  ...
}

resolve_db_path() {
  if [ -n "${EXPLICIT_DB_PATH:-}" ]; then
    printf '%s\n' "$EXPLICIT_DB_PATH"
    return
  fi
  if [ -z "${KANNA_WORKTREE:-}" ] && [ -n "${KANNA_DB_PATH:-}" ]; then
    printf '%s\n' "$KANNA_DB_PATH"
    return
  fi
  ...
}
```

- [ ] **Step 3: Update usage/help text and command parsing**

```bash
# Usage:
#   ./scripts/dev.sh start --db /tmp/kanna-test.db
#   ./scripts/dev.sh seed --db /tmp/kanna-test.db

case "$CMD" in
  *)
    echo "Usage: $0 {start|stop|restart|kill-daemon|log [window]|seed} [--mobile] [--seed] [--attach] [--kill-daemon] [--db /full/path/file.db]"
    ;;
esac
```

- [ ] **Step 4: Run the shell harness and confirm it turns green**

Run: `bash scripts/dev.sh.test.sh`
Expected: PASS

### Task 3: Verify the E2E workflow with the new explicit override path

**Files:**
- Modify: `apps/desktop/tests/e2e/run.ts`
- Test: `apps/desktop/tests/e2e/run.ts`, `apps/desktop/tests/e2e/preload.ts`

- [ ] **Step 1: Update the E2E runner to use the explicit CLI flag**

```ts
startCommand: input.secondary
  ? ["./scripts/dev.sh", "start", "--secondary", "--db", input.dbPath]
  : ["./scripts/dev.sh", "start", "--db", input.dbPath],
```

- [ ] **Step 2: Run the desktop mock E2E suite**

Run: `pnpm --dir apps/desktop test:e2e`
Expected: PASS, or a later app-level failure unrelated to the previous test-DB refusal.

- [ ] **Step 3: Run TypeScript verification for the edited desktop test file**

Run: `pnpm exec tsc --noEmit`
Expected: PASS
