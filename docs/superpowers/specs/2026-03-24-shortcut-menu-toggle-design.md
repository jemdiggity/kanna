# Shortcut Menu Toggle Behavior

## Summary

Refine the `Cmd+/` and `Shift+Cmd+/` keyboard shortcuts so they form a symmetric toggle/switch state machine for the shortcuts modal.

## State Machine

| Current state      | `Cmd+/`              | `Shift+Cmd+/`       |
|--------------------|----------------------|----------------------|
| Closed             | Open contextual      | Open all             |
| Showing contextual | Close                | Switch to all        |
| Showing all        | Switch to contextual | Close                |

Context always falls back to `"main"` — there is no "no contextual menu" edge case.

## Changes

### `App.vue` — `showShortcuts` handler (Cmd+/)

```typescript
showShortcuts: () => {
  if (showShortcutsModal.value) {
    if (shortcutsStartFull.value) {
      // Showing all → switch to contextual
      shortcutsStartFull.value = false;
    } else {
      // Showing contextual → close
      showShortcutsModal.value = false;
    }
    return;
  }
  showCommandPalette.value = false;
  shortcutsContext.value = activeContext.value;
  shortcutsStartFull.value = false;
  showShortcutsModal.value = true;
},
```

### `App.vue` — `showAllShortcuts` handler (Shift+Cmd+/)

```typescript
showAllShortcuts: () => {
  if (showShortcutsModal.value) {
    if (!shortcutsStartFull.value) {
      // Showing contextual → switch to all
      shortcutsStartFull.value = true;
    } else {
      // Showing all → close
      showShortcutsModal.value = false;
    }
    return;
  }
  showCommandPalette.value = false;
  shortcutsContext.value = activeContext.value;
  shortcutsStartFull.value = true;
  showShortcutsModal.value = true;
},
```

### No other files changed

- `KeyboardShortcutsModal.vue` — already watches `startInFullMode` prop reactively
- `useKeyboardShortcuts.ts` — shortcut definitions unchanged
- `useShortcutContext.ts` — context system unchanged
- Footer toggle link in modal continues to work independently
