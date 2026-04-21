# E2E Stable DB Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make desktop E2E runs idempotent by using task-id-scoped stable DB names and moving DB deletion into `dev.sh` via an explicit `--delete-db` flag.

**Architecture:** `apps/desktop/tests/e2e/run.ts` will stop inventing per-run DB names and instead derive `test-<worktree>-primary.db` and `test-<worktree>-secondary.db`. `scripts/dev.sh` becomes the owner of test DB lifecycle by resolving the DB path from `--db` and deleting the DB/WAL/SHM before launch when `--delete-db` is present.

**Tech Stack:** Bash, TypeScript, desktop E2E runner, existing shell harness in `scripts/dev.sh.test.sh`

---

### Task 1: Lock the new `dev.sh --delete-db` contract in shell tests

**Files:**
- Modify: `scripts/dev.sh.test.sh`
- Test: `scripts/dev.sh.test.sh`

- [ ] **Step 1: Add a failing test for deleting a resolved filename-only DB before start**

```bash
: > "$RM_LOG"
RESULT="$(run_dev_sh "$WORKTREE_ONE" "$REPO_ONE_ROOT/.git" start -- --db test-task-v0.0.30-primary.db --delete-db)"
expect_success "dev.sh start --delete-db" "$RESULT" >/dev/null

if ! grep -Fxq "$TMPDIR_ROOT/home/Library/Application Support/build.kanna/test-task-v0.0.30-primary.db" "$RM_LOG"; then
  printf 'expected --delete-db to remove resolved DB path before start, got:\n' >&2
  cat "$RM_LOG" >&2
  exit 1
fi
```

- [ ] **Step 2: Add a failing test for WAL/SHM cleanup**

```bash
for suffix in "" "-wal" "-shm"; do
  if ! grep -Fxq "$TMPDIR_ROOT/home/Library/Application Support/build.kanna/test-task-v0.0.30-primary.db${suffix}" "$RM_LOG"; then
    printf 'expected --delete-db to remove %s variant, got:\n' "$suffix" >&2
    cat "$RM_LOG" >&2
    exit 1
  fi
done
```

- [ ] **Step 3: Run the shell harness to verify the new assertions fail**

Run: `bash scripts/dev.sh.test.sh`
Expected: FAIL because `scripts/dev.sh` does not support `--delete-db` yet.

### Task 2: Implement `--delete-db` in `dev.sh`

**Files:**
- Modify: `scripts/dev.sh`
- Test: `scripts/dev.sh.test.sh`

- [ ] **Step 1: Add argument parsing and help text for `--delete-db`**

```bash
DELETE_DB=false

--delete-db)
  DELETE_DB=true
  shift
  ;;
```

- [ ] **Step 2: Add a DB cleanup helper using the already-resolved DB path**

```bash
delete_db() {
  rm -f "$KANNA_DB_PATH" "${KANNA_DB_PATH}-wal" "${KANNA_DB_PATH}-shm"
}
```

- [ ] **Step 3: Invoke DB cleanup before `start` and `seed` when requested**

```bash
if $DELETE_DB; then
  delete_db
fi
start
```

- [ ] **Step 4: Run the shell harness and confirm it passes**

Run: `bash scripts/dev.sh.test.sh`
Expected: PASS

### Task 3: Switch the E2E runner to stable task-scoped DB names

**Files:**
- Modify: `apps/desktop/tests/e2e/run.ts`
- Test: `apps/desktop/tests/e2e/run.ts`

- [ ] **Step 1: Derive stable DB names from the current worktree directory**

```ts
const worktreeName = basename(repoRoot);
const primaryDbName = `test-${worktreeName}-primary.db`;
const secondaryDbName = enableSecondary ? `test-${worktreeName}-secondary.db` : null;
```

- [ ] **Step 2: Pass `--delete-db` alongside `--db` in the start commands**

```ts
["./scripts/dev.sh", "start", "--db", input.dbPath, "--delete-db", ...]
```

- [ ] **Step 3: Stop manually deleting DB files in the runner cleanup**

```ts
await runCommand(primary.stopCommand, { cwd: repoRoot, env: primary.env }).catch(() => undefined);
// no rm(primary.dbPath) here
```

- [ ] **Step 4: Run TypeScript verification**

Run: `pnpm exec tsc --noEmit -p apps/desktop/tsconfig.json`
Expected: PASS

### Task 4: Re-verify desktop E2E behavior with the stable DB contract

**Files:**
- Modify: none
- Test: `apps/desktop/tests/e2e/mock/keyboard-shortcuts.test.ts`, `apps/desktop/tests/e2e/real/claude-session.test.ts`

- [ ] **Step 1: Run the desktop mock E2E suite**

Run: `pnpm --dir apps/desktop test:e2e`
Expected: PASS

- [ ] **Step 2: Run the real Claude-session spec**

Run: `pnpm --dir apps/desktop exec tsx tests/e2e/run.ts real/claude-session.test.ts`
Expected: Either PASS or the current app/test assertion failure, but no launcher/DB-collision failure.
