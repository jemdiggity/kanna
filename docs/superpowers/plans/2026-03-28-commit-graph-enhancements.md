# Commit Graph Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add branch/tag labels, auto/all filtering, scroll-to-HEAD, and a dedicated shortcut context to the commit graph viewer.

**Architecture:** Enhance the Rust `git_graph` command to return ref names and support filtered walks. Frontend receives the enriched data, renders ref labels as inline pills, toggles between auto/all modes via Space, and scrolls to HEAD on open. A new `"graph"` shortcut context surfaces the modal's keybindings in the help overlay.

**Tech Stack:** Rust (git2), Vue 3, TypeScript, i18n (vue-i18n)

**User Verification:** NO

---

### Task 1: Enhance Rust `git_graph` backend

**Goal:** Add ref labels, HEAD resolution, and optional `from_ref` filtering to the `git_graph` Tauri command.

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/git.rs:18-185`

**Acceptance Criteria:**
- [ ] `GraphCommit` has `refs: Vec<String>` field
- [ ] New `GraphResult` struct wraps commits + head_commit
- [ ] `from_ref` parameter filters the commit walk
- [ ] Local branches, remote branches, and tags are all included in refs
- [ ] HEAD commit hash is returned

**Verify:** `cd apps/desktop/src-tauri && cargo build` → compiles without errors

**Steps:**

- [ ] **Step 1: Add `refs` field and `GraphResult` wrapper**

In `apps/desktop/src-tauri/src/commands/git.rs`, update the `GraphCommit` struct and add `GraphResult`:

```rust
#[derive(Serialize)]
pub struct GraphCommit {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub timestamp: i64,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
}

#[derive(Serialize)]
pub struct GraphResult {
    pub commits: Vec<GraphCommit>,
    pub head_commit: Option<String>,
}
```

- [ ] **Step 2: Rewrite `git_graph` with ref collection, HEAD resolution, and `from_ref` filtering**

Replace the existing `git_graph` function:

```rust
#[tauri::command]
pub fn git_graph(
    repo_path: String,
    max_count: Option<usize>,
    from_ref: Option<String>,
) -> Result<GraphResult, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;

    // Build ref map: oid -> list of human-readable ref names
    let mut ref_map: std::collections::HashMap<git2::Oid, Vec<String>> =
        std::collections::HashMap::new();
    for reference in repo.references().map_err(|e| e.to_string())? {
        let reference = match reference {
            Ok(r) => r,
            Err(_) => continue,
        };
        let name = match reference.name() {
            Some(n) => n.to_string(),
            None => continue,
        };
        // Resolve to the commit oid (peel through annotated tags)
        let oid = match reference.peel_to_commit() {
            Ok(c) => c.id(),
            Err(_) => continue,
        };
        let display = if let Some(rest) = name.strip_prefix("refs/heads/") {
            rest.to_string()
        } else if let Some(rest) = name.strip_prefix("refs/remotes/") {
            rest.to_string()
        } else if let Some(rest) = name.strip_prefix("refs/tags/") {
            rest.to_string()
        } else {
            continue;
        };
        ref_map.entry(oid).or_default().push(display);
    }

    // Resolve HEAD
    let head_commit = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .map(|c| c.id().to_string());

    // Walk commits
    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    if let Some(ref from) = from_ref {
        let obj = repo
            .revparse_single(from)
            .map_err(|e| format!("bad ref '{}': {}", from, e))?;
        revwalk.push(obj.id()).map_err(|e| e.to_string())?;
    } else {
        revwalk
            .push_glob("refs/heads/*")
            .map_err(|e| e.to_string())?;
        let _ = revwalk.push_glob("refs/remotes/*");
    }

    revwalk
        .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
        .map_err(|e| e.to_string())?;

    let limit = max_count.unwrap_or(usize::MAX);
    let mut commits = Vec::new();

    for oid in revwalk {
        if commits.len() >= limit {
            break;
        }
        let oid = oid.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let message = commit
            .message()
            .unwrap_or("")
            .lines()
            .next()
            .unwrap_or("")
            .to_string();
        let author = commit.author().name().unwrap_or("").to_string();
        let timestamp = commit.time().seconds();
        let hash = oid.to_string();
        let short_hash = hash[..7.min(hash.len())].to_string();
        let parents = commit.parent_ids().map(|p| p.to_string()).collect();
        let refs = ref_map.remove(&oid).unwrap_or_default();

        commits.push(GraphCommit {
            hash,
            short_hash,
            message,
            author,
            timestamp,
            parents,
            refs,
        });
    }

    Ok(GraphResult {
        commits,
        head_commit,
    })
}
```

- [ ] **Step 3: Build and verify**

Run: `cd apps/desktop/src-tauri && cargo build`
Expected: compiles without errors

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/git.rs
git commit -m "feat(git): add refs, head_commit, and from_ref filtering to git_graph"
```

---

### Task 2: Frontend plumbing — types, mock, shortcut context, i18n

**Goal:** Update TypeScript types, browser mock, shortcut context infrastructure, and i18n keys so Task 3 can use them.

**Files:**
- Modify: `apps/desktop/src/utils/commitGraph.ts:4-11`
- Modify: `apps/desktop/src/tauri-mock.ts:208-212`
- Modify: `apps/desktop/src/composables/useShortcutContext.ts:4,101-108`
- Modify: `apps/desktop/src/composables/useKeyboardShortcuts.ts:81,100-101,106`
- Modify: `apps/desktop/src/i18n/locales/en.json`
- Modify: `apps/desktop/src/i18n/locales/ja.json`
- Modify: `apps/desktop/src/i18n/locales/ko.json`
- Modify: `apps/desktop/src/utils/__tests__/commitGraph.test.ts`

**Acceptance Criteria:**
- [ ] `GraphCommit` type includes `refs: string[]`
- [ ] `GraphResult` interface exists
- [ ] `ShortcutContext` type includes `"graph"`
- [ ] `getContextTitle` returns a title for `"graph"`
- [ ] `showCommitGraph`, `showShortcuts`, `dismiss` shortcuts include `"graph"` in context
- [ ] Mock returns `GraphResult` shape
- [ ] i18n keys added for all 3 locales
- [ ] Existing commitGraph tests updated and passing

**Verify:** `bun tsc --noEmit --project apps/desktop/tsconfig.json` → no errors

**Steps:**

- [ ] **Step 1: Update TypeScript types**

In `apps/desktop/src/utils/commitGraph.ts`, add `refs` to `GraphCommit` and add `GraphResult`:

```typescript
export interface GraphCommit {
  hash: string;
  short_hash: string;
  message: string;
  author: string;
  timestamp: number;
  parents: string[];
  refs: string[];
}
```

Add after `GraphLayout`:

```typescript
export interface GraphResult {
  commits: GraphCommit[];
  head_commit: string | null;
}
```

- [ ] **Step 2: Update tauri-mock.ts**

Replace the `git_graph` mock entry to return `GraphResult`:

```typescript
git_graph: () => ({
  commits: [
    { hash: "abc1234567890", short_hash: "abc1234", message: "feat: add commit graph", author: "Dev", timestamp: Date.now() / 1000, parents: ["def5678901234"], refs: ["main", "origin/main"] },
    { hash: "def5678901234", short_hash: "def5678", message: "fix: resolve issue", author: "Dev", timestamp: Date.now() / 1000 - 3600, parents: ["ghi9012345678"], refs: [] },
    { hash: "ghi9012345678", short_hash: "ghi9012", message: "initial commit", author: "Dev", timestamp: Date.now() / 1000 - 7200, parents: [], refs: ["v0.0.1"] },
  ],
  head_commit: "abc1234567890",
}),
```

- [ ] **Step 3: Add `"graph"` to shortcut context**

In `apps/desktop/src/composables/useShortcutContext.ts`:

Update the type union (line 4):

```typescript
export type ShortcutContext = "main" | "diff" | "file" | "shell" | "tree" | "newTask" | "graph";
```

Add `"graph"` entry to `getContextTitle` (inside the `keys` record, line 101-108):

```typescript
const keys: Record<ShortcutContext, string> = {
  main: "shortcutContexts.main",
  diff: "shortcutContexts.diff",
  file: "shortcutContexts.file",
  shell: "shortcutContexts.shell",
  tree: "shortcutContexts.tree",
  newTask: "shortcutContexts.newTask",
  graph: "shortcutContexts.graph",
};
```

- [ ] **Step 4: Add `"graph"` to shortcut context arrays**

In `apps/desktop/src/composables/useKeyboardShortcuts.ts`:

Update `showCommitGraph` (line 81) — add `"graph"` so Cmd+G toggles from within the modal:

```typescript
{ action: "showCommitGraph", labelKey: "shortcuts.commitGraph", groupKey: "shortcuts.groupViews", key: "g", meta: true, display: "⌘G", context: ["main", "graph"] },
```

Update `showShortcuts` (line 101) — add `"graph"` so `⌘/` works in graph context:

```typescript
{ action: "showShortcuts",  labelKey: "shortcuts.keyboardShortcuts",  groupKey: "shortcuts.groupHelp",   key: "/",                           meta: true,               display: "⌘/",       context: ["main", "diff", "file", "shell", "graph"] },
```

Update `dismiss` (line 106) — add `"graph"` so Escape is displayed:

```typescript
{ action: "dismiss",    labelKey: "shortcuts.dismiss",       groupKey: "shortcuts.groupNavigation", key: "Escape",                                                 display: "Escape",   context: ["main", "diff", "file", "shell", "graph"] },
```

- [ ] **Step 5: Add i18n keys**

In `apps/desktop/src/i18n/locales/en.json`, add to `shortcutContexts`:

```json
"graph": "Commit Graph Shortcuts"
```

In `apps/desktop/src/i18n/locales/ja.json`, add to `shortcutContexts`:

```json
"graph": "コミットグラフショートカット"
```

In `apps/desktop/src/i18n/locales/ko.json`, add to `shortcutContexts`:

```json
"graph": "커밋 그래프 단축키"
```

- [ ] **Step 6: Update existing tests**

In `apps/desktop/src/utils/__tests__/commitGraph.test.ts`, add `refs: []` to every `GraphCommit` object literal. There are 10 commit objects across 4 tests — all need the field. Example for the first test:

```typescript
{ hash: "c", short_hash: "c", message: "third", author: "A", timestamp: 3, parents: ["b"], refs: [] },
```

Run: `bun test apps/desktop/src/utils/__tests__/commitGraph.test.ts`
Expected: all 5 tests pass

- [ ] **Step 7: Type-check**

Run: `bun tsc --noEmit --project apps/desktop/tsconfig.json`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/utils/commitGraph.ts apps/desktop/src/tauri-mock.ts \
  apps/desktop/src/composables/useShortcutContext.ts \
  apps/desktop/src/composables/useKeyboardShortcuts.ts \
  apps/desktop/src/i18n/locales/en.json \
  apps/desktop/src/i18n/locales/ja.json \
  apps/desktop/src/i18n/locales/ko.json \
  apps/desktop/src/utils/__tests__/commitGraph.test.ts
git commit -m "feat(graph): add types, mock, graph shortcut context, and i18n keys"
```

---

### Task 3: CommitGraphView — labels, filtering, scroll-to-HEAD, shortcuts

**Goal:** Wire up all frontend features: ref labels on commits, auto/all mode toggle via Space, scroll-to-HEAD on open, and register supplementary shortcuts for the help overlay.

**Files:**
- Modify: `apps/desktop/src/components/CommitGraphModal.vue:6`
- Modify: `apps/desktop/src/components/CommitGraphView.vue`

**Acceptance Criteria:**
- [ ] Ref labels (branches, tags) render as colored pills next to commit hashes
- [ ] Space toggles between auto and all modes, reloading the graph
- [ ] Mode indicator shows "AUTO" or "ALL" in top-right
- [ ] Graph scrolls to HEAD commit on open and after mode change
- [ ] Supplementary shortcuts registered for "graph" context appear in help overlay
- [ ] CommitGraphModal uses `"graph"` shortcut context

**Verify:** `bun tsc --noEmit --project apps/desktop/tsconfig.json` → no errors; manual test: open graph with Cmd+G, verify labels visible, Space toggles mode, opens scrolled to HEAD, `⌘/` shows graph shortcuts

**Steps:**

- [ ] **Step 1: Update CommitGraphModal context**

In `apps/desktop/src/components/CommitGraphModal.vue`, change line 6:

```typescript
useShortcutContext("graph");
```

- [ ] **Step 2: Rewrite CommitGraphView script**

Replace the entire `<script setup>` block in `apps/desktop/src/components/CommitGraphView.vue`:

```typescript
<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from "vue";
import { invoke } from "../invoke";
import { useLessScroll } from "../composables/useLessScroll";
import { registerContextShortcuts } from "../composables/useShortcutContext";
import {
  layoutCommitGraph,
  type GraphResult,
  type GraphLayout,
  type CurveDef,
} from "../utils/commitGraph";

const props = defineProps<{
  repoPath: string;
  worktreePath?: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const COMMIT_SPACING = 28;
const BRANCH_SPACING = 16;
const NODE_RADIUS = 4;
const GRAPH_PADDING = 12;
const TEXT_GAP = 16;

const scrollRef = ref<HTMLElement | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const layout = ref<GraphLayout>({
  commits: [],
  branches: [],
  curves: [],
  maxColumn: 0,
});
const headCommit = ref<string | null>(null);
const mode = ref<"auto" | "all">("auto");

const scrollTop = ref(0);
const viewportHeight = ref(600);

const totalHeight = computed(
  () => layout.value.commits.length * COMMIT_SPACING + GRAPH_PADDING * 2
);

const graphWidth = computed(
  () => (layout.value.maxColumn + 1) * BRANCH_SPACING + GRAPH_PADDING * 2
);

const textStartX = computed(() => graphWidth.value + TEXT_GAP);

const canvasWidth = computed(() => textStartX.value + 750);

const visibleRange = computed(() => {
  const first = Math.max(
    0,
    Math.floor((scrollTop.value - GRAPH_PADDING) / COMMIT_SPACING) - 20
  );
  const last = Math.min(
    layout.value.commits.length - 1,
    Math.ceil(
      (scrollTop.value + viewportHeight.value - GRAPH_PADDING) / COMMIT_SPACING
    ) + 20
  );
  return { first, last };
});

const visibleCommits = computed(() => {
  const { first, last } = visibleRange.value;
  return layout.value.commits.filter((c) => c.y >= first && c.y <= last);
});

const visibleBranches = computed(() => {
  const { first, last } = visibleRange.value;
  return layout.value.branches.filter(
    (b) => b.endRow >= first && b.startRow <= last
  );
});

const visibleCurves = computed(() => {
  const { first, last } = visibleRange.value;
  return layout.value.curves.filter(
    (c) =>
      (c.startY >= first && c.startY <= last) ||
      (c.endY >= first && c.endY <= last)
  );
});

function px(col: number): number {
  return GRAPH_PADDING + col * BRANCH_SPACING;
}

function py(row: number): number {
  return GRAPH_PADDING + row * COMMIT_SPACING;
}

function curvePath(curve: CurveDef): string {
  const x1 = px(curve.startX);
  const y1 = py(curve.startY);
  const x2 = px(curve.endX);
  const y2 = py(curve.endY);
  const cx1 = x1 * 0.1 + x2 * 0.9;
  const cy1 = y1 * 0.6 + y2 * 0.4;
  const cx2 = x1 * 0.03 + x2 * 0.97;
  const cy2 = y1 * 0.4 + y2 * 0.6;
  return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
}

function relativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;
  return `${Math.floor(diff / 2592000)}mo ago`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}

function refType(name: string): "local" | "remote" | "tag" {
  if (name.includes("/")) return "remote";
  if (/^v?\d/.test(name)) return "tag";
  return "local";
}

function onScroll() {
  if (scrollRef.value) {
    scrollTop.value = scrollRef.value.scrollTop;
    viewportHeight.value = scrollRef.value.clientHeight;
  }
}

function scrollToHead() {
  if (!headCommit.value || !scrollRef.value) return;
  const row = layout.value.commits.find((c) => c.hash === headCommit.value);
  if (row) {
    const targetY = py(row.y) - scrollRef.value.clientHeight / 2;
    scrollRef.value.scrollTop = Math.max(0, targetY);
  }
}

function toggleMode() {
  mode.value = mode.value === "auto" ? "all" : "auto";
  loadGraph();
}

useLessScroll(scrollRef, {
  extraHandler: (e: KeyboardEvent) => {
    if (e.key === " " && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      toggleMode();
      return true;
    }
    return false;
  },
  onClose: () => emit("close"),
});

registerContextShortcuts("graph", [
  { label: "Scroll down", display: "j" },
  { label: "Scroll up", display: "k" },
  { label: "Page down", display: "f" },
  { label: "Page up", display: "b" },
  { label: "Half-page down", display: "d" },
  { label: "Half-page up", display: "u" },
  { label: "Top", display: "g" },
  { label: "Bottom", display: "G" },
  { label: "Toggle auto / all", display: "Space" },
  { label: "Close", display: "q" },
]);

async function loadGraph() {
  loading.value = true;
  error.value = null;
  try {
    const path = props.worktreePath || props.repoPath;
    const fromRef = mode.value === "auto" ? "HEAD" : undefined;
    const result = await invoke<GraphResult>("git_graph", {
      repoPath: path,
      fromRef,
    });
    headCommit.value = result.head_commit;
    layout.value = layoutCommitGraph(result.commits);
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
    await nextTick();
    scrollToHead();
  }
}

onMounted(() => {
  loadGraph();
  if (scrollRef.value) {
    viewportHeight.value = scrollRef.value.clientHeight;
  }
});
</script>
```

- [ ] **Step 3: Update the template**

Replace the entire `<template>` block:

```html
<template>
  <div ref="scrollRef" class="graph-scroll" tabindex="-1" @scroll="onScroll">
    <div class="mode-indicator">{{ mode.toUpperCase() }}</div>
    <div v-if="loading" class="graph-status">Loading commit graph&#x2026;</div>
    <div v-else-if="error" class="graph-status error">{{ error }}</div>
    <template v-else>
      <div class="graph-canvas" :style="{ height: totalHeight + 'px', minWidth: canvasWidth + 'px' }">
        <svg
          class="graph-svg"
          :width="graphWidth"
          :height="totalHeight"
          :viewBox="`0 0 ${graphWidth} ${totalHeight}`"
        >
          <defs>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <line
            v-for="(b, i) in visibleBranches"
            :key="'b' + i"
            :x1="px(b.column)"
            :y1="py(b.startRow)"
            :x2="px(b.column)"
            :y2="py(b.endRow)"
            :stroke="b.color"
            stroke-width="2"
            stroke-opacity="0.4"
          />

          <path
            v-for="(c, i) in visibleCurves"
            :key="'c' + i"
            :d="curvePath(c)"
            :stroke="c.color"
            stroke-width="2"
            stroke-opacity="0.5"
            fill="none"
          />

          <circle
            v-for="commit in visibleCommits"
            :key="commit.hash"
            :cx="px(commit.x)"
            :cy="py(commit.y)"
            :r="NODE_RADIUS"
            :fill="commit.color"
            filter="url(#glow)"
          />
        </svg>

        <div class="commit-text-layer" :style="{ left: textStartX + 'px' }">
          <div
            v-for="commit in visibleCommits"
            :key="'t' + commit.hash"
            class="commit-row"
            :style="{ top: py(commit.y) - 8 + 'px' }"
          >
            <span
              v-for="r in commit.refs"
              :key="r"
              class="ref-pill"
              :class="'ref-' + refType(r)"
            >{{ truncate(r, 20) }}</span>
            <span class="commit-hash" :style="{ color: commit.color }">{{
              commit.short_hash
            }}</span>
            <span class="commit-message">{{
              truncate(commit.message, 72)
            }}</span>
            <span class="commit-author">{{ commit.author }}</span>
            <span class="commit-time">{{ relativeTime(commit.timestamp) }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
```

- [ ] **Step 4: Update styles**

Replace the entire `<style scoped>` block:

```css
<style scoped>
.graph-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
  outline: none;
  position: relative;
}

.mode-indicator {
  position: sticky;
  top: 8px;
  right: 0;
  float: right;
  margin-right: 12px;
  font-size: 10px;
  font-weight: 600;
  color: #888;
  letter-spacing: 0.05em;
  z-index: 1;
  pointer-events: none;
}

.graph-status {
  padding: 24px;
  color: #888;
  text-align: center;
}

.graph-status.error {
  color: #ff7b72;
}

.graph-canvas {
  position: relative;
  min-width: max-content;
}

.graph-svg {
  position: absolute;
  top: 0;
  left: 0;
}

.commit-text-layer {
  position: absolute;
  top: 0;
  pointer-events: none;
}

.commit-row {
  position: absolute;
  display: flex;
  gap: 10px;
  align-items: baseline;
  white-space: nowrap;
  height: 16px;
  font-size: 12px;
  line-height: 16px;
}

.ref-pill {
  display: inline-block;
  padding: 0 5px;
  border-radius: 3px;
  font-size: 10px;
  line-height: 15px;
  font-family: "SF Mono", "Menlo", "Consolas", monospace;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ref-local {
  background: rgba(88, 166, 255, 0.15);
  color: #58a6ff;
  border: 1px solid rgba(88, 166, 255, 0.3);
}

.ref-remote {
  background: rgba(136, 136, 136, 0.1);
  color: #888;
  border: 1px solid rgba(136, 136, 136, 0.2);
}

.ref-tag {
  background: rgba(210, 168, 255, 0.1);
  color: #d2a8ff;
  border: 1px solid rgba(210, 168, 255, 0.2);
}

.commit-hash {
  font-family: "SF Mono", "Menlo", "Consolas", monospace;
  font-size: 11px;
  opacity: 0.9;
}

.commit-message {
  color: #e0e0e0;
  max-width: 500px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.commit-author {
  color: #888;
  font-size: 11px;
}

.commit-time {
  color: #666;
  font-size: 11px;
}
</style>
```

- [ ] **Step 5: Type-check and run existing tests**

Run: `bun tsc --noEmit --project apps/desktop/tsconfig.json`
Expected: no errors

Run: `bun test apps/desktop/src/utils/__tests__/commitGraph.test.ts`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/components/CommitGraphView.vue \
  apps/desktop/src/components/CommitGraphModal.vue
git commit -m "feat(graph): add ref labels, auto/all filtering, scroll-to-HEAD, and graph shortcut context"
```
