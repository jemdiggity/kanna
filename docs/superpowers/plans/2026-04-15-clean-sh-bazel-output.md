# Clean.sh Bazel Output Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make default `./scripts/clean.sh` remove the Bazel local output tree for the current workspace without touching shared Bazel caches or other worktrees.

**Architecture:** Add one workspace-local Bazel output-base derivation helper to `scripts/clean.sh`, then route the existing `remove()` helper through that path so the cleanup behavior stays simple and `--dry` continues to work. Cover the behavior with a dedicated shell test that creates a fake workspace-local Bazel output-base, verifies default cleanup removes it, and verifies `--dry` only reports it.

**Tech Stack:** Bash, macOS `md5`, repo shell-script testing pattern

---

## File Structure

- Modify: `scripts/clean.sh`
  - Add workspace-local Bazel output-base derivation
  - Remove that directory by default
  - Update usage comments to describe Bazel cleanup
- Create: `scripts/clean.sh.test.sh`
  - Shell regression test covering default cleanup and `--dry`

### Task 1: Add a failing shell regression test for workspace-local Bazel cleanup

**Files:**
- Create: `scripts/clean.sh.test.sh`
- Test: `scripts/clean.sh.test.sh`

- [ ] **Step 1: Write the failing test**

Create `scripts/clean.sh.test.sh` with this content:

```bash
#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/clean.sh"
TMPDIR_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

WORKSPACE="$TMPDIR_ROOT/workspace"
mkdir -p "$WORKSPACE/.build" "$WORKSPACE/apps/desktop/src-tauri/target"

USER_NAME="${USER:-$(id -un)}"
OUTPUT_BASE_HASH="$(printf %s "$WORKSPACE" | md5)"
BAZEL_OUTPUT_BASE="$HOME/Library/Caches/bazel/_bazel_${USER_NAME}/${OUTPUT_BASE_HASH}"
mkdir -p "$BAZEL_OUTPUT_BASE/execroot/_main/bazel-out"
printf 'artifact\n' > "$BAZEL_OUTPUT_BASE/execroot/_main/bazel-out/fake.txt"

SHARED_DISK_CACHE="$HOME/Library/Caches/bazel-disk-cache"
SHARED_REPO_CACHE="$HOME/Library/Caches/bazel-repository-cache"
mkdir -p "$SHARED_DISK_CACHE" "$SHARED_REPO_CACHE"
printf 'keep\n' > "$SHARED_DISK_CACHE/keep.txt"
printf 'keep\n' > "$SHARED_REPO_CACHE/keep.txt"

run_clean() {
  local cwd="$1"
  shift
  (
    cd "$cwd"
    bash "$SCRIPT" "$@"
  )
}

DRY_OUTPUT="$(run_clean "$WORKSPACE" --dry)"
if [[ "$DRY_OUTPUT" != *"$BAZEL_OUTPUT_BASE"* ]]; then
  printf 'expected --dry output to mention bazel output base, got:\n%s\n' "$DRY_OUTPUT" >&2
  exit 1
fi

if [ ! -d "$BAZEL_OUTPUT_BASE" ]; then
  printf 'expected --dry run to leave bazel output base intact\n' >&2
  exit 1
fi

run_clean "$WORKSPACE"

if [ -d "$BAZEL_OUTPUT_BASE" ]; then
  printf 'expected default clean to remove bazel output base: %s\n' "$BAZEL_OUTPUT_BASE" >&2
  exit 1
fi

if [ -d "$WORKSPACE/.build" ]; then
  printf 'expected clean to remove .build\n' >&2
  exit 1
fi

if [ -d "$WORKSPACE/apps/desktop/src-tauri/target" ]; then
  printf 'expected clean to remove src-tauri target\n' >&2
  exit 1
fi

if [ ! -f "$SHARED_DISK_CACHE/keep.txt" ]; then
  printf 'expected shared bazel disk cache to remain intact\n' >&2
  exit 1
fi

if [ ! -f "$SHARED_REPO_CACHE/keep.txt" ]; then
  printf 'expected shared bazel repository cache to remain intact\n' >&2
  exit 1
fi
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bash scripts/clean.sh.test.sh
```

Expected: FAIL because `scripts/clean.sh` does not yet report or remove the current workspace Bazel output-base.

- [ ] **Step 3: Commit the failing test**

Run:

```bash
git add scripts/clean.sh.test.sh
git commit -m "test: cover workspace bazel cleanup in clean.sh"
```

### Task 2: Implement workspace-local Bazel cleanup in `scripts/clean.sh`

**Files:**
- Modify: `scripts/clean.sh`
- Test: `scripts/clean.sh.test.sh`

- [ ] **Step 1: Write the minimal implementation**

Update `scripts/clean.sh` to:

```bash
#!/bin/bash
# Clean Tauri/Rust/Bazel build artifacts to reclaim disk space.
#
# Usage:
#   ./scripts/clean.sh          # clean Rust target dirs + local Bazel output
#   ./scripts/clean.sh --all    # also remove node_modules, dist, .turbo
#   ./scripts/clean.sh --dry    # show what would be removed and sizes
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

ALL=false
DRY=false

for arg in "$@"; do
  case "$arg" in
    --all) ALL=true ;;
    --dry) DRY=true ;;
    -h|--help)
      sed -n '2,6p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
  esac
done

cleaned=0

remove() {
  local path="$1"
  if [ -e "$path" ]; then
    local size
    size="$(du -sh "$path" 2>/dev/null | cut -f1)"
    if $DRY; then
      echo "[dry run] would remove $path ($size)"
    else
      echo "removing $path ($size)"
      rm -rf "$path"
    fi
    cleaned=1
  fi
}

bazel_output_base() {
  local user_name hash

  if ! command -v md5 >/dev/null 2>&1; then
    echo "error: md5 is required to derive the Bazel output base" >&2
    exit 1
  fi

  user_name="${USER:-$(id -un)}"
  hash="$(printf %s "$ROOT" | md5)"
  printf '%s/Library/Caches/bazel/_bazel_%s/%s\n' "$HOME" "$user_name" "$hash"
}

# Rust build output (.cargo/config.toml sets target-dir = ".build")
remove "$ROOT/.build"
# Tauri CLI runs cargo from apps/desktop/src-tauri/, which uses default target dir
remove "$ROOT/apps/desktop/src-tauri/target"
# Bazel local output base for this workspace only
remove "$(bazel_output_base)"

if $ALL; then
  # Frontend build output
  remove "$ROOT/apps/desktop/dist"

  # Node modules
  remove "$ROOT/node_modules"
  remove "$ROOT/apps/desktop/node_modules"
  remove "$ROOT/packages/core/node_modules"
  remove "$ROOT/packages/db/node_modules"

  # Turbo cache
  remove "$ROOT/.turbo"
fi

if [ "$cleaned" -eq 0 ]; then
  echo "nothing to clean"
elif $DRY; then
  echo ""
  echo "run without --dry to remove"
fi
```

- [ ] **Step 2: Run the focused shell test to verify it passes**

Run:

```bash
bash scripts/clean.sh.test.sh
```

Expected: PASS with no output.

- [ ] **Step 3: Run a direct dry-run check against the real workspace**

Run:

```bash
bash scripts/clean.sh --dry
```

Expected:
- reports `.build` and `apps/desktop/src-tauri/target` when present
- reports the current workspace’s Bazel output-base path when present
- does not mention `bazel-disk-cache` or `bazel-repository-cache`

- [ ] **Step 4: Commit the implementation**

Run:

```bash
git add scripts/clean.sh scripts/clean.sh.test.sh
git commit -m "feat: clean workspace bazel outputs"
```

### Task 3: Final verification

**Files:**
- Modify: none
- Test: `scripts/clean.sh.test.sh`

- [ ] **Step 1: Re-run the shell regression test**

Run:

```bash
bash scripts/clean.sh.test.sh
```

Expected: PASS with no output.

- [ ] **Step 2: Review the diff for cleanup scope**

Run:

```bash
git diff -- scripts/clean.sh scripts/clean.sh.test.sh
```

Expected:
- only current-workspace Bazel output-base is targeted
- shared Bazel cache paths are never removed
- `--dry` still reports removals instead of deleting them

- [ ] **Step 3: Record completion**

Run:

```bash
git status --short
```

Expected:
- only the intended script and test file changes are present
```
