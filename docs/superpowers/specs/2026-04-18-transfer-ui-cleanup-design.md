# Transfer UI Cleanup Design

## Goal

Remove the temporary main-window footer actions that were added for LAN transfer work, while keeping `Push to Machine` available from the command palette. `Advance Stage` should remain available through its existing keyboard shortcut and command palette entry rather than a dedicated footer control.

## Scope

- Remove the footer action bar from the main task view.
- Remove the dedicated `Push to Machine` button from that footer.
- Add `Push to Machine` as a command palette action when the current task can be transferred.
- Leave stage advancement on the existing shortcut and command palette path.
- Update tests that currently assert footer rendering or footer-triggered transfer behavior.

## Non-Goals

- No new persistent UI affordance in the task header, sidebar, or terminal area.
- No change to the peer picker flow itself.
- No change to task transfer backend behavior.

## Design

### Main View Cleanup

The footer action bar is a temporary affordance that adds visual weight to the main task view and duplicates actions that already fit better in the command palette and shortcut system. The main column should render only the task content area and its existing modal-driven actions.

`ActionBar.vue` should be removed from the main window composition. If the component has no remaining callers after this change, it should be deleted rather than left as dead code.

### Command Palette Entry

`Push to Machine` should be exposed as a dynamic command in the command palette. The command should only appear when:

- there is a current task
- the task stage is not `done`

Executing the command should reuse the existing `openPeerPicker(currentTask.id)` flow. This keeps one behavior path for peer selection and transfer initiation.

### Advance Stage

`Advance Stage` should not be re-homed into a new visible UI location. The action already belongs in the keyboard-and-command system, and this cleanup is specifically intended to remove newly added persistent footer chrome.

## Testing

- Remove or update any tests that assert footer rendering in the main task view.
- Add or update tests to verify `Push to Machine` appears in the command palette when a current task is active and not done.
- Verify the command invokes the existing peer picker path.

## Risks

- If the command palette wiring is incomplete, `Push to Machine` could become harder to discover or inaccessible.
- Removing the footer without adjusting tests could leave stale expectations around button-based actions.

## Mitigation

- Keep the implementation narrow and reuse the existing peer picker handler.
- Cover the command palette entry and execution path with tests.
