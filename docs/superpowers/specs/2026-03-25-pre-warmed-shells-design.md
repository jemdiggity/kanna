# Pre-warmed Shell Terminals

## Problem

When a user presses `⌘J` (worktree shell) or `⇧⌘J` (repo root shell), zsh startup takes 200ms–2s depending on `.zshrc` complexity (nvm, rbenv, pyenv, etc.). The shell should be instant.

## Solution

Pre-spawn idle zsh PTY sessions in the daemon so they're already running when the user opens a shell modal. The daemon already supports this pattern: `Spawn` creates a session, `PreAttachBuffer` (64 KB) captures startup output, and `useTerminal`'s attach-first logic connects to existing sessions.

No daemon changes required.

## Session ID Convention

Matches the existing IDs generated in `App.vue` line 677:

```
`shell-${shellRepoRoot ? 'repo' : 'wt'}-${store.currentItem?.id ?? 'repo'}`
```

- **Per-task worktree shell:** `shell-wt-${taskId}` — cwd is the task's worktree path
- **Repo root shell:** `shell-repo-${taskId}` when a task is selected, `shell-repo-repo` when no task is selected — cwd is always the repo root path

Note: The repo root shell ID is task-scoped (tied to whichever task is selected when `⇧⌘J` is pressed), not repo-scoped. This is the existing convention in `App.vue` and we preserve it. Since a task is almost always selected, the most common repo root shell ID is `shell-repo-${taskId}`. Pre-warming spawns `shell-repo-${taskId}` for each active task (same loop as worktree shells) to cover this primary case.

## Pre-spawn Trigger Points

### Per-task shell

In `setupWorktreeAndSpawn()` (kanna.ts), after `createWorktree()` succeeds and before the agent PTY spawn. Fire-and-forget — not awaited, runs in parallel with the agent spawn:

```
spawnShellSession(`shell-wt-${id}`, worktreePath, JSON.stringify(portEnv))
  .catch(e => console.error("[store] shell pre-warm failed:", e));
```

### App startup (existing tasks + repo root)

At the end of `store.init()`, after repos and items are loaded and selection is restored (line ~1113 of kanna.ts). At this point the daemon is ready — `init()` has already made successful `invoke` calls (e.g., `git_app_info`). The pre-warm logic:

```typescript
// Pre-warm shell sessions for active tasks with worktrees
for (const item of eagerItems) {
  if (!item.branch) continue;
  const repo = eagerRepos.find(r => r.id === item.repo_id);
  if (!repo) continue;
  const wtPath = `${repo.path}/.kanna-worktrees/${item.branch}`;
  spawnShellSession(
    `shell-wt-${item.id}`, wtPath, item.port_env, true
  ).catch(e => console.error("[store] shell pre-warm failed:", e));
}

// Pre-warm repo root shells (one per task, same loop)
for (const item of eagerItems) {
  if (!item.branch) continue;
  const repo = eagerRepos.find(r => r.id === item.repo_id);
  if (!repo) continue;
  spawnShellSession(
    `shell-repo-${item.id}`, repo.path, null, false
  ).catch(e => console.error("[store] repo shell pre-warm failed:", e));
}
```

All spawns are fire-and-forget. The daemon rejects duplicate session IDs, providing natural dedup for sessions that survived handoff.

### Repo switch

When `selectedRepoId` changes, spawn a new `shell-repo-repo` session for the new repo (kill the old one first).

## Shared Helper

Extract env-building logic from `ShellModal.spawnShell` into a reusable function in the store, since both the pre-spawn and the fallback spawn need the same env:

```typescript
async function spawnShellSession(
  sessionId: string,
  cwd: string,
  portEnv?: string | null,
  isWorktree = true,
): Promise<void> {
  const env: Record<string, string> = { TERM: "xterm-256color" };
  if (isWorktree) env.KANNA_WORKTREE = "1";
  if (portEnv) {
    try {
      Object.assign(env, JSON.parse(portEnv));
    } catch (e) {
      console.error("[store] failed to parse portEnv:", e);
    }
  }
  try {
    env.ZDOTDIR = await invoke<string>("ensure_term_init");
  } catch (e) {
    console.error("[store] failed to set up term init:", e);
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

## Attach Behavior: Clear+SIGWINCH

When `useTerminal` attaches to an existing session, it writes `\x1b[?25l\x1b[2J\x1b[H` (clear display) then does a SIGWINCH double-resize. This exists for Claude TUI reconnection. For pre-warmed shells:

1. Daemon flushes `PreAttachBuffer` (zsh startup output + prompt) as `Output` events via the async event bridge
2. `useTerminal` synchronously writes the clear-screen sequence to xterm.js
3. SIGWINCH fires, zsh redraws the prompt

Because the buffer flush is async (Tauri event bridge) and the clear is synchronous, the prompt arrives after the clear — the user sees the prompt appear cleanly. If there's a minor visual flash, it's sub-frame and acceptable. No changes to `useTerminal` needed.

## ShellModal Changes

`ShellModal.spawnShell` becomes a thin wrapper around the shared `spawnShellSession` helper. It serves as the fallback path if attach fails (e.g., daemon restarted and lost sessions).

## Cleanup

### Existing bug: kill session ID mismatch

The store currently uses `shell-${item.id}` in kill calls (kanna.ts:584, 598, 780, 992), but `ShellModal` uses `shell-wt-${item.id}`. These kill calls are silently failing today — no shell sessions are actually being cleaned up. Fix all kill calls to use `shell-wt-${item.id}`.

### Task close/delete/merge

After fixing the ID mismatch above, the existing kill calls handle cleanup.

### Repo root shell

Kill `shell-repo-repo` when switching repos (before spawning the new one).

### Worktree deletion

When a task's worktree is removed (close/delete/merge paths in the store), the pre-warmed shell for that task is killed by the existing `kill_session` call (once the ID mismatch is fixed). No additional cleanup needed.

### Daemon restart / handoff

Pre-warmed shells are normal daemon sessions. They survive `SCM_RIGHTS` handoff. On app startup after handoff, duplicate Spawn calls fail harmlessly — the daemon rejects duplicate session IDs, and the existing session is reused via attach.

## Resource Usage

Each idle zsh process uses ~1 MB of memory and one PTY fd pair. A user with 20 active tasks would have ~20 idle zsh processes plus the repo root shell — roughly 21 MB total. This is negligible. No pool limit or LRU eviction needed.

## Edge Cases

### Shell exits before user opens modal

If the pre-warmed zsh exits (e.g., `.zshrc` error), the daemon sends `session_exit`. When the user later presses `⌘J`, attach fails, `useTerminal` falls back to spawning fresh. No special handling needed.

### Task without worktree

Pre-spawn only fires after `createWorktree()` succeeds. At startup, tasks without a `branch` field are skipped.

### Concurrent spawns

The agent PTY spawn (`${id}`) and shell pre-spawn (`shell-wt-${id}`) use different session IDs. No conflict.

### Worktree deleted while shell is alive

If a worktree is garbage-collected or manually deleted, the pre-warmed shell has a stale cwd. The shell still functions — the user gets a prompt in a deleted directory and can `cd` elsewhere. Worktree removal via the store's close/delete paths kills the shell session as part of cleanup.

## Files to Modify

- `apps/desktop/src/stores/kanna.ts` — add `spawnShellSession` helper, call it in `setupWorktreeAndSpawn()`, add startup pre-warm in `init()`, add repo-switch pre-warm, fix kill session IDs from `shell-${id}` to `shell-wt-${id}`
- `apps/desktop/src/components/ShellModal.vue` — use shared `spawnShellSession` helper as fallback
- `apps/desktop/src/App.vue` — no changes needed (session IDs and ShellModal props are already correct)
