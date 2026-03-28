# Commit Graph Enhancements

## Summary

Four enhancements to the commit graph viewer: dedicated shortcut context with help overlay, branch/tag labels on commits, scroll-to-HEAD on open, and auto/all filtering mode toggle.

## Context

The commit graph viewer (shipped in the original spec) renders the DAG but has no branch labels, no filtering, uses the "main" shortcut context (so the help overlay shows unrelated app shortcuts), and opens scrolled to the top regardless of which branch is active.

## Design

### 1. Rust Backend: Refs and Filtering

**Enhance `GraphCommit` struct** with a `refs` field:

```rust
pub struct GraphCommit {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub timestamp: i64,
    pub parents: Vec<String>,
    pub refs: Vec<String>,       // NEW: ref names pointing at this commit
}
```

**Enhance `git_graph` response** to include HEAD:

```rust
#[derive(Serialize)]
pub struct GraphResult {
    pub commits: Vec<GraphCommit>,
    pub head_commit: Option<String>,  // full SHA that HEAD resolves to
}
```

**Add `from_ref` parameter** to `git_graph`:

```rust
pub fn git_graph(
    repo_path: String,
    max_count: Option<usize>,
    from_ref: Option<String>,     // NEW: when Some, walk only from this ref
) -> Result<GraphResult, String>
```

**Ref collection:** Before the commit walk, iterate `repo.references()` once, building a `HashMap<Oid, Vec<String>>`. For each reference:
- Local branches (`refs/heads/*`): strip prefix → `"main"`, `"task-abc123"`
- Remote branches (`refs/remotes/*`): strip prefix → `"origin/main"`
- Tags (`refs/tags/*`): strip prefix → `"v0.0.19"`

After walking commits, attach matching refs to each `GraphCommit.refs`.

**HEAD resolution:** `repo.head()` → peel to commit → store full SHA as `head_commit`.

**Filtering:** When `from_ref` is `Some(ref_str)`:
- Resolve the ref to an Oid
- Push only that Oid into the revwalk (instead of all refs)
- All other logic (topological+time sort, parent extraction, ref attachment) stays the same
- Fewer commits returned = narrower graph

When `from_ref` is `None`: current behavior (walk all refs).

### 2. Frontend: TypeScript Types

Update `GraphCommit` interface in `commitGraph.ts`:

```typescript
export interface GraphCommit {
  hash: string;
  short_hash: string;
  message: string;
  author: string;
  timestamp: number;
  parents: string[];
  refs: string[];          // NEW
}
```

New response type:

```typescript
interface GraphResult {
  commits: GraphCommit[];
  head_commit: string | null;
}
```

Update `CommitGraphView` to invoke with the new signature and destructure the response.

### 3. Branch/Tag Labels

Rendered in the text layer of `CommitGraphView`, between the commit dot and the commit hash. Each ref gets a small inline pill/badge styled by type:

- **Local branches:** default text color, e.g., `main`, `task-abc123`
- **Remote branches:** dimmed, e.g., `origin/main`
- **Tags:** dimmed, e.g., `v0.0.19`

Display order per commit: local branches → remote branches → tags. Long ref names truncated at ~20 chars with ellipsis.

Refs that duplicate information are collapsed: if both `main` and `origin/main` point at the same commit, both are shown (they convey different information — local vs remote tracking state).

### 4. Auto/All Filter Mode

`CommitGraphView` gains a reactive `mode` ref: `"auto" | "all"`, defaulting to `"auto"`.

- **Auto:** calls `git_graph` with `fromRef: "HEAD"` — shows only commits reachable from HEAD (full graph including merged branches)
- **All:** calls `git_graph` with `fromRef: null` — shows all branches

Toggled with `Space`. The mode label is shown in the top-right corner of the graph view (small, unobtrusive text like `AUTO` or `ALL`).

On mode change, the graph reloads (calls `loadGraph()` with the new parameter). Scroll position resets to HEAD's commit.

### 5. Scroll to HEAD on Open

After `loadGraph()` completes, find the commit where `hash === headCommit`. Compute its pixel position via `py(commit.y)` and set `scrollRef.scrollTop` to center it vertically in the viewport:

```typescript
const headRow = layout.commits.find(c => c.hash === headCommit);
if (headRow && scrollRef.value) {
  const targetY = py(headRow.y) - scrollRef.value.clientHeight / 2;
  scrollRef.value.scrollTop = Math.max(0, targetY);
}
```

When opened from a task with a worktree, the worktree's HEAD is used (already resolved by `git_graph` via the worktree path). When opened without a task, the repo's HEAD is used.

### 6. Shortcut Context

**New context: `"graph"`**

`CommitGraphModal` switches from `useShortcutContext("main")` to `useShortcutContext("graph")`.

`CommitGraphView` registers supplementary shortcuts via `registerContextShortcuts("graph", [...])`:

| Key | Action | Label |
|-----|--------|-------|
| `j` / `k` | Scroll down / up | Scroll down / up |
| `f` / `b` | Page down / up | Page down / up |
| `d` / `u` | Half-page down / up | Half-page down / up |
| `g` / `G` | Jump to top / bottom | Top / Bottom |
| `Space` | Toggle auto/all mode | Toggle auto / all |
| `q` | Close | Close |
| `Esc` | Close | Close |

All navigation keys are already handled by `useLessScroll`. The `Space` toggle is new logic in `CommitGraphView`. `Esc` is handled by the global dismiss in App.vue. The registration just surfaces them in the `?` help overlay.

Add `"graph"` to the `ShortcutContext` type union in `useShortcutContext.ts`. Add `"graph"` to the `showCommitGraph` shortcut's context array so Cmd+G still toggles from within the modal.

## Files Changed

| File | Change |
|------|--------|
| `apps/desktop/src-tauri/src/commands/git.rs` | Enhance `git_graph`: add `refs` field, `GraphResult` wrapper, `from_ref` param, HEAD resolution |
| `apps/desktop/src/utils/commitGraph.ts` | Add `refs` to `GraphCommit` type, add `GraphResult` type |
| `apps/desktop/src/components/CommitGraphView.vue` | Mode toggle, ref labels, scroll-to-HEAD, register context shortcuts |
| `apps/desktop/src/components/CommitGraphModal.vue` | Switch to `useShortcutContext("graph")` |
| `apps/desktop/src/composables/useShortcutContext.ts` | Add `"graph"` to context type union |
| `apps/desktop/src/composables/useKeyboardShortcuts.ts` | Add `"graph"` to `showCommitGraph` context array |
| `apps/desktop/src/i18n/locales/en.json` | Add graph shortcut labels |
| `apps/desktop/src/i18n/locales/ja.json` | Add graph shortcut labels |
| `apps/desktop/src/i18n/locales/ko.json` | Add graph shortcut labels |
| `apps/desktop/src/tauri-mock.ts` | Update `git_graph` mock to return `GraphResult` |
