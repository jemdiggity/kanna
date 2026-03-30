# New Task Agent Indicator Design

## Goal

Make the selected Agent CLI in the New Task modal unambiguous when only a small number of CLIs are available, especially when exactly two are installed.

## Problem

The current modal renders available Agent CLIs as a segmented button group in the header. When only two providers are shown, the visual distinction between selected and unselected states is too subtle. The control looks interactive, but it does not clearly communicate which provider will be used to create the task.

## Decision

Replace the clickable segmented control with a read-only status label that shows the currently selected Agent CLI.

Example presentation:

- `Agent CLI: Claude`
- `Agent CLI: Codex`

The modal will continue to support keyboard-only switching with the existing shortcuts:

- `Shift+Cmd+[`
- `Shift+Cmd+]`

On non-macOS systems, the implementation should continue to respect the existing modifier behavior already encoded in the component.

## Behavior

### Provider detection

The modal will continue detecting installed CLIs on mount and filtering the provider list to available options when possible.

### Initial selection

Initial provider selection remains unchanged:

- Prefer `defaultAgentProvider` when it is available.
- Otherwise fall back to the first available detected provider.
- If detection fails or finds none, keep the existing full provider list fallback behavior.

### Switching

Provider switching remains available through the existing keyboard cycling logic only. The status label is not clickable.

### Shortcut hint

The modal should show a concise hint near the status label indicating that the provider can be cycled with keyboard shortcuts. The hint should not compete visually with the task prompt input.

## UI Changes

### Header

- Remove the segmented toggle buttons.
- Show a compact read-only current-provider label instead.

### Visual treatment

The current provider should read as status, not as a button. Styling should make the value easy to scan without implying mouse interaction.

## Testing

Add or update a component test covering:

- Rendering the current provider as text.
- Absence of the old clickable toggle buttons.
- Cycling providers with keyboard shortcuts updates the displayed provider.

## Scope

This change is limited to the desktop New Task modal UI and its related tests. No backend or task-creation API changes are required.
