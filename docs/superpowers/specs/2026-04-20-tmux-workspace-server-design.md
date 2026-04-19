# Tmux Workspace Server Design

## Goal

Give each Kanna workspace its own tmux server, not just its own tmux session name, so worktree dev environments stop sharing the default global tmux server.

## Problem

Today `scripts/dev.sh` derives a per-worktree tmux session name such as `kanna-task-1234`, but every tmux command still talks to the default tmux server because the script invokes plain `tmux ...` without selecting a server.

That leaves an architectural mismatch:

- worktree database, daemon, transfer root, and ports are workspace-scoped
- tmux session naming is workspace-scoped
- tmux server state is still global

The result is partial isolation. Different workspaces can still observe or interfere through the same tmux server, which is the opposite of the repo's stated worktree-isolation model.

## Desired Outcome

Tmux should follow the same isolation rule as the rest of the worktree runtime:

- the main checkout uses its own tmux server
- each worktree uses its own tmux server
- the server name should match the resolved tmux session name
- all `scripts/dev.sh` operations for a workspace should consistently target that workspace-local server

This includes:

- `start`
- `stop`
- `restart`
- `log`
- `--mobile`
- `--attach`

## Approach Options

### Option 1: Select the tmux server with `tmux -L "$SESSION"`

Use the existing resolved `SESSION` value as both:

- the tmux server name via `-L`
- the tmux session name inside that server

Pros:

- matches the requested behavior exactly
- minimal change to the current script model
- preserves existing session-name derivation and `KANNA_TMUX_SESSION` behavior
- easy to reason about in tests because the server name and session name are identical

Cons:

- duplicates the same identifier at two tmux layers
- requires touching every tmux call site so none accidentally falls back to the global server

### Option 2: Select the tmux server with an explicit socket path via `tmux -S <path>`

Derive a socket file path from the workspace and use that instead of `-L`.

Pros:

- explicit socket location
- stronger filesystem-level separation

Cons:

- more path management than the requirement needs
- broader test surface
- not what the requested UX asked for

### Option 3: Keep one tmux server and keep only per-session naming

Continue using the global server and rely on unique session names.

Pros:

- no substantive implementation work

Cons:

- does not solve the requested problem
- keeps tmux as the odd one out in Kanna's workspace isolation model

## Recommended Design

Use Option 1.

### Server identity

Keep the current session derivation logic:

- `KANNA_TMUX_SESSION` overrides when explicitly set
- otherwise worktrees resolve `kanna-<worktree-name>`
- otherwise the main checkout resolves `kanna`

Then derive:

- `SESSION=<canonicalized name>`
- `TMUX_SERVER=$SESSION`

Canonicalization stays exactly where it is today so the same sanitized identifier is used consistently for both the server and the session.

### Tmux command boundary

Introduce one small wrapper in `scripts/dev.sh` so tmux server selection is centralized, for example:

```bash
tmux_cmd() {
  tmux -L "$TMUX_SERVER" "$@"
}
```

After this change, every tmux interaction in the script must go through that wrapper rather than calling `tmux` directly.

That includes:

- `has-session`
- `new-session`
- `new-window`
- `set-option`
- `list-windows`
- `send-keys`
- `kill-session`
- `capture-pane`
- `attach`

The key design rule is simple: `scripts/dev.sh` should never accidentally address the default tmux server.

### Behavior by command

`start`

- checks for an existing session only inside the workspace's tmux server
- starts the desktop window in that same server
- starts the mobile window in that same server when `--mobile` is enabled

`stop`

- looks for the workspace session only inside the workspace's tmux server
- sends Ctrl-C and kills the session in that server only

`log`

- captures panes only from the workspace's tmux server

`restart`

- remains a `stop` followed by `start`, but both operations now target the same isolated server

`--attach`

- attaches to the workspace's isolated server instead of the global default

### Scope boundary

This design changes only the tmux control plane for the dev launcher. It does not change:

- daemon isolation
- DB naming
- transfer-root resolution
- worktree detection
- port derivation
- mobile server URL derivation

Those remain as they are today.

## Files Expected To Change

- `scripts/dev.sh`
- `scripts/dev.sh.test.sh`
- `AGENTS.md` only if the checked-in workflow docs need to explicitly mention separate tmux servers rather than just separate tmux session names

## Testing Strategy

1. Script regression tests

- extend the fake tmux harness in `scripts/dev.sh.test.sh` to accept and log `-L <server>`
- assert `new-session`, `new-window`, `set-option`, `has-session`, `capture-pane`, `kill-session`, `list-windows`, `send-keys`, and `attach` all include the expected server name
- keep existing assertions for session naming so the server name and session name remain aligned

2. Isolation coverage

- add a test shape that starts multiple worktrees and verifies tmux commands are scoped by server name, not just by session lookup in one shared state bucket
- ensure operations on one worktree do not depend on sessions created in another worktree's server

3. Runtime validation

- run `scripts/dev.sh.test.sh`
- manually verify `./scripts/dev.sh start`, `./scripts/dev.sh log`, and `./scripts/dev.sh stop` in a worktree still behave correctly with the isolated server

## Risks

### Risk: partial migration leaves one raw tmux call behind

If even one call site still uses plain `tmux`, behavior becomes inconsistent and difficult to debug. Centralizing invocation through a wrapper keeps this risk manageable.

### Risk: fake tmux harness does not model per-server state correctly

The current shell test harness tracks sessions globally. It needs a small structural update so session existence is keyed by server as well as session name, otherwise the tests would not actually prove the new isolation behavior.

### Risk: user muscle memory around manual `tmux attach`

After this change, the printed attach command needs to remain explicit and correct. It should show `tmux -L <server> attach -t <session>` rather than suggesting the default server.

## Success Criteria

- each workspace uses its own tmux server
- the tmux server name matches the resolved session name
- `scripts/dev.sh` never talks to the default shared tmux server during normal workspace operations
- `--mobile`, `log`, `stop`, and `attach` continue to work against the correct workspace runtime
- shell tests prove server-scoped isolation rather than only session-name isolation
