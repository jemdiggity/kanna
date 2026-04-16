# Mobile UI Usability Design

## Summary

The existing mobile prototype proves the relay and terminal path, but the UI is not yet usable as a day-to-day mobile client. The current app is essentially a polling list plus a terminal screen. It lacks a coherent mobile navigation shell, uses raw SQL in the view layer, and does not expose important task commands in a mobile-friendly way.

This design reframes the mobile app around a Slack-like interaction model without copying Slack literally:

- a floating bottom toolbar
- a list-first primary surface
- a recent-work surface for fast re-entry
- a terminal-first task detail screen
- a generalized command-palette action surface under `More`

The goal is to make the mobile app feel natural to use on a phone while staying faithful to Kanna's actual workflows.

## Goals

- Make the mobile app usable for everyday task monitoring and intervention.
- Preserve the core Kanna mental model: tasks are the main unit, and opening a task should take the user straight to the agent terminal.
- Keep task detail focused on terminal content rather than adding desktop-style controls everywhere.
- Surface important task actions on mobile without relying on keyboard shortcuts.
- Reuse as much of the existing mobile Tauri scaffold as possible.

## Non-Goals

- Introducing a new event/activity domain model separate from tasks.
- Implementing full desktop feature parity.
- Designing a separate mobile-only workflow for stage transitions or merges.
- Replacing the underlying Tauri mobile architecture.

## Current State

The current mobile app already exists as a Tauri-based app under `apps/mobile/` with a separate Rust backend in `apps/mobile/src-tauri/`. It can:

- connect to the relay
- list repos and tasks via `db_select`
- attach to a task/session terminal
- send input to the running session

The main usability gaps are:

- no coherent mobile shell
- no task-focused secondary surface besides the main list
- no mobile action model for commands that are keyboard-driven on desktop
- list rows that do not provide enough context to decide whether to open a task
- task detail that is functional but not designed around mobile navigation

## Product Direction

The mobile app should feel structurally similar to Slack on mobile, but adapted to Kanna's actual jobs.

The important translation is:

- the desktop sidebar becomes the primary mobile list surface
- tapping a task opens a focused detail screen, like opening a channel
- app navigation uses a floating bottom toolbar
- secondary actions live in a generalized action surface instead of persistent desktop controls

The app should not mirror Slack's information architecture one-for-one. Kanna does not need DMs or a separate event system just to match Slack's tabs.

## Navigation Shell

The root mobile shell uses a floating bottom toolbar with three destinations:

- `Tasks`
- `Recent`
- `More`

The header also exposes:

- a search button with magnifying-glass affordance
- a `+` action for new task creation

### Tasks

`Tasks` is the default/root screen. It is the mobile replacement for the desktop sidebar.

### Recent

`Recent` is a pan-repo task list sorted by most recently updated. It is not a separate event feed. It exists to answer "what changed lately across everything?" without introducing a new model that desktop does not have.

### More

`More` opens a command-palette-style surface rather than a static settings page. This surface is the mobile home for actions that would otherwise be keyboard shortcuts on desktop.

## Command Model

Mobile needs an explicit action surface because keyboard shortcuts do not exist. Rather than distributing actions across headers, floating buttons, and inline menus, the app should centralize commands in the `More` palette.

### Global Commands

When no task is open, the `More` palette should include global actions such as:

- new task
- search
- preferences
- repo switching or repo-scoped utilities
- other app-level commands that are currently shortcut- or palette-driven on desktop

### Task-Aware Commands

When a task is open, the same `More` palette becomes task-aware and includes task-level commands such as:

- promote stage
- run merge agent
- open PR
- close task
- other commands that currently require shortcuts or desktop action affordances

This keeps the task screen visually clean while still preserving important functionality.

## Tasks Screen

The `Tasks` screen is the primary browsing surface. It is grouped by repo sections because repo context remains the main way users orient themselves in Kanna.

Within each repo section, mobile keeps the existing desktop ordering:

1. pinned
2. `merge`
3. `pr`
4. active
5. blocked

This is intentionally not a new mobile ordering scheme. Mobile should preserve the desktop mental model unless there is a strong reason to diverge.

### Row Content

Each task row should display:

- task title
- stage
- latest readable agent-output snippet
- light secondary context only when needed for disambiguation

The task title is the primary line.

The stage is visible on the list because it is stable, meaningful task state and helps users understand where the task is in the workflow.

The snippet is the key usability improvement. Instead of showing the worktree name, the row should show the most recent readable agent output so users can decide whether they need to open the task.

### Metadata Rules

- Show stage on the row.
- Do not emphasize transient agent status such as `working` or `unread` as primary UI chrome.
- Do not show the worktree name in the row.
- Repo name is already represented by section headers, so it should not be repeated heavily inside grouped rows.

### Visual Direction

The screen should lean toward a Slack-like dense list rather than cards:

- compact rows
- clear section headers
- strong first line for title
- muted preview text
- touch targets that remain comfortable on a phone

The goal is quick scanning, not dashboard-style status reporting.

### Section Behavior

Repo sections may be collapsible if needed, but collapsibility is optional for the first pass. The default behavior can remain expanded until real list size proves that collapsing is necessary.

## Recent Screen

`Recent` is a cross-repo list of tasks ordered by most recently updated. It reuses the same row model as `Tasks` so users do not have to learn two different list UIs.

The main differences are:

- no repo section grouping
- rows include lightweight repo context, because repo headers are absent
- sorting is by recency rather than desktop sidebar ordering

This tab is for fast re-entry, not for structural browsing.

## Task Screen

Opening a task from either `Tasks` or `Recent` pushes the same task detail screen within the mobile shell rather than leaving the shell entirely.

The task screen should be terminal-first.

The floating bottom toolbar remains available while a task is open so that `More` can still expose task-aware commands in context.

### Header

The header should remain minimal and include:

- back button
- task title
- repo name
- stage

The header should not include extra persistent action buttons or transient status pills.

### Main Content

The terminal should own most of the vertical space. The mobile app exists primarily to monitor and intervene in running agent sessions, so the terminal output must remain the dominant surface.

### Input

Input remains anchored at the bottom. It should feel like the mobile equivalent of sending input into the running session, not like a generic chat composer unrelated to terminal semantics.

### Actions

Task-level actions do not live as persistent controls on this screen. They are surfaced through the `More` command palette while the task is open.

This keeps the detail screen focused and avoids recreating desktop action bars in a cramped mobile layout.

## Search And New Task Entry Points

Search should remain an app-level affordance in the header rather than a dedicated bottom-tab destination.

Search should cover:

- task title
- repo name
- display name
- other high-signal identifiers that help users jump directly to a task

The `+` action should initiate new task creation. Its final creation flow is out of scope for this UI pass, but the shell must reserve a consistent entry point for it.

## Data Requirements

To support this UI cleanly, the mobile app needs more structured task row data than the current prototype.

### Latest Output Snippet

Each task row needs a latest-output preview derived from recent terminal or agent output. This preview should be:

- human-readable
- short enough to preserve list density
- resilient to noisy terminal control output

The implementation may need a derived field or helper that extracts the latest meaningful line rather than exposing raw terminal bytes directly to the list UI.

### Stage Visibility

Stage must be available in both:

- task list rows
- task screen header

This should be treated as core task metadata for mobile.

## Error And Empty States

The UI should account for the following states:

- no repos connected
- repo with no active tasks
- empty `Recent` list
- relay disconnected
- task/session attach failure
- terminal session ended

These states should be presented with focused, mobile-appropriate messaging rather than raw infrastructure errors where possible.

## Implementation Boundaries

This design is intentionally focused on usability and structure, not on final data-layer cleanup. However, the implementation should move toward cleaner boundaries than the current prototype.

In particular:

- list and task-screen UI should not depend on raw SQL strings embedded in view components
- mobile row rendering should consume typed task data rather than ad hoc query results
- command palette actions should be driven by a clear task-aware/global-aware model

The immediate outcome is a usable mobile UI. The architectural direction is a better-shaped mobile client rather than piling more prototype logic into `App.vue`.

## Testing

The implementation should be covered with a mix of UI and behavior tests:

- component tests for task rows and section rendering
- tests for `Tasks` grouping and ordering behavior
- tests for `Recent` sorting behavior
- tests for task-screen header rendering with stage visibility
- tests for command-palette mode switching between global and task-aware states
- tests for terminal screen behavior when attach fails or the session exits

Manual verification should include:

- browse grouped tasks on a phone-sized viewport
- open a task from `Tasks`
- open a task from `Recent`
- invoke `More` from root and from task detail
- verify task-level commands appear only when task context exists
- verify stage is shown on both rows and task header

## Recommended Implementation Sequence

The first implementation pass should proceed in this order:

1. establish the floating shell and route structure
2. rebuild `Tasks` as the primary grouped list
3. add `Recent` using the same row primitives
4. tighten the task screen to a terminal-first layout
5. add the command-palette action surface with task-aware/global modes
6. replace temporary view-layer data plumbing as needed to support the UI cleanly

## Result

This design makes the mobile app feel like a real mobile client instead of a relay demo. It gives Kanna a clear phone-native structure:

- browse tasks by repo
- jump into recent work across repos
- open a task into a focused terminal view
- access task and global commands through a unified mobile action surface

That preserves Kanna's core workflow while making it usable without desktop keyboard shortcuts.
