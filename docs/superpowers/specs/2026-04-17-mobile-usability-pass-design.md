# Mobile Usability Pass Design

## Goal

Bring `apps/mobile` to a usable baseline for iPhone-first task monitoring and light task control. The mobile app should let a user connect to a desktop daemon, scan tasks quickly, open a task into a terminal-first workspace, send agent input, and find task actions from the More surface without guessing.

## Scope

This pass is intentionally limited to the existing Expo/React Native app in `apps/mobile`. It does not change the LAN transport, pairing model, or the underlying `kanna-server` contract beyond using data that is already available. It does not introduce remote/cloud connectivity, push notifications, or a native terminal renderer.

## Product Direction

The app should feel structurally similar to Slack mobile without copying it literally.

- `Tasks` is the home surface and corresponds to the desktop sidebar for the selected repo.
- `Recent` is a cross-repo list sorted by recent activity.
- Opening a task should feel like entering the task workspace, similar to moving into a channel or DM detail screen.
- `More` is the mobile action surface for global commands plus active-task commands.
- Search and new-task creation stay as utility actions outside the core tab bar.

## Architecture

The current store/controller boundary is good enough for this pass and will stay intact.

- Keep `createMobileController()` responsible for loading collections, selecting tasks, and managing the live terminal subscription.
- Keep `createSessionStore()` as the single UI state source.
- Add small display-model helpers where the UI needs derived presentation data that should stay testable outside React Native components.
- Keep component edits focused on screen structure and hierarchy rather than introducing a new navigation stack.

## Screen Design

### Tasks and Recent

Task list cards need to become denser and easier to scan.

- Show repo name rather than raw repo ID when the app has the mapping.
- Promote task title and snippet as the main visual hierarchy.
- Keep stage visible but secondary.
- Give the user a stronger sense of whether the item is repo-local or part of the cross-repo recent feed.

### Task Workspace

The task screen becomes the primary workspace destination.

- Use a compact top bar with a back affordance and task-scoped actions.
- Present task title, repo, and stage as a single “channel/workspace” header rather than separate generic cards.
- Make the terminal the dominant body region.
- Keep the input composer directly attached to the terminal experience.
- Treat More as an action sheet/palette entry point for the current task instead of a separate management screen with weak context.

### More

The More screen remains a searchable command palette, but it should clearly anchor commands to the active task.

- Move selected-task context to the top.
- Separate active-task commands from workspace commands.
- Keep task stage and snippet visible so users understand what actions apply.

### Shell

The floating navigation shell should feel like real mobile chrome, not a literal button row.

- Tighten the bottom bar layout and labels.
- Preserve utility actions for search and create.
- Keep the current tab model (`tasks`, `recent`, `more`) rather than introducing more navigation state in this pass.

## Data Flow

No new API endpoints are required. The UI should derive richer display state from data already available:

- `TaskSummary` provides `id`, `repoId`, `title`, `stage`, and optional `snippet`.
- `SessionStore.repos` already holds repo ID to repo name mappings.
- The selected task can be resolved from `repoTasks`, `recentTasks`, or `searchResults`.

The main derived-data need is presentation-focused:

- task list item metadata
- task workspace header and terminal summary content
- more-screen contextual sections

## Error Handling

Existing controller-level error handling remains the source of truth.

- Keep errors surfaced through `store.setErrorMessage(...)`.
- Do not add per-component retry state for this pass.
- Preserve current fallback text when terminal output is unavailable, but improve how it is visually framed.

## Testing

This pass should rely on the existing lightweight Vitest pattern:

- Add or update pure-model tests for any new presentation helpers.
- Keep React Native UI assertions indirect unless a component already has a matching harness.
- Verify the app with:
  - `pnpm --dir apps/mobile run typecheck`
  - `pnpm --dir apps/mobile test -- --runInBand`

## Non-Goals

- Replacing Expo with React Native CLI or native code
- Adding websocket reconnection logic beyond what already exists
- Supporting remote/cloud desktop control
- Porting desktop-only workflows like diff viewing or file browsing into mobile
