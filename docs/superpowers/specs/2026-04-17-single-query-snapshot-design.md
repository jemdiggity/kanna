# Single Query Snapshot For Kanna Store

## Summary

Replace the current split query state (`repos` plus `items`) with one query-layer snapshot that represents the visible repo/task read model together. The database remains the source of truth, but the reactive layer should publish one coherent snapshot so repo visibility, task membership, selection, and optimistic updates cannot drift apart.

This is a correction to the current refactor. The split `reloadRepos()` / `reloadItems()` model reintroduced a manual invalidation edge: repo visibility changes can update the repo list without updating the task list derived from that repo set. A single snapshot removes that footgun.

## Goals

- Make repo visibility and task membership update from one reactive read model.
- Keep SQLite as the canonical source of truth.
- Keep UI code reactive and derived via `computed()`.
- Keep mutations flowing through store actions rather than direct UI mutation.
- Keep optimistic create/block transitions encapsulated inside the query layer.
- Eliminate the need for callers to reason about separate repo/task invalidation.

## Non-Goals

- Replacing SQLite or Pinia.
- Introducing subscriptions to local SQL changes outside the store.
- Turning the query layer into a generic cache framework for unrelated entities.
- Refactoring unrelated store modules while touching this path.

## Current Problem

The current query layer owns:

- `baseRepos`
- `baseItems`
- `reloadRepos()`
- `reloadItems()`

`reloadItems()` loads tasks by iterating over the visible repos, which means the task set depends on the repo set. That dependency is architectural, but it is currently expressed only by call discipline. If a mutation reloads repos but not items, the UI can see a repo list and task list that no longer correspond to each other.

That regression is already visible in the review findings:

- unhiding a repo with existing tasks can restore the repo without restoring its tasks
- hiding a repo can leave stale tasks and navigation state behind

## Recommended Approach

Move to one query-layer snapshot representing visible repos plus their visible tasks.

Suggested shape:

```ts
export interface RepoSnapshotEntry {
  repo: Repo;
  items: PipelineItem[];
}

export interface KannaSnapshot {
  entries: RepoSnapshotEntry[];
}
```

The exact shape may be normalized internally, but the important rule is that repos and tasks are loaded, refreshed, and reconciled together.

The query layer may still expose convenience selectors like `repos` and flattened `items`, but those should be `computed()` views over the single snapshot rather than separately-loaded canonical collections.

## Data Model

### Canonical Query State

The query layer owns one canonical snapshot loaded from SQLite:

- visible repos from `listRepos()`
- visible tasks for those repos from `listPipelineItems()`

The snapshot should be updated atomically at the query-layer boundary so consumers never observe a repo refresh and task refresh as unrelated sources of truth.

### Derived Reactive State

The store may expose:

- `snapshot`
- `repos`
- `items`
- future per-repo selectors

But only `snapshot` is canonical. Everything else is a derived computed view.

### Optimistic Overlays

Optimistic overlays remain in the query layer, but they apply to the snapshot rather than a separate `baseItems` list.

That means:

- pending task creation overlays patch a repo entry's `items`
- blocked-task replacement overlays patch a repo entry's `items`
- a successful mutation reconciles by reloading the full snapshot

The overlay mechanism remains item-focused for now because that is the only optimistic behavior currently needed.

## Data Flow

### Read Path

```text
SQLite
  -> query layer loads visible repos
  -> query layer loads visible tasks for those repos
  -> query layer builds one snapshot
  -> computed selectors derive repos/items/current lists
  -> UI reacts
```

### Mutation Path

```text
UI/store action
  -> optional optimistic overlay applied to snapshot
  -> DB write
  -> full snapshot reload
  -> overlay removed
  -> derived selectors update automatically
```

This keeps the DB canonical while ensuring the reactive layer always represents one coherent view.

## Module Responsibilities

### `apps/desktop/src/stores/queries.ts`

This module becomes the owner of:

- canonical snapshot loading
- snapshot refresh
- snapshot-level optimistic overlays
- derived computed selectors for `repos` and `items`
- hydration of stage-order cache during snapshot load

Suggested API direction:

```ts
export interface QueryState<T> {
  data: ComputedRef<T>;
  pending: Ref<boolean>;
  error: Ref<unknown>;
}

export interface QueriesApi {
  snapshot: QueryState<KannaSnapshot>;
  repos: QueryState<Repo[]>;
  items: QueryState<PipelineItem[]>;
  loadInitialData(): Promise<void>;
  reloadSnapshot(): Promise<void>;
  withOptimisticItemOverlay<T>(input: {
    key: string;
    apply(snapshot: KannaSnapshot): KannaSnapshot;
    run: () => Promise<T>;
  }): Promise<T>;
}
```

The final API names can differ, but the design requirement is fixed: there must be one canonical reload path for visible repo/task data.

### `apps/desktop/src/stores/state.ts`

This module should keep:

- selection refs
- preferences refs
- caches
- timers

It should not own separate canonical repo/task refs if those are now derived from the snapshot. If compatibility requires temporary refs during the refactor, they should be treated as transitional wiring, not the final architecture.

### `apps/desktop/src/stores/selection.ts`

Selection and sorting remain computed, but they must derive from snapshot-backed selectors rather than assuming repo and task canonical state reload independently.

Navigation validity should be based on the visible task set from the snapshot, so hidden repos cannot remain reachable through stale history state.

### `apps/desktop/src/stores/tasks.ts`

Task mutations should:

- write to the DB
- request snapshot reload
- use snapshot overlays for optimistic transitions where needed

Task code should not need to choose between `reloadRepos()` and `reloadItems()` because that distinction no longer exists at the canonical read-model layer.

## Architectural Rules

### 1. One canonical read model

There should be exactly one canonical reactive snapshot for visible repo/task data.

### 2. Derived selectors only

`repos`, flattened `items`, selected task views, and sidebar ordering are all derived with `computed()` from the snapshot and local selection state.

### 3. DB remains canonical

Optimistic overlays are temporary. The steady state always comes from reloading the snapshot from SQLite.

### 4. No direct UI mutation

Components never mutate repo/task collections directly. They call store actions, and the reactive layer updates from overlays plus DB reconciliation.

### 5. Invalidation follows ownership

If a write can change visible repos or visible tasks, the canonical response is a snapshot reload. Callers should not carry around hidden knowledge about which subset needs refreshing.

## Testing Strategy

Add regression coverage for the exact invalidation risks introduced by the split model:

- hiding a repo with existing tasks removes both the repo and its tasks from the visible state
- unhiding or re-importing an existing hidden repo with tasks restores both the repo and its tasks with no extra item-only refresh
- navigation history does not jump into tasks belonging to hidden repos
- optimistic task creation still shows the placeholder immediately and reconciles to DB state after snapshot reload
- optimistic blocked-task replacement still shows the replacement immediately and reconciles to DB state after snapshot reload

Keep the existing store tests green and add focused tests around the new snapshot loader behavior rather than relying only on end-to-end coverage.

## Risks And Mitigations

- Risk: snapshot reloads may do more work than a narrowly-scoped item reload.
  Mitigation: correctness is the priority here; optimize later only if profiling shows the snapshot load is materially too expensive.

- Risk: transitional compatibility code can leave both snapshot and legacy refs in place too long.
  Mitigation: keep the refactor focused and remove redundant ownership in the same change when practical.

- Risk: optimistic overlays at the snapshot layer may encourage overly broad patches.
  Mitigation: keep overlays narrowly scoped to per-item transformations and reconcile quickly through a DB-backed snapshot reload.

## Success Criteria

- There is one canonical query snapshot for visible repos/tasks.
- The store no longer depends on separate repo/task invalidation for correctness.
- Hiding/unhiding repos cannot leave task state stale.
- Selection and navigation operate only on currently visible tasks.
- Existing desktop store tests pass, and new regression tests cover the invalidation cases above.
