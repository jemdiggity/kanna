# Agent Terminal Image Paste Design

## Goal

Make Kanna's agent terminal behave like Ghostty on macOS for image-related terminal input:

- Dropping image files onto the agent terminal must never navigate the webview away from Kanna.
- Dropped files should be sent to the agent terminal the way a terminal expects.
- Pressing `Cmd+V` with an image on the clipboard should work for image-aware agent CLIs.

The change applies only to agent PTY terminals. Shell terminals remain unchanged.

## Problem

Today Kanna renders agent terminals inside a webview-backed Vue app using xterm.js. That leaves two gaps relative to native terminal behavior:

- Dropping an image onto the terminal is handled by the browser/webview, which can replace the app with the dropped image instead of routing the event to the terminal.
- Clipboard paste is currently text-oriented. `Cmd+V` is allowed to fall through to the browser's native paste behavior, but image-aware agent CLIs expect richer terminal behavior than plain text insertion.

Users expect the agent terminal to behave like Ghostty, where dropped files are inserted into the terminal and pasted clipboard images are available through the terminal protocol path used by modern CLIs.

## Scope

- macOS only for the initial implementation
- Agent PTY terminals only
- Support both:
  - dropped image files from Finder or any drag source that yields file paths
  - pasted clipboard images via `Cmd+V`
- Preserve existing text paste behavior when the clipboard does not contain an image
- Do not change shell modal behavior
- Do not add new daemon, database, or store concepts for images

## Constraints

- The fix must live at the terminal UI layer so the browser cannot navigate away on drop.
- The daemon should continue to receive only PTY bytes through existing `send_input`.
- The implementation must not introduce image-specific session state into SQLite or Pinia.
- Clipboard image access should only happen after an explicit user paste action.
- Shell terminals must keep their existing browser/xterm behavior.

## Approach

Add an explicit `agentTerminal` mode to the frontend terminal boundary and implement a small terminal media bridge inside `useTerminal`.

The bridge owns:

- drag and drop interception for the terminal container
- clipboard image paste interception for macOS agent terminals
- dropped file path encoding into PTY input bytes
- a small Kitty clipboard protocol responder for one-shot clipboard image reads

This keeps the feature at the same layer that already owns keyboard handling, PTY input, and xterm lifecycle.

## Architecture

### Terminal boundary

[`apps/desktop/src/components/TerminalView.vue`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-79568370/apps/desktop/src/components/TerminalView.vue) gains an explicit prop for agent-terminal behavior named `agentTerminal`.

- [`apps/desktop/src/components/TerminalTabs.vue`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-79568370/apps/desktop/src/components/TerminalTabs.vue) passes `agentTerminal=true` for PTY-backed agent sessions.
- [`apps/desktop/src/components/ShellModal.vue`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-79568370/apps/desktop/src/components/ShellModal.vue) leaves it unset so shell terminals do not opt into the new behavior.

### Media bridge

[`apps/desktop/src/composables/useTerminal.ts`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-79568370/apps/desktop/src/composables/useTerminal.ts) gains the terminal media bridge.

The bridge is responsible for:

- attaching `dragenter`, `dragover`, and `drop` listeners to the terminal container
- detecting image data on macOS clipboard paste before allowing the browser to handle `Cmd+V`
- tracking terminal protocol state needed for Kitty clipboard requests after an explicit image paste
- translating UI events into PTY bytes by reusing the existing `send_input` path

The daemon remains unaware of images. From its perspective, this feature is only additional PTY input/output handling in the frontend terminal client.

## Data Flow

### Dropped files

When files are dragged onto the active agent terminal:

1. The terminal container intercepts `dragenter`, `dragover`, and `drop`.
2. The handlers call `preventDefault()` and `stopPropagation()` so WKWebView never treats the payload as navigable content.
3. On `drop`, the bridge reads `dataTransfer.files` and extracts absolute file paths.
4. File paths are shell-escaped in terminal-friendly form.
5. The escaped text is encoded as terminal paste input:
   - bracketed paste framing if the terminal is currently in bracketed paste mode
   - plain text bytes otherwise
6. The encoded bytes are sent through the existing `send_input` Tauri command.

For dropped files, Kanna should behave like a terminal drop target, not like an app-level file import surface.

### Clipboard images

When the user presses `Cmd+V` in an agent terminal on macOS:

1. Kanna checks whether the clipboard currently contains image data.
2. If no image data is present, existing text paste behavior remains unchanged.
3. If image data is present, Kanna does not let the browser perform a plain text paste.
4. Instead, the media bridge captures the clipboard image as a one-shot in-memory payload for that terminal instance.
5. The running agent CLI can then request clipboard content through Kitty clipboard protocol `OSC 5522`.
6. If the CLI requests `image/png`, Kanna returns the encoded clipboard payload through the terminal protocol.
7. After the payload is consumed, the 10 second paste window expires, or the terminal is disposed, the cached clipboard image is cleared.

This mirrors Ghostty's split behavior:

- dropped files become inserted terminal content
- pasted clipboard images are exposed through the terminal clipboard protocol path used by modern CLIs

## Protocol Handling

The bridge needs minimal terminal protocol state:

- whether bracketed paste mode is active for dropped text insertion
- whether a one-shot clipboard image is currently armed after explicit user paste
- parsing of incoming `OSC 5522` requests from terminal output

For the initial version, Kanna only needs to support the subset required for explicit clipboard image paste:

- detect incoming Kitty clipboard requests
- recognize MIME-aware image reads for `image/png`
- emit a valid terminal response for the armed clipboard payload
- ignore unsupported or malformed requests safely

Kanna should not become a general-purpose clipboard server. The clipboard image responder exists only as a short-lived consequence of a user-initiated paste.

## Compatibility And Errors

### Dropped files

- The active agent terminal always suppresses browser navigation for recognized drop payloads.
- Dropped files should be inserted as terminal input even if they are not images; this matches terminal expectations better than silently ignoring valid file drops.
- If a file path cannot be normalized or encoded, Kanna skips that entry and continues with the rest of the drop.
- If the payload contains nothing Kanna can translate into terminal input, it should do nothing beyond suppressing webview navigation.

### Clipboard images

- If image extraction from the clipboard fails, Kanna falls back to normal text paste behavior instead of blocking `Cmd+V`.
- If the agent never requests the armed image through Kitty clipboard protocol, Kanna expires the one-shot clipboard payload after 10 seconds or on the next unrelated user input, whichever comes first.
- If the agent emits malformed or unsupported `OSC 5522` requests, Kanna ignores them and preserves the session.

### Out of scope

- Shell modal image paste/drop behavior
- Linux clipboard or drag/drop support
- Database persistence for clipboard or drop state
- Daemon protocol changes
- Non-PTY agent sessions

## Files

- Update [`apps/desktop/src/components/TerminalView.vue`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-79568370/apps/desktop/src/components/TerminalView.vue)
- Update [`apps/desktop/src/components/TerminalTabs.vue`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-79568370/apps/desktop/src/components/TerminalTabs.vue)
- Verify no behavior change in [`apps/desktop/src/components/ShellModal.vue`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-79568370/apps/desktop/src/components/ShellModal.vue)
- Update [`apps/desktop/src/composables/useTerminal.ts`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-79568370/apps/desktop/src/composables/useTerminal.ts)
- Extend tests in [`apps/desktop/src/components/__tests__/TerminalView.test.ts`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-79568370/apps/desktop/src/components/__tests__/TerminalView.test.ts)
- Extend tests in [`apps/desktop/src/composables/useTerminal.test.ts`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-79568370/apps/desktop/src/composables/useTerminal.test.ts)

## Verification

### Automated

- Add unit coverage for agent-terminal-only opt-in behavior in `TerminalView`
- Add unit coverage for dropped file handling and browser-default suppression in `useTerminal`
- Add unit coverage for image-aware `Cmd+V` interception in `useTerminal`
- Add unit coverage for Kitty clipboard request parsing and one-shot response handling in `useTerminal`
- Run `pnpm exec tsc --noEmit`
- Run targeted vitest coverage for the touched terminal tests

### Manual

1. Drop a `.png` from Finder onto the active agent terminal and confirm Kanna does not navigate away.
2. Confirm the agent terminal receives escaped file path text immediately after drop.
3. Copy an image to the clipboard, press `Cmd+V` in the agent terminal, and confirm the target agent CLI behaves as it does in Ghostty.
4. Confirm plain text paste still works in the agent terminal.
5. Open the shell modal and confirm the new image-specific behavior does not apply there.
