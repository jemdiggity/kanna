# AGENTS.md

## Project

Kanna — Tauri v2 desktop app for managing coding agent tasks (Claude Code, GitHub Copilot). Vue 3 frontend, Rust backend, SQLite database. Public repository hosted on GitHub.

Kanna is a product distributed to end users as a signed macOS app. All dependencies must be vendored or statically linked — never depend on libraries installed on the build machine (e.g., Homebrew). Release builds must run on any Mac without developer tools installed.

**Target user:** Software developers who use coding agents (Claude Code, GitHub Copilot) and want to run multiple agent tasks in parallel without juggling terminals and branches.

## Product Behavior

### Core concepts

- **Task** — A unit of work. Has a prompt, a git worktree, a Claude agent session, and a lifecycle stage. One task = one branch = one PR.
- **Pipeline** — User-definable agentic pipeline: an ordered list of stages, each with an agent and an optional environment. Defined in `.kanna/pipelines/*.json`. Default: `in progress → pr`. Advancing a stage closes the current task and creates a new task with the next stage's agent in a new worktree.
- **Daemon** — Standalone process that manages PTY sessions. Survives app restarts. Handles seamless upgrades via fd handoff.

### Workflows

**Create a task:**
1. Cmd+N → enter prompt (choose Claude or Copilot agent)
2. App creates git worktree (`{repo}/.kanna-worktrees/task-{uuid}`)
3. Runs `.kanna/config.json` setup scripts if present (e.g., `bun install`)
4. Spawns agent CLI in the worktree via daemon
5. Agent starts working. User watches in real-time terminal.

**Review and merge:**
1. Agent finishes → task marked as unread (bold in sidebar)
2. User selects task, presses Cmd+D → diff modal shows all branch changes
3. Optionally Cmd+P → file picker → preview, Cmd+O → open in IDE, or Cmd+J → shell in worktree
4. Cmd+S → create GitHub PR, task tagged `pr`
5. Cmd+M → merge PR, task tagged `merge`

**Manual intervention:**
1. Cmd+J → shell modal opens in the task's worktree
2. Run tests, inspect files, debug
3. Close shell → focus returns to agent terminal
4. Type in agent terminal to send input to Claude

**Multi-repo:** Import repos via sidebar. Each repo has its own task list. Cmd+Opt+Up/Down navigates tasks in sidebar order.

### Closing a task (Cmd+Delete)

1. Kills the agent PTY session and shell session in the daemon
2. Marks the task as `done` in the DB
3. Selects the next task in the sidebar
4. Tasks with `stage = 'done'` are hidden from the sidebar. The sidebar shows all tasks whose stage is not `done`.
5. **Garbage collection:** Tasks closed longer than `gcAfterDays` (default: 3, configurable in preferences) are permanently deleted — worktree removed, DB row deleted. GC runs hourly.

### Task activity

| State | Meaning | Sidebar display |
|-------|---------|-----------------|
| `idle` | No recent activity | normal |
| `working` | Agent actively running (PostToolUse hook) | italic |
| `unread` | Agent finished, user hasn't looked | bold |

Sorted in sidebar: pinned (manual order) → merge → pr → active (by created_at desc) → blocked.

### Pinned tasks

Tasks can be pinned to the top of their repo's task list by dragging above the pin divider. Per-repo scope. Closed tasks disappear regardless of pin state.

### Agent execution

**PTY mode (default):** Agent CLI runs in a real terminal via the daemon. User sees full TUI output in real-time. Interactive — user can type. Hooks (`kanna-hook` binary) report lifecycle events: `Stop` (finished), `StopFailure` (error), `PostToolUse` (marks task as working).

**SDK mode (alternate):** Agent CLI runs headless with `--output-format stream-json`. NDJSON on stdin/stdout. Non-interactive. Used for automation.

### Diff viewer

- Modal (Cmd+D), not a tab
- Scopes: Branch (all changes since merge-base with default branch), Last Commit, Working (uncommitted)
- Staged toggle to filter staged-only changes
- Scope remembered per task
- Rendered by `@pierre/diffs` with shadow DOM, syntax highlighting via worker pool

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| ⇧⌘N | New task |
| ⌘D | Diff modal |
| ⌘J | Shell modal |
| ⇧⌘J | Shell at repo root |
| ⌘P | File picker |
| ⌘O | Open in IDE |
| ⌘S | Make PR |
| ⇧⌘M | Merge PR |
| ⇧⌘Delete | Close task |
| ⌘Z | Undo close |
| ⌘Opt+Up/Down | Navigate tasks |
| ⌘B | Toggle sidebar |
| ⇧⌘P | Command palette |
| ⇧⌘E | Tree explorer |
| ⇧⌘Enter | Toggle maximize |
| ⇧⌘A | Analytics |
| ⌘/ | Keyboard shortcuts |
| ⌘, | Preferences |
| Ctrl+- / Ctrl+Shift+- | Back / Forward |
| Escape | Dismiss modal |

All shortcuts work even when the terminal has focus.

### Preferences

| Setting | Default |
|---------|---------|
| Suspend After (minutes) | 5 |
| Kill After (minutes) | 30 |
| IDE Command | code |
| Locale | en |
| Default Agent Provider | claude |

Stored in SQLite `settings` table.

## Package Manager

Use `bun` for all package management and script execution. Not pnpm, not npm.

## Monorepo Layout

- `apps/desktop/` — Tauri desktop app (Vue 3 + Rust)
- `packages/core/` — shared TypeScript business logic (pipeline, GitHub, Slack, Discord, config)
- `packages/db/` — database schema types and query helpers
- `crates/claude-agent-sdk/` — Rust wrapper for Claude CLI (NDJSON streaming)
- `crates/daemon/` — PTY daemon (Unix socket, session persistence)
- `crates/kanna-cli/` — sidecar binary for agents to signal stage completion (`kanna-cli stage-complete`)
- `crates/kanna-hook/` — lightweight binary that signals events to the daemon
- `crates/tauri-plugin-delta-updater/` — self-updater plugin (stub)
- `tests/` — CLI contract tests (`cli-contract/`), PTY test utility (`pty-test/`)
- `scripts/` — dev server, build, release, and setup scripts
- `docs/` — planning and spec documents
- `.cargo/config.toml` — sets `target-dir = ".build"` (shared Rust build cache)

## Development Workflow

We develop Kanna **in and on** Kanna — Claude Code agents run from one of three contexts:

1. **Main branch** — the stable Kanna instance at the repo root, used to manage tasks and spawn worktrees
2. **Release build** — installed to `/Applications/Kanna.app`, used when the main branch is being modified
3. **Dev worktree** — a feature branch checked out at `{repoPath}/.kanna-worktrees/task-{uuid}`, running its own isolated dev server

### Worktree isolation

Worktrees are fully isolated from the main branch instance:

- **Separate Vite port** — main uses `localhost:1420`, worktrees get a unique port automatically. The app reads base ports from `.kanna/config.json` `ports` field (e.g., `"KANNA_DEV_PORT": 1420`), picks the next unused offset (1, 2, 3…), and stores the computed port (e.g., `1421`) as `port_env` in the DB. When the worktree's agent session spawns, `KANNA_DEV_PORT` is passed as an env var — no manual editing of `config.json` is needed. `dev.sh` then writes `tauri.conf.local.json` with the port override and passes `--config` to Tauri — the committed `tauri.conf.json` is never modified. Vite also reads `KANNA_DEV_PORT` to set its server port.
- **Separate daemon** — worktrees use `{worktree}/.kanna-daemon/` instead of `~/Library/Application Support/Kanna/`
- **Separate database** — each instance uses its own SQLite DB
- **Separate tmux session** — `dev.sh` names the session `kanna-{worktree-dir}` instead of `kanna`

This means the main Kanna app and a dev worktree can run simultaneously without port or data conflicts.

### Launching the dev server

Always use `./scripts/dev.sh` to start the dev server — never run `bun tauri dev` or `cargo tauri dev` directly. It auto-detects the worktree context, sets `KANNA_WORKTREE=1`, forwards all `KANNA_*` env vars, and runs in a background tmux session.

```bash
# Development (from repo root or worktree root)
./scripts/dev.sh             # start in tmux (auto-detects worktree)
./scripts/dev.sh start --seed # start with seed data (requires KANNA_DB_NAME=kanna-test.db)
./scripts/dev.sh stop        # stop the tmux session
./scripts/dev.sh restart     # stop + start
./scripts/dev.sh log         # print recent tmux output
./scripts/dev.sh start -a    # start and attach to tmux session

# Build
cd apps/desktop && bun tauri build

# Unit tests
bun test                     # all packages via turborepo
cd packages/core && bun test # core package only

# Daemon tests
cd crates/daemon && cargo test -- --test-threads=1

# Rust integration tests (needs claude in PATH)
cd apps/desktop/src-tauri && cargo test --test agent_cli_integration -- --ignored --nocapture

# E2E tests (needs app running with test DB)
# Terminal 1: KANNA_DB_NAME=kanna-test.db bun tauri dev
# Terminal 2: cd apps/desktop && bun test:e2e
```

### First build in a worktree

The first `bun dev` in a fresh worktree compiles ~523 Rust crates (the daemon builds quickly, but the full Tauri app takes several minutes). Subsequent builds are incremental.

## Architecture

- **Tauri commands** in `apps/desktop/src-tauri/src/commands/` — agent, daemon, git, fs, shell
- **Tauri app core** in `apps/desktop/src-tauri/src/lib.rs` — event bridge, reattach coordinator, daemon spawn, macOS integrations
- **Vue composables** in `apps/desktop/src/composables/` — useTerminal, useKeyboardShortcuts, useBackup, useGc, etc.
- **Daemon** in `crates/daemon/` — standalone PTY session manager. See `crates/daemon/SPEC.md` for full spec.
- **Agent SDK** wraps Claude CLI via `--output-format stream-json`, communicates via NDJSON on stdin/stdout
- **Agent providers** — supports both Claude and Copilot via `agent_provider` field (`"claude"` | `"copilot"`)
- **Permission mode flags** use camelCase: `dontAsk`, `acceptEdits`, `default` (not kebab-case)
- **Browser mock layer** (`tauri-mock.ts`, `invoke.ts`, `listen.ts`, `dialog.ts`) enables running the frontend in a regular browser without Tauri APIs

### Data flow

```
User creates task → worktree + DB record → daemon Spawn → Attach (start streaming)
  → daemon forks child (zsh -c "claude ...") → reads PTY output → Output events via Unix socket
  → Tauri events → frontend xterm.js

User types → xterm.js onData → invoke("send_input") → daemon Input → PTY write

Claude finishes → PTY shows ❯ idle prompt → Tauri detects ClaudeIdle → app updates task activity

User makes PR → GitHub API → DB update → stage transition
```

## Codebase Overview

### Utilities (`apps/desktop/src/utils/`)

- **`fuzzyMatch.ts`** — VSCode-inspired fuzzy file-path scorer. Multi-part queries (e.g., "comp btn"), bonuses for path separators, camelCase boundaries, consecutive matches, filename boost (+1000). Returns score + matched indices. **Use this instead of writing a new fuzzy search.**
- **`parseRepoInput.ts`** — Parses repo input in any format: local paths, SSH URLs, HTTPS URLs, `owner/repo` shorthand, `gh repo clone` commands. Returns structured `ParsedInput` with normalized clone URL.

### Composables (`apps/desktop/src/composables/`)

| Composable | Purpose |
|---|---|
| `useAnalytics` | Task analytics bucketing (daily/weekly/monthly), operator metrics (response time, dwell time, focus score, switches/hour) |
| `useBackup` | Timestamped DB backups with WAL flush, 7-day retention, periodic interval (4h) |
| `useClaudeUsage` | Regex parser for Claude CLI `/usage` output (session %, week %, dollar spend) |
| `useCustomTasks` | Scans `.kanna/tasks/` for `agent.md` files, abortable via AbortController |
| `useGc` | Garbage collection of old tasks/sessions |
| `useInlineSearch` | Search/filtering for task lists |
| `useKeyboardShortcuts` | Central shortcut registry (30+ actions), context-aware, modifier matching, terminal passthrough filtering |
| `useLessScroll` | Vim/less-style scroll navigation (j/k/f/b/d/u/g/G), skips input elements |
| `useModalZIndex` | Z-index stacking for overlapping modals |
| `useNavigationHistory` | Back/forward stacks (max 50), 1s dwell threshold to skip transient visits |
| `useOperatorEvents` | Emits `app_blur`/`app_focus` on visibility change for analytics |
| `useRestoreFocus` | Restores focus to previous element after modal close |
| `useShortcutContext` | Singleton context manager — components set active context on mount, register supplementary shortcuts |
| `useTerminal` | xterm.js lifecycle, WebGL fallback, Kitty keyboard mode, SIGWINCH redraw on reconnect, debounced fit |
| `useToast` | Toast notifications (max 3 visible, auto-dismiss, configurable duration) |
| `useTreeExplorer` | Miller-columns file browser with caching, vim navigation (j/k/h/l/gg/G), `/` filter mode, 50ms debounced preview, prefetch |

### Components (`apps/desktop/src/components/`)

| Component | Purpose |
|---|---|
| `ActionBar` | PR creation button, conditional on task status |
| `AddRepoModal` | Add repository (create or import tabs) |
| `AgentView` | Claude agent message stream display |
| `AnalyticsModal` | Task and operator analytics charts |
| `BlockerSelectModal` | Task dependency/blocker editor |
| `CommandPaletteModal` | Quick command launcher (`⇧⌘P`) |
| `DiffModal` / `DiffView` | Git diff viewer using `@pierre/diffs` |
| `FilePickerModal` | File open dialog from repo |
| `FilePreviewModal` | File content preview pane |
| `KeyboardShortcutsModal` | Shortcut reference display |
| `MainPanel` | Central task view with terminal tabs or blocked placeholder |
| `NewTaskModal` | Task creation with custom/predefined templates |
| `PreferencesPanel` | Settings (IDE command, timeouts, locale) |
| `ShellModal` | Standalone shell terminal |
| `Sidebar` | Task list navigation (pinned/PR/merge/active/blocked sections) |
| `TagBadges` | Task tag display |
| `TaskHeader` | Task title, branch, PR link, tags |
| `TerminalTabs` | Tab manager for multiple terminal/agent sessions |
| `TerminalView` | xterm.js terminal renderer |
| `ToastContainer` | Toast notification display |
| `TreeExplorerModal` | Miller-columns file explorer |

### Stores (`apps/desktop/src/stores/`)

- **`kanna.ts`** (Pinia) — App state: repo/item selection, sorted items (pinned → merge → pr → active → blocked), debounced activity transitions (unread → idle after 1s), `generateId()` via `crypto.getRandomValues()`, operator event emission, undo support. Key interfaces: `PtySpawnOptions` (agentProvider, model, permissionMode, allowedTools, maxTurns, maxBudgetUsd, setupCmds, portEnv).
- **`db.ts`** — DB setup: `resolveDbName()` from env vars, `loadDatabase()` with mock fallback, `runMigrations()` with all table schemas.

### Tauri Commands (`apps/desktop/src-tauri/src/commands/`)

| Module | Commands |
|---|---|
| `agent.rs` | `create_agent_session` (background drainer), `agent_next_message` (poll buffer), `agent_send_message`, `agent_interrupt`, `agent_close_session`, `get_claude_usage` |
| `daemon.rs` | `spawn_session`, `attach_session`, `detach_session`, `send_input`, `resize_session`, `signal_session`, `kill_session`, `list_sessions` |
| `fs.rs` | `get_app_data_dir`, `file_exists`, `read_text_file`, `write_text_file`, `copy_file`, `remove_file`, `list_dir`, `list_files` (gitignore-aware), `read_dir_entries`, `read_env_var`, `which_binary`, `ensure_directory`, `append_log` |
| `git.rs` | `git_diff` (staged + unstaged + untracked), `git_diff_range`, `git_merge_base`, `git_worktree_list`, `git_worktree_add`, `git_worktree_remove`, `git_log`, `git_default_branch`, `git_remote_url`, `git_push`, `git_fetch`, `git_clone`, `git_init`, `git_app_info` |
| `shell.rs` | `ensure_term_init` (ZDOTDIR proxy), `run_script` |

### Tauri App Core (`apps/desktop/src-tauri/src/lib.rs`)

- **Event bridge** (`spawn_event_bridge`) — background task subscribing to daemon events, auto-reconnects with exponential backoff on daemon restart, emits Tauri events: `terminal_output`, `session_exit`, `hook_event`, `status_changed`, `daemon_ready`
- **Reattach coordinator** (`spawn_reattach_coordinator`) — listens to `daemon_ready`, re-attaches all tracked sessions, sends Resize to trigger SIGWINCH for Claude TUI redraw
- **Daemon spawn** (`ensure_daemon_running`) — searches for sidecar binary, spawns with `setsid`, waits for PID file match, handles worktree isolation
- **macOS fn+F fullscreen** — native event monitor intercepts fn+F without Cmd/Ctrl/Option to toggle fullscreen
- **PATH resolution** (`fix_path_from_shell`) — runs interactive login shell to capture real PATH (fixes Spotlight-launched app's minimal PATH)
- **Terminal output patterns** — strips ANSI from PTY output to detect: "Interrupted", "Do you want to allow", Copilot idle/thinking states; broadcasts as hook events
- **State:** `AgentState` (DashMap of buffered sessions), `DaemonState` (shared daemon connection), `AttachedSessions` (tracks active output streams)

### Packages

**`@kanna/core`** (`packages/core/src/`):
- `pipeline/types.ts` — `SYSTEM_TAGS`, `parseTags()`, `hasTag()` (safe JSON parse, never throws)
- `config/repo-config.ts` — `parseRepoConfig()` from `.kanna/config.json`
- `config/custom-tasks.ts` — `parseAgentMd()` frontmatter parser, slug-to-name conversion
- `config/custom-tasks-scanner.ts` — Scans `.kanna/tasks/` with smart empty-file skipping
- `slack/` — `SlackClient` (postMessage, fetchHistory)
- `discord/` — `DiscordClient` (postMessage, fetchHistory)

**`@kanna/db`** (`packages/db/src/`):
- `schema.ts` — TypeScript types mirroring all SQLite tables
- `queries.ts` — Abstracted query layer over `DbHandle` interface. Includes: CRUD for repos/items/sessions, JSON tag management, `hasCircularDependency()` (DFS cycle detection for task blockers), `getUnblockedItems()`, analytics aggregation, `getSetting`/`setSetting`

### Rust Crates

- **`claude-agent-sdk`** — Session builder pattern, NDJSON stream parsing, permission callbacks, `find_claude_binary()`. Types: `PermissionMode` (`DontAsk`/`AcceptEdits`/`Default`), `ThinkingMode`, `Effort` levels. Bidirectional control protocol: app sends Interrupt/SetModel/SetPermissionMode, CLI sends CanUseTool for permission checks.
- **`daemon`** — Raw libc PTY, Unix socket NDJSON protocol, SCM_RIGHTS fd transfer for handoff, session manager with spawn/attach/detach/resize/signal/kill.
- **`tauri-plugin-delta-updater`** — Self-updater plugin (stub).

### Key Third-Party Libraries

| Library | Usage | Notes |
|---|---|---|
| `@pierre/diffs` | Diff rendering | Use `containerWrapper` not `fileContainer`, `worker-portable.js` not `worker.js` |
| `xterm.js` (6.x beta) | Terminal UI | With fit, image, serialize, web-links, webgl addons |
| `shiki` | Syntax highlighting | Used for code preview |
| `pinia` | State management | Single store in `kanna.ts` |
| `markdown-it` | Markdown parsing | With strikethrough-alt, task-lists plugins |
| `vue-chartjs` + `chart.js` | Charts | Analytics modal |
| `vuedraggable` | Drag-drop | Task reordering |
| `@vueuse/core` | Composable utilities | `computedAsync`, etc. |
| `vue-i18n` | i18n | Locale support |
| `git2` (Rust) | Git operations | Fully vendored (libgit2 + OpenSSL) |

### Scripts (`scripts/`)

| Script | Purpose |
|---|---|
| `dev.sh` | Dev server in tmux, auto-detects worktree, manages daemon lifecycle, seed data |
| `setup.sh` | Verify prerequisites (Xcode CLT, Rust, Bun ≥1.3.9, tmux, etc.) |
| `clean.sh` | Remove build artifacts (Rust targets, node_modules, dist, .turbo) |
| `install.sh` | Download and install latest release from GitHub (DMG, arch auto-detect) |
| `ship.sh` | Release automation: version bump, dual-arch build, sign, notarize, publish |
| `sync-version.sh` | Generate VERSION from git tags, sync to tauri.conf.json |
| `stage-sidecars.sh` | Stage daemon binary to Tauri's externalBin with target triples |

### Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `KANNA_DEV_PORT` | vite.config.ts, dev.sh | Dev server port (default 1420) |
| `KANNA_WORKTREE` | dev.sh → runtime | Flag: running in a worktree |
| `KANNA_DB_NAME` | stores/db.ts | Override SQLite filename (default `kanna-v2.db`) |
| `KANNA_DAEMON_DIR` | daemon, tests | Override daemon data directory |
| `KANNA_GITHUB_TOKEN` | core/github | GitHub API auth |
| `KANNA_SLACK_TOKEN` | core/slack | Slack API auth |
| `KANNA_DISCORD_TOKEN` | core/discord | Discord API auth |
| `KANNA_VERSION` | daemon build.rs | Compile-time version from git |

### Database Tables

| Table | Key Columns |
|---|---|
| `repo` | id, path, name, default_branch, hidden |
| `pipeline_item` | id, repo_id, prompt, tags (JSON), pr_number/url, branch, activity, port_env (JSON), pinned, pin_order, display_name, agent_type, agent_provider, base_ref, issue_number, issue_title, closed_at, port_offset |
| `task_blocker` | blocked_item_id, blocker_item_id |
| `worktree` | id, pipeline_item_id, path, branch |
| `terminal_session` | id, repo_id, pipeline_item_id, label, cwd, daemon_session_id |
| `agent_run` | id, repo_id, agent_type, status, started_at, finished_at |
| `settings` | key, value |
| `activity_log` | id, pipeline_item_id, activity, started_at |
| `operator_events` | id, event_type, pipeline_item_id, repo_id |

## Daemon

- Raw libc PTY (not portable-pty) — needed for `SCM_RIGHTS` fd handoff
- Always spawned fresh on app start, handoff from old daemon preserves sessions
- App waits for new daemon's PID file before connecting (prevents stale connections)
- One reader per session, started on first Attach (not on Spawn) — prevents byte-splitting across multiple fd readers
- **Pre-attach buffering** — output between Spawn and first Attach is buffered (max 64KB) so startup sequences (e.g., kitty keyboard mode) are captured and replayed
- **Broadcast output** — all attached clients receive output simultaneously; attach swaps the active writer without creating new readers
- **Terminal size coordination** — effective PTY dimensions are `min(cols)` × `min(rows)` across all attached clients
- No scrollback buffer — reconnection uses SIGWINCH to trigger Claude TUI redraw
- Logs to `~/Library/Application Support/Kanna/kanna-daemon_*.log` via flexi_logger
- `KANNA_DAEMON_DIR` env var overrides data directory (used by tests)
- Protocol: line-delimited JSON over Unix socket. Commands include Spawn, Attach, Detach, Input, Resize, Signal, Kill, List, Subscribe, Handoff, HookEvent

### Daemon invariants

1. **One daemon at a time.** New daemon always replaces the old one.
2. **Always handoff.** New daemon transfers sessions from old daemon via SCM_RIGHTS.
3. **Always spawn.** App always starts a fresh daemon. Never reuses existing.
4. **Always wait.** App waits for the new daemon's PID before connecting.
5. **Sessions survive upgrades.** Child processes are unaware of daemon restarts.
6. **One reader per session.** Single `stream_output` task, started on first Attach.
7. **One client per session.** Attach swaps the output target atomically.

### App startup sequence

1. App spawns new daemon binary (detached via `setsid`)
2. New daemon detects old daemon, performs handoff (fd transfer), old daemon exits
3. New daemon writes PID file and binds socket
4. App polls PID file until it matches the spawned child
5. App clears stale command connection (`DaemonState`)
6. App connects to new daemon (event bridge + on-demand command connection)
7. Frontend mounts terminals, calls Attach → Resize → Claude redraws

## Database

SQLite via `tauri-plugin-sql`. Schema defined inline in `stores/db.ts`'s `runMigrations()`. See the Database Tables inventory in the Codebase Overview section for the full table list.

DB name configurable via `KANNA_DB_NAME` env var (defaults to `kanna-v2.db`). E2E tests use `kanna-test.db`. Worktrees auto-name their DB `kanna-wt-{worktree-dir}.db` (e.g., `kanna-wt-task-10720bf8.db`). All DBs live in `~/Library/Application Support/com.kanna.app/`.

## Testing

- **Unit tests:** vitest in `packages/core/`, `packages/db/`, and `apps/desktop/src/composables/` (useBackup, useInlineSearch, useNavigationHistory, useShortcutContext have `.test.ts` files)
- **Integration tests:** Rust tests in `apps/desktop/src-tauri/tests/` (real Claude CLI)
- **Daemon tests:** `crates/daemon/tests/` — handoff and reconnect tests with real daemon processes
- **CLI contract tests:** `tests/cli-contract/` — verify Claude and Copilot CLI flag compatibility
- **E2E tests:** bun test + W3C WebDriver via `tauri-plugin-webdriver` on port 4445
  - Mock tests (`apps/desktop/tests/e2e/mock/`): action-bar, app-launch, diff-view, import-repo, keyboard-shortcuts, preferences, task-lifecycle
  - Real tests (`apps/desktop/tests/e2e/real/`): claude-session, diff-after-claude (requires Claude CLI)
- E2E tests access Vue internals via `__vue_app__._instance.setupState` — dev builds only
- WebDriver is only available in debug builds (`#[cfg(debug_assertions)]`)

## Conventions

- Task stage tracked via `pipeline_item.stage` column (e.g., `'in progress'`, `'pr'`). The `tags` column is deprecated for stage management but still used internally for `blocked` tag until the blocker system is fully decoupled. `closed_at` indicates done tasks, not a tag.
- Git worktrees created at `{repoPath}/.kanna-worktrees/task-{uuid}`
- Branch names: `task-{uuid}`
- GitHub labels: `kn:wip`, `kn:pr-ready`, `kn:claimed`
- API tokens from env: `KANNA_GITHUB_TOKEN`, `KANNA_SLACK_TOKEN`, `KANNA_DISCORD_TOKEN`
- Agent providers: `"claude"` or `"copilot"` — stored in `pipeline_item.agent_provider`
- i18n locales: English (`en`), Japanese (`ja`), Korean (`ko`) in `apps/desktop/src/i18n/locales/`
- Keyboard shortcut contexts: `"main"`, `"diff"`, `"file"`, `"shell"`, `"tree"` — managed by `useShortcutContext`
- `.kanna/` per repo — project-level Kanna config:
  - `config.json` — `setup` (commands run in each new worktree), `teardown` (cleanup commands), `test` (test commands), `ports` (env var → base port mapping), `pipeline` (default pipeline name)
  - `agents/{name}/AGENT.md` — agent definitions (YAML frontmatter + markdown body). Built-in agents ship as Tauri resources; per-repo files override built-ins by name.
  - `pipelines/{name}.json` — pipeline definitions (stages, environments, transitions). Built-in `default.json` ships as Tauri resource.
  - `tasks/{slug}/agent.md` — custom task templates with YAML frontmatter (prompt, model, permissions, allowed tools)

## Working on the Codebase

### Trace before you touch

Before fixing a bug or adding a feature, trace the complete data flow for the affected feature: DB → store → component → composable → daemon. Read all files in the path before proposing changes. A fix that only looks at one layer will break another.

For example, a task close/undo touches: `queries.ts` (DB), `kanna.ts` (store), `Sidebar.vue` (visibility), `TerminalTabs.vue` (component lifecycle), `useTerminal.ts` (attach/detach), and the daemon (PTY sessions). Changing one without understanding the others leads to piecemeal hacks.

### Improve the architecture

Changes should leave the architecture cleaner than you found it. Adding a hack to work around a design problem is not acceptable — fix the design instead. If a fix requires a polling loop, a retry timer, or duplicating logic that already exists elsewhere, that's a signal the approach is wrong.

When something doesn't work, find the architectural reason and fix it at the right layer:
- If a component needs to react to a state change, make sure the lifecycle handles it (mount/unmount/watch) — don't add manual triggers from the store.
- If two systems disagree on the source of truth (e.g., `stage` vs `closed_at` for visibility), pick one and make everything use it.
- If a resource needs cleanup, clean it up where the lifecycle owns it — don't leave stale state for another layer to work around.

## Coding Style

### TypeScript

- **Never use `any`.** Use `unknown`, generics, proper interfaces, or type assertions to a specific type. If you're tempted to use `any`, you haven't modeled the type yet. Existing `any` usage is tech debt, not precedent.
- **Run `bun tsc --noEmit`** before considering TypeScript work done. Fix all type errors — don't suppress them with `@ts-ignore` or `as any`.
- **Prefer `interface` over `type`** for object shapes. Use `type` for unions, intersections, and mapped types.
- **No non-null assertions (`!`)** unless the surrounding code makes the guarantee obvious (e.g., immediately after an existence check in the same scope).

### Rust

- **Run `cargo clippy`** and fix all warnings. Clippy is right until proven otherwise.
- **No `unwrap()` in production code.** Use `?`, `unwrap_or`, `unwrap_or_else`, or proper error handling. `unwrap()` is acceptable in tests.
- **Run `cargo fmt`** before committing Rust changes.

### Vue

- Use `<script setup lang="ts">` for all components.
- Props and emits must be typed — use `defineProps<{}>()` and `defineEmits<{}>()`, not the runtime declaration.
- Prefer composables (`use*`) over mixins or provide/inject for shared logic.
- Prefer reactive style — use `computed()` and `watch`/`watchEffect` over imperative functions that manually read and return ref values. Derived state should be a `computed`, not a function call.

### General

- No `console.log` left in committed code. Use the app's frontend log forwarding for debug output, and remove before committing.
- Catch blocks must log or re-throw — never swallow errors silently.

## UI

- **Keyboard shortcuts** use one `<kbd>` per key: `<kbd>⇧</kbd><kbd>⌘</kbd><kbd>N</kbd>`, not `<kbd>⇧⌘N</kbd>`. Use `kbd + kbd { margin-left: 2px }` for spacing.

## Versioning

Single `VERSION` file generated by `scripts/sync-version.sh` from git tags. Format: `0.0.1` (tagged) or `0.0.1-dev.main.abc1234` (untagged). Syncs to `tauri.conf.json`. Package.json versions are all `0.0.0` (meaningless). Daemon reads version from git at compile time via `build.rs`.

## Common Pitfalls

- Claude CLI permission mode flags are **camelCase** (`dontAsk` not `dont-ask`). The SDK was broken by this once already.
- `@pierre/diffs`: use `containerWrapper` (not `fileContainer`) in `FileDiff.render()` — `fileContainer` skips the shadow DOM and loses all styling. Use `worker-portable.js` (not `worker.js`) to avoid WASM dependency. Theme/lineDiffType go in worker pool options, not FileDiff constructor (ignored when using pool).
- `git_diff` must include untracked files (`include_untracked`, `recurse_untracked_dirs`, `show_untracked_content`) or new files created by Claude won't appear in the diff view.
- The agent SDK pipes stderr to capture (not null) — check stderr output when debugging silent CLI failures.
- `tauri-plugin-webdriver` on port 4445 for E2E testing. Only works in debug builds on macOS WKWebView.
- Daemon must be detached from app process group (`setsid` via `pre_exec`) or Ctrl+C kills it.
- Frontend console logs are written to `/tmp/kanna-webview-*.log` via the log forwarding in [`apps/desktop/src/main.ts`](apps/desktop/src/main.ts) and the Tauri `append_log` command in [`apps/desktop/src-tauri/src/commands/fs.rs`](apps/desktop/src-tauri/src/commands/fs.rs). Each instance gets its own log file: worktrees use the directory name (for this worktree: `/tmp/kanna-webview-task-348cf000.log`), while main instances use a cwd path hash (for example `kanna-webview-1a2b3c4d.log`).
- Rust build artifacts go to `.build/` (not `target/`) — configured in `.cargo/config.toml`.
- Terminal output must be ANSI-stripped before pattern matching — raw escape sequences (colors, cursor movement) interfere with hook detection.
- The event bridge auto-reconnects to daemon with exponential backoff — don't add manual retry logic on top.
- KeepAlive is used for ShellModal to preserve xterm buffer across task switches — use `v-show` not `v-if` for terminal-containing components.
- `agent_next_message` uses a polling pattern — frontend calls it repeatedly to drain the buffered message queue from the background drainer task.
- Stage advance creates a **new task** (new `pipeline_item`, new worktree, new PTY session). The new task's prompt can reference the previous task's branch via `$BRANCH` variable substitution. The source task is closed after the new one is created. Never mutate an existing task's stage in-place.
- Built-in agent/pipeline definitions must ship as Tauri bundled resources, not as TypeScript string constants. Definitions live in `.kanna/` files — the app reads them at runtime via the resource directory fallback.
