# Main Header Port Sorting Design

## Summary

The main window task header should render port badges in ascending numeric order, regardless of the key order in `pipeline_item.port_env`.

Today [`apps/desktop/src/components/TaskHeader.vue`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-2d0f81c3/apps/desktop/src/components/TaskHeader.vue) parses `item.port_env` and renders `Object.values(env)` directly. Because JSON object key iteration order is not tied to numeric port order, the UI can show badges in a confusing sequence such as `:1421 :3001` when the desired display is `:3001 :1421`.

## Goals

- Render header port badges in ascending numeric order.
- Keep the change local to the current header rendering path.
- Add a regression test that proves numeric ordering.

## Non-Goals

- Changing how ports are allocated.
- Changing how ports are stored in the database.
- Normalizing `port_env` during task creation or updates.
- Refactoring port parsing into shared infrastructure unless a second caller appears.

## Options Considered

### 1. Sort in `TaskHeader.vue`

Parse `item.port_env`, coerce values to numbers, drop invalid values, sort ascending, and render the sorted array.

Pros:
- Fixes the actual presentation bug at the presentation boundary.
- Minimal surface area and low regression risk.
- Does not change persisted data or task creation behavior.

Cons:
- Port parsing remains local to the component.

### 2. Extract a shared helper

Move parsing and sorting into a shared utility and use that helper from `TaskHeader.vue`.

Pros:
- Reusable if more surfaces need the same formatting soon.

Cons:
- Adds abstraction without a current second caller.
- More code movement than the bug requires.

### 3. Normalize `port_env` when writing data

Persist ports in sorted order during task creation and updates.

Pros:
- Every consumer would see a normalized representation.

Cons:
- Changes data-writing behavior for a display-only issue.
- Touches store and persistence flows unnecessarily.

## Chosen Design

Implement option 1.

`TaskHeader.vue` will keep owning header badge formatting. Its `ports` computed value will:

1. Return an empty array when `item.port_env` is absent or invalid JSON.
2. Parse the JSON object as `Record<string, string | number>`.
3. Convert each value with `Number(...)`.
4. Filter out `NaN`.
5. Sort ascending with a numeric comparator.

The template will continue rendering one badge per parsed port; only the ordering changes.

## Testing

Add a focused component test for `TaskHeader.vue` that mounts the component with an out-of-order `port_env`, such as:

```json
{
  "KANNA_DEV_PORT": 1421,
  "API_PORT": 3001
}
```

The test should assert that the rendered port badges appear in numeric order: `:3001`, then `:1421`.

After the test is added and passing, run:

- `pnpm exec vitest` for the new focused test file
- `pnpm exec tsc --noEmit`

## Risks

The primary risk is accidental lexicographic sorting, which would place `1421` before `3001` for the wrong reason in some cases and fail for others. The component test should assert the rendered order directly to guard against that mistake.
