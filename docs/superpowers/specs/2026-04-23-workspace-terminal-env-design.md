# Workspace Terminal Env Config

## Problem

`.kanna/config.json` currently supports setup commands and port reservations, but it does not have a first-class way to define reusable environment variables or `PATH` changes for task workspaces.

That leaves users with two bad options:

- bake env mutations into ad-hoc `setup` shell commands, which only affect that bootstrap shell
- duplicate terminal setup manually after opening a shell in the worktree

This breaks the expectation that a task workspace should have a consistent runtime environment across all Kanna-launched terminals for that task.

## Goal

Allow repository config to define workspace-scoped environment variables and `PATH` mutations that apply to every worktree terminal Kanna launches for a task.

## Non-Goals

- Replacing task-scoped port allocation in `port_env`
- Changing repo-root shells that are not worktree sessions
- Adding shell-specific config sourcing or login-profile mutation
- Supporting arbitrary variable interpolation beyond path resolution

## Proposed Change

Extend `.kanna/config.json` with a new `workspace` section:

```json
{
  "workspace": {
    "env": {
      "FOO": "bar"
    },
    "path": {
      "prepend": ["./bin"],
      "append": ["vendor/tools"]
    }
  }
}
```

Behavior:

- `workspace.env` adds string-valued environment variables to worktree sessions
- `workspace.path.prepend` resolves entries relative to the current worktree root and prepends them to `PATH`
- `workspace.path.append` resolves entries relative to the current worktree root and appends them to `PATH`
- these values are layered on top of existing task runtime env such as `KANNA_WORKTREE`, `KANNA_*` metadata, and allocated ports

## Design Details

### Config Shape

Add these optional fields to `RepoConfig`:

- `workspace.env?: Record<string, string>`
- `workspace.path?: { prepend?: string[]; append?: string[] }`

Parsing rules:

- ignore non-string env values
- ignore `prepend` or `append` when they are not arrays of strings
- omit the `workspace` object entirely when nothing valid is present

### Path Resolution

`workspace.path` entries should be normalized against the active worktree path:

- absolute paths remain unchanged
- relative paths are resolved against the worktree root

The resulting `PATH` should preserve the inherited shell PATH between prepended and appended entries:

`<prepend entries>:<existing PATH>:<append entries>`

Empty or missing `PATH` falls back to just the configured entries that exist in that direction.

### Shared Session Env Builder

Introduce a shared helper that accepts:

- worktree path
- parsed repo config for that worktree
- task `portEnv`
- base runtime env

It returns a merged environment for all worktree-backed sessions.

That helper should be used in:

- PTY task agents
- SDK task agents
- worktree shell sessions, including prewarmed shells

This keeps environment ownership in one place and prevents PTY, SDK, and shell flows from drifting.

### Layering Order

Final environment precedence should be:

1. base terminal/session env
2. `workspace.env`
3. `workspace.path`-derived `PATH`
4. task `portEnv`
5. Kanna runtime metadata such as `KANNA_WORKTREE`, `KANNA_TASK_ID`, and `KANNA_CLI_*`

This preserves task-specific port claims and Kanna metadata as authoritative while still allowing workspace-level customization.

### Error Handling

- missing `.kanna/config.json` remains non-fatal and resolves to an empty config
- invalid workspace fields are ignored instead of failing config parse
- relative path resolution is pure string/path handling and should not require the target paths to exist

## Testing

Add or update tests to verify:

- repo config parser accepts valid `workspace.env` and `workspace.path`
- parser ignores malformed workspace values
- PTY session env includes workspace env vars and resolved PATH mutations
- SDK session env includes the same workspace env vars and resolved PATH mutations
- shell sessions opened for worktrees receive the same workspace env

## Risks

- Any place that bypasses the shared session helper could drift and miss workspace env behavior
- PATH ordering mistakes could shadow system binaries or break user expectations

## Recommendation

Implement the smallest explicit schema that matches the requirement:

- add `workspace.env` and `workspace.path`
- resolve relative path entries against the task worktree
- build the merged env once and reuse it across PTY, SDK, and shell worktree sessions
