# Agent CLI Setup Check

## Problem

When a user first launches Kanna, they may not have the Claude or Copilot CLIs installed. The app currently gives no feedback until they try to create a task, at which point a generic toast error appears with no installation guidance. The large empty main panel on first launch is an ideal place to surface CLI availability and guide installation.

## Design

### CLI Detection

On mount of the empty state (no repos added), the app calls the existing `which_binary` Tauri command for both `"claude"` and `"copilot"`. For each CLI found, a follow-up `run_script` call runs `<binary> --version` and extracts the semver with `/(\d+\.\d+\.\d+)/`.

Reactive state per agent:

```typescript
interface AgentCliStatus {
  installed: boolean
  version?: string  // semver only, e.g. "2.1.85"
}
```

### Empty State UI

The existing empty state in `MainPanel.vue` (lines 59-67) currently shows "No repos" text. When `!hasRepos`, this is replaced with the agent setup view:

**Layout:** Two agent cards stacked vertically, centered in the main panel.

**Card — not installed:**
- Agent name (e.g., "Claude Code", "GitHub Copilot")
- Install command in a monospace block: `curl -fsSL https://claude.ai/install.sh | bash` (or `curl -fsSL https://gh.io/copilot-install | bash`)
- Copy-to-clipboard icon button next to the command
- Hint below: "Press `⇧⌘J` to open a shell, and again to close it."

**Card — installed:**
- Agent name
- Green checkmark
- Version (e.g., `v2.1.85`)

Both cards are always visible. Mixed states are expected (e.g., Claude installed, Copilot not).

Below the agent cards, the existing "Import a repo" hint (`⌘I`) is preserved so users know the next step after installing CLIs. The full empty state layout top-to-bottom: agent cards → "Import a repo" hint.

### Shell at `~` (No Repo Context)

The `⇧⌘J` shortcut currently gates on `store.selectedRepo`. When no repo is selected, the shortcut opens ShellModal with `cwd: $HOME` instead of returning early.

Changes:
- `openShellRepoRoot` handler in `App.vue` (line 483): remove the `if (!store.selectedRepo) return` guard. When `store.selectedRepo` is null, compute cwd as `$HOME` (from `read_env_var("HOME")`).
- ShellModal and daemon `spawn_session` already accept arbitrary cwd — no changes needed there.
- The `$HOME` value is fetched once on app mount and cached.

### Re-check on Shell Close

When ShellModal emits `close`, the empty state component re-runs CLI detection (both `which_binary` calls + version extraction). If a previously missing CLI is now found, the card updates live from install instructions to checkmark + version.

This re-check only runs when the empty state is mounted (no repos). Once repos are added, the empty state unmounts and there's no re-checking.

## Scope

### In scope
- CLI detection via existing `which_binary` + `run_script` commands
- Version extraction (semver only) from `--version` output
- Empty state UI with agent cards (install instructions or installed status)
- Copy-to-clipboard for install commands
- `⇧⌘J` opens shell to `$HOME` when no repo selected
- Auto re-check on ShellModal close

### Out of scope
- CLI detection after repos are added (only empty state)
- Task creation guard (helpful error when trying to use missing CLI)
- Preferences for custom CLI paths
- Auto-installation (user runs the command themselves)
- Copilot binary discovery in Rust SDK (not needed — PTY mode spawns via shell which already has PATH)

## Files to Modify

| File | Change |
|------|--------|
| `apps/desktop/src/components/MainPanel.vue` | Replace no-repos empty state with agent setup view, add CLI detection logic, copy button, re-check on shell close |
| `apps/desktop/src/App.vue` | Remove `selectedRepo` guard from `openShellRepoRoot`, compute `$HOME` fallback cwd |
| `apps/desktop/src/i18n/locales/en.json` | Add strings for agent card labels, install hint, shell hint |
| `apps/desktop/src/i18n/locales/ja.json` | Add corresponding Japanese strings |
| `apps/desktop/src/i18n/locales/ko.json` | Add corresponding Korean strings |

## Implementation Notes

- `which_binary` returns an error string when the binary isn't found — treat any error as "not installed"
- `copilot --version` outputs certificate warnings on stderr — `run_script` should capture stdout only, or the semver regex handles the noise
- The copy-to-clipboard uses `navigator.clipboard.writeText()` — standard web API, no Tauri command needed
- `read_env_var("HOME")` is an existing Tauri command in `fs.rs`
