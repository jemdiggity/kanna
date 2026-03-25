# Pre-warmed Shell Terminals

## Problem

When a user presses `⌘J` (worktree shell) or `⇧⌘J` (repo root shell), zsh startup takes 200ms–2s depending on `.zshrc` complexity (nvm, rbenv, pyenv, etc.). The shell should be instant.

## Solution

Pre-spawn idle zsh PTY sessions in the daemon so they're already running when the user opens a shell modal. The daemon already supports this pattern: `Spawn` creates a session, `PreAttachBuffer` (64 KB) captures startup output, and `useTerminal`'s attach-first logic connects to existing sessions.

No daemon changes required.

## Session ID Convention

- **Per-task worktree shell:** `shell-wt-${taskId}` — cwd is the task's worktree path
- **Repo root shell:** `shell-repo-${repoId}` — cwd is the repo root path

These match the existing IDs used by `ShellModal` in `App.vue`.

## Pre-spawn Trigger Points

### Per-task shell

In `setupWorktreeAndSpawn()` (kanna.ts), after `createWorktree()` succeeds and before the agent PTY spawn. Fire-and-forget — not awaited, runs in parallel with the agent spawn:

```
spawnShellSession(`shell-wt-${id}`, worktreePath, JSON.stringify(portEnv))
  .catch(e => console.error("[store] shell pre-warm failed:", e));
```

### Repo root shell

On app startup, after the daemon is confirmed ready and repos are loaded, spawn `shell-repo-${repoId}` for the selected repo. Re-spawn on repo switch.

### App startup (existing tasks)

After daemon ready, iterate active tasks that have worktrees and spawn `shell-wt-${taskId}` for any that don't already exist in the daemon. The daemon returns an error for duplicate session IDs, providing natural dedup.

## Shared Helper

Extract env-building logic from `ShellModal.spawnShell` into a reusable function, since both the pre-spawn and the fallback spawn need the same env:

```typescript
async function spawnShellSession(
  sessionId: string,
  cwd: string,
  portEnv?: string | null,
): Promise<void> {
  const env: Record<string, string> = {
    TERM: "xterm-256color",
    KANNA_WORKTREE: "1",
  };
  if (portEnv) {
    try { Object.assign(env, JSON.parse(portEnv)); } catch {}
  }
  try {
    env.ZDOTDIR = await invoke<string>("ensure_term_init");
  } catch (e) {
    console.error("[shell] failed to set up term init:", e);
  }
  await invoke("spawn_session", {
    sessionId,
    cwd,
    executable: "/bin/zsh",
    args: ["--login"],
    env,
    cols: 80,
    rows: 24,
  });
}
```

## Terminal Dimensions

Pre-spawned with 80x24 defaults. When the user opens the modal, `useTerminal` attaches and immediately calls `resize_session` with the actual terminal dimensions. The shell adapts via SIGWINCH. This already works for reattached sessions today.

## ShellModal Changes

`ShellModal.spawnShell` becomes a thin wrapper around the shared `spawnShellSession` helper. It serves as the fallback path if attach fails (e.g., daemon restarted and lost sessions).

## Cleanup

### Task close/delete/merge

The store already kills shell sessions on these operations (kanna.ts:584, 598, 780, 992). Update the session ID pattern from `shell-${item.id}` to `shell-wt-${item.id}` to match the actual convention.

### Repo root shell

Kill `shell-repo-${repoId}` when switching repos.

### Daemon restart / handoff

Pre-warmed shells are normal daemon sessions. They survive `SCM_RIGHTS` handoff. On app startup after handoff, duplicate Spawn calls fail harmlessly — the daemon rejects duplicate session IDs, and the existing session is reused via attach.

## Edge Cases

### Shell exits before user opens modal

If the pre-warmed zsh exits (e.g., `.zshrc` error), the daemon sends `session_exit`. When the user later presses `⌘J`, attach fails, `useTerminal` falls back to spawning fresh. No special handling needed.

### Task without worktree

Pre-spawn only fires after `createWorktree()` succeeds. No worktree, no pre-warm.

### Concurrent spawns

The agent PTY spawn (`${id}`) and shell pre-spawn (`shell-wt-${id}`) use different session IDs. No conflict.

## Files to Modify

- `apps/desktop/src/stores/kanna.ts` — add `spawnShellSession` helper, call it in `setupWorktreeAndSpawn()`, add startup pre-warm logic, fix kill session IDs
- `apps/desktop/src/components/ShellModal.vue` — use shared helper as fallback
- `apps/desktop/src/App.vue` — trigger repo root pre-warm on startup and repo switch
