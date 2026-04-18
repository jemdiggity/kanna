# Mobile Terminal WebView Design

## Goal

Replace the current text-only mobile terminal panel with a read-only terminal surface that preserves desktop-style terminal framing and glyphs more faithfully on iPhone.

## Scope

This slice is intentionally narrow:

- Render the existing task terminal snapshot/live stream inside a dedicated terminal surface.
- Keep the existing native task metadata layout and native input composer.
- Do not add terminal input ownership, selection, copy/paste, or reconnect controls beyond what already exists.
- Do not change the mobile transport or daemon protocol in this slice.

## Approach

Use a dedicated `WebView` inside the React Native task screen as a terminal-rendering island. The first step will not embed `xterm.js` yet. Instead, it will render an HTML terminal document with a monospace grid-like presentation, wide-content scrolling, and preserved whitespace so the daemon snapshot remains legible and closer to the desktop view than the current plain `Text` block.

This keeps the change small while preserving the path toward a later `xterm.js`-inside-`WebView` upgrade if needed.

## Components

### `TaskScreen`

- Swap the current `ScrollView` terminal transcript block for a dedicated terminal component.
- Keep the native composer and task action affordances below the terminal.

### `TerminalWebView`

- New focused component responsible for rendering read-only terminal HTML in a `WebView`.
- Accepts `terminalOutput` and `terminalStatus`.
- Uses a generated inline HTML document rather than local bundled assets for this first slice.

### `buildTerminalDocument`

- New pure helper that converts terminal text and connection state into safe HTML.
- Preserves whitespace and line breaks.
- Uses UTF-8 metadata so box drawing and unicode glyphs render correctly.
- Defaults to horizontal scrolling rather than shrinking glyphs aggressively.

## Data Flow

The existing mobile controller and store continue to own terminal state. `TaskScreen` passes the current `taskTerminalOutput` and `taskTerminalStatus` into `TerminalWebView`, which turns that data into HTML and hands it to the `WebView`.

## Error Handling

- If terminal output is empty, the component renders the existing connecting/waiting copy inside the terminal surface.
- If the `WebView` cannot render, the screen should still remain stable and continue to expose the native composer.

## Testing

- Add pure-function tests for the terminal HTML builder:
  - UTF-8 metadata is present.
  - Terminal text is HTML-escaped.
  - Read-only status copy is rendered for connecting/idle states.
  - Wide-content presentation styles remain present.
- Run mobile tests and typecheck after integration.

## Success Criteria

- Opening a task on mobile shows a read-only terminal surface instead of the plain `Text` transcript.
- Claude/Codex box drawing and unicode content no longer render as mojibake from the HTML layer.
- Existing task input flow still works through the native composer.
