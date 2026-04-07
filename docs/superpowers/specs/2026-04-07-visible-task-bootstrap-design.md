# Visible Task Bootstrap Design

## Goal

When a user creates a PTY task or advances a PTY task to the next stage, the main task terminal should show the full bootstrap sequence immediately: git fetch, git worktree creation, repo-owned worktree setup, and then the agent process. Users should not wait through a blank UI period before `Running startup...` appears.

## Current Problem

The current PTY task flow creates the task row first and then runs worktree creation in the background from store code. The terminal is only selected after worktree creation and `spawn_session` complete, so the user sees a delay with no shell output. Kanna-specific `.build` copying is also embedded in the generic Rust `git_worktree_add` command, so that work is invisible and happens at the wrong architectural layer.

## Proposed Design

### Single visible bootstrap session for PTY tasks

For PTY-backed tasks, `createItem()` will still insert the task row immediately, but the background setup path will change:

- Spawn the daemon PTY session early, before the worktree exists.
- Start the session in the repo root or base worktree root.
- Run a generated shell bootstrap script that:
  - prints the bootstrap steps,
  - performs git fetch when needed,
  - creates the worktree,
  - `cd`s into the new worktree,
  - runs repo-owned setup commands,
  - launches the selected agent CLI.

The session id remains the task id, so the user sees one continuous terminal story instead of a hidden setup phase followed by a later session attach.

### PTY vs SDK split

Only PTY tasks use the visible bootstrap shell path. SDK tasks keep the current background worktree-then-session flow because they are headless and not user-driven terminals.

### Repo-owned worktree setup

Kanna-specific `.build` preparation moves out of the generic Rust `git_worktree_add` command. This repo will own that behavior through a visible setup command in `.kanna/config.json`, backed by a repo script. That keeps the Tauri git command generic and makes all repo-specific preparation visible in the terminal.

## File/Responsibility Changes

- `apps/desktop/src/stores/kanna.ts`
  - Branch PTY task creation into a visible bootstrap path.
  - Build and launch the bootstrap shell command before selecting the task.
  - Keep SDK task creation on the current background path.
- `apps/desktop/src/utils/taskBootstrap.ts`
  - New pure helper for building the visible bootstrap shell command and shell-escaped step rendering.
- `apps/desktop/src/utils/taskBootstrap.test.ts`
  - Unit tests for the generated bootstrap command sequence.
- `apps/desktop/src-tauri/src/commands/git.rs`
  - Remove Kanna-specific `.build` copy from `git_worktree_add`.
- `.kanna/config.json`
  - Add visible repo-owned worktree setup step before `bun install`.
- `scripts/setup-worktree.sh`
  - New repo script to prepare `.build` inside a newly created worktree.

## Data Flow

For PTY tasks:

1. User creates task or advances stage.
2. Store inserts the task row and marks it pending.
3. Store spawns a PTY session in the repo root with a generated bootstrap script.
4. Store selects the new task immediately after the daemon session exists.
5. Terminal attaches to the already-existing session and renders:
   - git fetch,
   - git worktree add,
   - worktree `cd`,
   - repo setup commands,
   - agent launch.
6. Once bootstrap finishes, the same session remains attached for normal agent output.

For SDK tasks, behavior stays unchanged.

## Error Handling

- Bootstrap shell failures should remain visible in the terminal output because the terminal now owns the full path.
- Store-level toasts remain appropriate for failures before session spawn, such as DB insertion or daemon spawn failures.
- Git fetch should preserve the current fallback behavior for offline/no-remote repositories.

## Testing

- Add unit tests for the bootstrap command helper to verify:
  - new tasks include visible fetch + worktree creation,
  - stage-advance tasks skip fetch and use `HEAD`,
  - repo setup commands run after `cd` into the worktree,
  - agent launch happens after setup commands.
- Run existing targeted tests around terminal spawn options and task lifecycle to confirm no PTY regression.

## Notes

- This change intentionally does not try to surface generic git setup for SDK sessions because those are not interactive terminals.
- The immediate UX improvement comes from making the PTY session exist before the expensive shell work begins.
