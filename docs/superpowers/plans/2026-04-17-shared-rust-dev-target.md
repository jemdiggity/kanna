# Shared Rust Dev Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `./scripts/dev.sh` run worktree Tauri dev sessions with a shared repo-level Cargo target directory so Rust artifacts are reused across worktrees instead of duplicated into per-worktree `.build` trees.

**Architecture:** Keep the experiment scoped to the dev runtime path. `scripts/dev.sh` will derive a stable repo-level cache path from the main repo root, export `CARGO_TARGET_DIR` into the tmux-launched desktop process when running in a worktree, and leave manual Cargo behavior, bootstrap config, and Bazel/release flows unchanged.

**Tech Stack:** Bash, tmux env injection, existing `scripts/dev.sh.test.sh` shell-test pattern, macOS `md5`

---

## File Structure

- Modify: `scripts/dev.sh`
  - Add helper(s) to derive the stable main repo root and shared Rust target path
  - Export `CARGO_TARGET_DIR` only for worktree desktop dev sessions
- Modify: `scripts/dev.sh.test.sh`
  - Add regression coverage for shared target-dir export and repo/worktree path stability

### Task 1: Add failing shell coverage for the shared dev target dir

**Files:**
- Modify: `scripts/dev.sh.test.sh`
- Test: `scripts/dev.sh.test.sh`

- [ ] **Step 1: Write the failing test assertions**

Extend `scripts/dev.sh.test.sh` so the fake `git` command can answer:

```bash
"rev-parse --show-toplevel")
  printf '%s\n' "$TEST_ROOT"
  ;;
"rev-parse --git-common-dir")
  printf '%s\n' "$TEST_ROOT/.git"
  ;;
```

And add these assertions after the existing `KANNA_DB_*` / `KANNA_DAEMON_DIR` checks:

```bash
EXPECTED_SHARED_TARGET="$TMPDIR_ROOT/home/Library/Caches/kanna/rust-target/$(printf %s "$TEST_ROOT" | md5)/dev"

if ! grep -Fq "CARGO_TARGET_DIR='$EXPECTED_SHARED_TARGET'" "$TMUX_LOG"; then
  printf 'expected shared cargo target dir in tmux command, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi
```

Then add a second fake repo/worktree fixture and assert:

```bash
if [ "$FIRST_SHARED_TARGET" != "$SECOND_SHARED_TARGET" ]; then
  printf 'expected two worktrees from same repo to share target dir\n' >&2
  exit 1
fi
```

And a different repo fixture with:

```bash
if [ "$FIRST_SHARED_TARGET" = "$THIRD_SHARED_TARGET" ]; then
  printf 'expected different repos to use different shared target dirs\n' >&2
  exit 1
fi
```

Then add a non-worktree invocation that does not set `KANNA_WORKTREE` and
assert the tmux command does not contain `CARGO_TARGET_DIR`:

```bash
if grep -Fq "CARGO_TARGET_DIR=" "$TMUX_LOG"; then
  printf 'expected non-worktree start not to export CARGO_TARGET_DIR, got:\n' >&2
  cat "$TMUX_LOG" >&2
  exit 1
fi
```

- [ ] **Step 2: Run the shell test to verify it fails**

Run:

```bash
bash scripts/dev.sh.test.sh
```

Expected: FAIL because `scripts/dev.sh` does not yet export `CARGO_TARGET_DIR`.

### Task 2: Implement shared target-dir derivation in `scripts/dev.sh`

**Files:**
- Modify: `scripts/dev.sh`
- Test: `scripts/dev.sh.test.sh`

- [ ] **Step 1: Add the path-derivation helpers**

Add helper functions near the top of `scripts/dev.sh`:

```bash
git_common_dir() {
  git rev-parse --git-common-dir
}

main_repo_root() {
  local common_dir
  common_dir="$(git_common_dir)"
  cd "${common_dir}/.." && pwd
}

shared_rust_target_dir() {
  local repo_root
  local repo_hash

  repo_root="$(main_repo_root)"
  repo_hash="$(printf %s "$repo_root" | md5)"
  printf '%s/Library/Caches/kanna/rust-target/%s/dev\n' "$HOME" "$repo_hash"
}
```

- [ ] **Step 2: Export `CARGO_TARGET_DIR` for worktree desktop dev sessions**

Inside `start()`, before the tmux session is created, add:

```bash
  if [ -n "${KANNA_WORKTREE:-}" ]; then
    export CARGO_TARGET_DIR="$(shared_rust_target_dir)"
  fi
```

Do not change:

- `.cargo/config.toml`
- `scripts/setup-worktree.sh`
- Tauri backend worktree bootstrap code
- non-worktree behavior

- [ ] **Step 3: Run the shell test to verify it passes**

Run:

```bash
bash scripts/dev.sh.test.sh
```

Expected: PASS

- [ ] **Step 4: Run a syntax check**

Run:

```bash
bash -n scripts/dev.sh scripts/dev.sh.test.sh
```

Expected: PASS with no output

### Task 3: Verify the real script behavior and review the diff

**Files:**
- Modify: none
- Test: `scripts/dev.sh.test.sh`

- [ ] **Step 1: Review the focused diff**

Run:

```bash
git diff -- scripts/dev.sh scripts/dev.sh.test.sh
```

Expected:
- only worktree dev-session env wiring changed
- no changes to DB/daemon/path isolation logic beyond adding `CARGO_TARGET_DIR`
- non-worktree behavior remains unchanged

- [ ] **Step 2: Record the resulting workspace state**

Run:

```bash
git status --short
```

Expected:
- modified `scripts/dev.sh`
- modified `scripts/dev.sh.test.sh`
- plan/spec docs if still uncommitted
```
