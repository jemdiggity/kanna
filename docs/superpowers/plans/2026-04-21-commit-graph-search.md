# Commit Graph Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add transient keyboard-driven search to the commit graph modal so users can jump between matching commits by message, hash, author, and ref name without filtering the graph.

**Architecture:** Keep search entirely in the frontend. `CommitGraphView.vue` owns query state, match computation, row highlighting, scrolling, and keyboard handling; `CommitGraphModal.vue` forwards layered dismiss behavior to the view; `App.vue` uses that dismiss hook before closing the modal. Reuse the same transient bottom-bar interaction already used by `DiffView.vue` and `FilePreviewModal.vue`.

**Tech Stack:** Vue 3 `<script setup>`, Vitest + happy-dom, existing `useLessScroll` keyboard handling, vue-i18n locale JSON, WebDriver mock E2E tests.

---

## File Structure

### Existing Files To Modify

- `apps/desktop/src/components/CommitGraphView.vue`
  Responsibility: own search UI/state, compute search matches over loaded commits, highlight matched rows, scroll active match into view, and expose layered dismiss.

- `apps/desktop/src/components/CommitGraphModal.vue`
  Responsibility: hold a ref to `CommitGraphView`, expose a modal-level `dismiss()` that delegates to the view, and keep the existing modal/z-index behavior unchanged.

- `apps/desktop/src/App.vue`
  Responsibility: update the global dismiss path so `Escape` closes commit-graph search first and only closes the modal when the graph view says dismissal can proceed.

- `apps/desktop/src/i18n/locales/en.json`
  Responsibility: add English commit-graph search placeholder, no-match copy, and graph shortcut labels.

- `apps/desktop/src/i18n/locales/ja.json`
  Responsibility: add Japanese commit-graph search strings matching the English keys.

- `apps/desktop/src/i18n/locales/ko.json`
  Responsibility: add Korean commit-graph search strings matching the English keys.

- `apps/desktop/src/App.test.ts`
  Responsibility: verify App-level dismiss delegates through the commit-graph modal instead of closing it immediately when search is open.

### New Files To Create

- `apps/desktop/src/components/__tests__/CommitGraphView.test.ts`
  Responsibility: unit-test search hotkeys, match scope, navigation, focus return, and layered dismiss in the graph view.

- `apps/desktop/tests/e2e/mock/commit-graph.test.ts`
  Responsibility: cover the end-to-end wiring for opening the commit graph, opening search, and closing search before the modal.

## Task 1: Add Failing Component Tests For Commit Graph Search

**Files:**
- Create: `apps/desktop/src/components/__tests__/CommitGraphView.test.ts`
- Modify later: `apps/desktop/src/components/CommitGraphView.vue`
- Test: `apps/desktop/src/components/__tests__/CommitGraphView.test.ts`

- [ ] **Step 1: Write the failing test file for search open, search scope, and focus return**

```ts
// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import CommitGraphView from "../CommitGraphView.vue";
import { clearContextShortcuts, resetContext } from "../../composables/useShortcutContext";

const invokeMock = vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>();

vi.mock("../../invoke", () => ({
  invoke: (...args: [string, Record<string, unknown> | undefined]) => invokeMock(...args),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

async function flushPromises() {
  await Promise.resolve();
  await nextTick();
}

function graphResult() {
  return {
    head_commit: "aaa1111111111111111111111111111111111111",
    commits: [
      {
        hash: "aaa1111111111111111111111111111111111111",
        short_hash: "aaa1111",
        message: "feat: add search bar",
        author: "Jeremy Hale",
        timestamp: 1710000000,
        parents: ["bbb2222222222222222222222222222222222222"],
        refs: ["main", "origin/main"],
      },
      {
        hash: "bbb2222222222222222222222222222222222222",
        short_hash: "bbb2222",
        message: "fix: stabilize graph layout",
        author: "Graph Bot",
        timestamp: 1709990000,
        parents: [],
        refs: ["v0.3.2"],
      },
    ],
  };
}

describe("CommitGraphView", () => {
  afterEach(() => {
    invokeMock.mockReset();
    clearContextShortcuts("graph");
    resetContext();
    document.body.innerHTML = "";
  });

  it("opens search with slash and focuses the input", async () => {
    invokeMock.mockResolvedValue(graphResult());

    const wrapper = mount(CommitGraphView, {
      props: { repoPath: "/repo" },
      attachTo: document.body,
    });

    await flushPromises();
    await flushPromises();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    await flushPromises();

    const input = wrapper.get(".search-input");
    expect(document.activeElement).toBe(input.element);
  });

  it("matches message, author, hash, and refs", async () => {
    invokeMock.mockResolvedValue(graphResult());

    const wrapper = mount(CommitGraphView, {
      props: { repoPath: "/repo" },
      attachTo: document.body,
    });

    await flushPromises();
    await flushPromises();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    await flushPromises();

    const input = wrapper.get(".search-input");

    await input.setValue("Jeremy");
    expect(wrapper.get(".search-count").text()).toBe("1/1");

    await input.setValue("aaa1111");
    expect(wrapper.get(".search-count").text()).toBe("1/1");

    await input.setValue("origin/main");
    expect(wrapper.get(".search-count").text()).toBe("1/1");
  });

  it("returns focus to the graph after confirming search with Enter", async () => {
    invokeMock.mockResolvedValue(graphResult());

    const wrapper = mount(CommitGraphView, {
      props: { repoPath: "/repo" },
      attachTo: document.body,
    });

    await flushPromises();
    await flushPromises();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    await flushPromises();

    const input = wrapper.get(".search-input");
    await input.setValue("graph");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(document.activeElement).toBe(wrapper.get(".graph-scroll").element);
  });
});
```

- [ ] **Step 2: Run the component test file to verify it fails for the right reasons**

Run:

```bash
pnpm --dir apps/desktop test -- src/components/__tests__/CommitGraphView.test.ts
```

Expected:

- FAIL because `.search-input` does not exist yet
- FAIL because `CommitGraphView` has no search state, no count label, and no focus handoff on `Enter`

- [ ] **Step 3: Implement the minimal search state and UI in `CommitGraphView.vue`**

Add the missing imports and search state near the top of `CommitGraphView.vue`:

```ts
import { ref, computed, onMounted, nextTick, watch } from "vue";
import { useI18n } from "vue-i18n";
import { macOsTextInputAttrs } from "../utils/textInput";

const { t } = useI18n();

const searchInputRef = ref<HTMLInputElement | null>(null);
const isSearching = ref(false);
const searchQuery = ref("");
const currentMatch = ref(1);

const searchableCommits = computed(() =>
  layout.value.commits.map((commit) => ({
    hash: commit.hash,
    row: commit.y,
    text: [
      commit.message,
      commit.hash,
      commit.short_hash,
      commit.author,
      ...commit.refs,
    ].join("\n").toLowerCase(),
  }))
);

const searchMatches = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return [];
  return searchableCommits.value.filter((commit) => commit.text.includes(q));
});

const searchCountLabel = computed(() => {
  if (!searchQuery.value) return "";
  if (!searchMatches.value.length) return t("commitGraph.searchNoMatches");
  return `${currentMatch.value}/${searchMatches.value.length}`;
});
```

Add search helpers and focus handling:

```ts
function openSearch() {
  isSearching.value = true;
}

function closeSearch() {
  isSearching.value = false;
  searchQuery.value = "";
  currentMatch.value = 1;
}

function scrollToCommit(hash: string) {
  if (!scrollRef.value) return;
  const row = layout.value.commits.find((commit) => commit.hash === hash);
  if (!row) return;
  const targetY = py(row.y) - scrollRef.value.clientHeight / 2;
  scrollRef.value.scrollTop = Math.max(0, targetY);
}

function activateCurrentMatch() {
  if (!searchMatches.value.length) return;
  const index = Math.max(1, Math.min(currentMatch.value, searchMatches.value.length)) - 1;
  scrollToCommit(searchMatches.value[index].hash);
}

function nextMatch() {
  if (!searchMatches.value.length) return;
  currentMatch.value =
    currentMatch.value >= searchMatches.value.length ? 1 : currentMatch.value + 1;
  activateCurrentMatch();
}

function prevMatch() {
  if (!searchMatches.value.length) return;
  currentMatch.value =
    currentMatch.value <= 1 ? searchMatches.value.length : currentMatch.value - 1;
  activateCurrentMatch();
}

watch(searchMatches, (matches) => {
  currentMatch.value = matches.length ? 1 : 1;
  if (matches.length) {
    nextTick(() => activateCurrentMatch());
  }
});

watch(isSearching, (searching) => {
  if (searching) {
    nextTick(() => searchInputRef.value?.focus());
  }
});
```

Wire search keys into the existing `useLessScroll()` handler:

```ts
useLessScroll(scrollRef, {
  extraHandler: (e: KeyboardEvent) => {
    const noMods = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
    const meta = e.metaKey || e.ctrlKey;

    if (e.key === "/" && noMods) {
      e.preventDefault();
      openSearch();
      return true;
    }

    if (meta && e.key === "f" && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      openSearch();
      return true;
    }

    if (e.key === "n" && noMods && isSearching.value) {
      e.preventDefault();
      nextMatch();
      return true;
    }

    if (e.key === "N" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && isSearching.value) {
      e.preventDefault();
      prevMatch();
      return true;
    }

    if (e.key === " " && noMods) {
      e.preventDefault();
      toggleMode();
      return true;
    }

    return false;
  },
  onClose: () => emit("close"),
});
```

Add the search bar in the template:

```vue
<div v-if="isSearching" class="search-bar">
  <span class="search-prefix">/</span>
  <input
    ref="searchInputRef"
    v-model="searchQuery"
    v-bind="macOsTextInputAttrs"
    class="search-input"
    :placeholder="$t('commitGraph.searchPlaceholder')"
    @keydown="handleSearchInputKeydown"
  />
  <span v-if="searchQuery" class="search-count">{{ searchCountLabel }}</span>
</div>
```

Add the input key handler:

```ts
function handleSearchInputKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    closeSearch();
    nextTick(() => scrollRef.value?.focus());
    return;
  }

  if (e.key === "Enter") {
    e.preventDefault();
    if (e.shiftKey) {
      prevMatch();
    } else {
      nextMatch();
    }
    nextTick(() => scrollRef.value?.focus());
  }
}
```

- [ ] **Step 4: Run the component test file to verify the new search behavior passes**

Run:

```bash
pnpm --dir apps/desktop test -- src/components/__tests__/CommitGraphView.test.ts
```

Expected:

- PASS for slash-open and focus
- PASS for message/author/hash/ref matching
- PASS for focus returning to `.graph-scroll` on `Enter`

- [ ] **Step 5: Commit the first green slice**

```bash
git add apps/desktop/src/components/CommitGraphView.vue apps/desktop/src/components/__tests__/CommitGraphView.test.ts
git commit -m "feat: add commit graph search UI"
```

## Task 2: Add Row Highlighting, Layered Dismiss, and App Wiring

**Files:**
- Modify: `apps/desktop/src/components/CommitGraphView.vue`
- Modify: `apps/desktop/src/components/CommitGraphModal.vue`
- Modify: `apps/desktop/src/App.vue`
- Modify: `apps/desktop/src/App.test.ts`
- Test: `apps/desktop/src/components/__tests__/CommitGraphView.test.ts`
- Test: `apps/desktop/src/App.test.ts`

- [ ] **Step 1: Extend the graph view tests to cover match highlighting and view-level dismiss**

Append tests like these to `CommitGraphView.test.ts`:

```ts
it("marks the active and inactive matching rows", async () => {
  invokeMock.mockResolvedValue({
    head_commit: "aaa1111111111111111111111111111111111111",
    commits: [
      {
        hash: "aaa1111111111111111111111111111111111111",
        short_hash: "aaa1111",
        message: "fix graph search",
        author: "Jeremy Hale",
        timestamp: 1710000000,
        parents: ["bbb2222222222222222222222222222222222222"],
        refs: ["main"],
      },
      {
        hash: "bbb2222222222222222222222222222222222222",
        short_hash: "bbb2222",
        message: "search follow-up",
        author: "Jeremy Hale",
        timestamp: 1709990000,
        parents: [],
        refs: [],
      },
    ],
  });

  const wrapper = mount(CommitGraphView, {
    props: { repoPath: "/repo" },
    attachTo: document.body,
  });

  await flushPromises();
  await flushPromises();

  window.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
  await flushPromises();

  await wrapper.get(".search-input").setValue("search");
  await flushPromises();

  expect(wrapper.findAll(".commit-row.is-search-match")).toHaveLength(2);
  expect(wrapper.findAll(".commit-row.is-search-active")).toHaveLength(1);
});

it("dismiss closes search before allowing the modal to close", async () => {
  invokeMock.mockResolvedValue(graphResult());

  const wrapper = mount(CommitGraphView, {
    props: { repoPath: "/repo" },
    attachTo: document.body,
  });

  await flushPromises();
  await flushPromises();

  window.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
  await flushPromises();

  expect(wrapper.find(".search-input").exists()).toBe(true);

  const firstDismissResult = (wrapper.vm as { dismiss: () => boolean }).dismiss();
  await flushPromises();

  expect(firstDismissResult).toBe(false);
  expect(wrapper.find(".search-input").exists()).toBe(false);

  const secondDismissResult = (wrapper.vm as { dismiss: () => boolean }).dismiss();
  expect(secondDismissResult).toBe(true);
});
```

Add one App-level regression test in `App.test.ts` by replacing the simple `CommitGraphModal: true` stub with a stub that exposes `dismiss()` and by asserting the first app dismiss keeps `showCommitGraphModal` true:

```ts
const dismissMock = vi.fn(() => false);

const wrapper = mount(App, {
  global: {
    stubs: {
      CommitGraphModal: defineComponent({
        setup(_, { expose }) {
          expose({ dismiss: dismissMock, zIndex: 1, bringToFront: vi.fn() });
          return () => h("div", { class: "commit-graph-stub" });
        },
      }),
    },
  },
});

wrapper.vm.showCommitGraphModal = true;
await nextTick();

const handled = (wrapper.vm as { actions: { dismiss: () => boolean } }).actions.dismiss();

expect(handled).toBe(true);
expect(dismissMock).toHaveBeenCalledTimes(1);
expect(wrapper.vm.showCommitGraphModal).toBe(true);
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
pnpm --dir apps/desktop test -- src/components/__tests__/CommitGraphView.test.ts src/App.test.ts
```

Expected:

- FAIL because commit rows do not have search-match classes yet
- FAIL because `CommitGraphView` does not expose `dismiss()`
- FAIL because `App.vue` still closes the commit graph immediately

- [ ] **Step 3: Implement row classes and a view-level `dismiss()` in `CommitGraphView.vue`**

Add helpers:

```ts
const matchedHashes = computed(() => new Set(searchMatches.value.map((match) => match.hash)));

const activeMatchHash = computed(() => {
  if (!searchMatches.value.length) return null;
  const index = Math.max(1, Math.min(currentMatch.value, searchMatches.value.length)) - 1;
  return searchMatches.value[index]?.hash ?? null;
});

function dismiss(): boolean {
  if (isSearching.value) {
    closeSearch();
    return false;
  }

  return true;
}

defineExpose({ dismiss });
```

Update the commit row class binding:

```vue
<div
  v-for="commit in visibleCommits"
  :key="'t' + commit.hash"
  class="commit-row"
  :class="{
    'is-search-match': matchedHashes.has(commit.hash),
    'is-search-active': activeMatchHash === commit.hash,
  }"
  :style="{ top: py(commit.y) - 8 + 'px' }"
>
```

Add row highlight styles:

```css
.commit-row.is-search-match {
  background: rgba(88, 166, 255, 0.08);
  border-radius: 4px;
}

.commit-row.is-search-active {
  background: rgba(88, 166, 255, 0.18);
  box-shadow: 0 0 0 1px rgba(88, 166, 255, 0.35);
}
```

- [ ] **Step 4: Forward dismiss through `CommitGraphModal.vue` and use it from `App.vue`**

In `CommitGraphModal.vue`, hold a child ref and expose `dismiss()`:

```ts
const graphViewRef = ref<InstanceType<typeof CommitGraphView> | null>(null);

function dismiss(): boolean {
  return graphViewRef.value?.dismiss() ?? true;
}

defineExpose({ zIndex, bringToFront, dismiss });
```

Update the template ref:

```vue
<CommitGraphView
  ref="graphViewRef"
  :repo-path="repoPath"
  :worktree-path="worktreePath"
  @close="emit('close')"
/>
```

In `App.vue`, change the commit-graph dismiss branch from direct close:

```ts
if (showCommitGraphModal.value) { showCommitGraphModal.value = false; return true; }
```

to delegated layered dismiss:

```ts
if (showCommitGraphModal.value) {
  const shouldCloseCommitGraph = commitGraphModalRef.value?.dismiss() ?? true;
  if (shouldCloseCommitGraph) {
    showCommitGraphModal.value = false;
  }
  return true;
}
```

- [ ] **Step 5: Run the focused tests again to verify dismiss and highlighting now pass**

Run:

```bash
pnpm --dir apps/desktop test -- src/components/__tests__/CommitGraphView.test.ts src/App.test.ts
```

Expected:

- PASS for matched-row and active-row styling assertions
- PASS for `dismiss()` closing search first
- PASS for `App.vue` leaving the commit graph modal open on the first dismiss

- [ ] **Step 6: Commit the dismiss and highlight slice**

```bash
git add apps/desktop/src/components/CommitGraphView.vue apps/desktop/src/components/CommitGraphModal.vue apps/desktop/src/App.vue apps/desktop/src/components/__tests__/CommitGraphView.test.ts apps/desktop/src/App.test.ts
git commit -m "feat: layer commit graph search dismissal"
```

## Task 3: Add Graph Search Copy, Shortcut Help, and No-Match Coverage

**Files:**
- Modify: `apps/desktop/src/components/CommitGraphView.vue`
- Modify: `apps/desktop/src/i18n/locales/en.json`
- Modify: `apps/desktop/src/i18n/locales/ja.json`
- Modify: `apps/desktop/src/i18n/locales/ko.json`
- Test: `apps/desktop/src/components/__tests__/CommitGraphView.test.ts`

- [ ] **Step 1: Add failing tests for no-match copy and graph shortcut registration**

Add tests like these:

```ts
it("shows the no-matches label when the query finds nothing", async () => {
  invokeMock.mockResolvedValue(graphResult());

  const wrapper = mount(CommitGraphView, {
    props: { repoPath: "/repo" },
    attachTo: document.body,
    global: {
      mocks: {
        $t: (key: string) => key,
      },
    },
  });

  await flushPromises();
  await flushPromises();

  window.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
  await flushPromises();

  await wrapper.get(".search-input").setValue("does-not-exist");
  await flushPromises();

  expect(wrapper.get(".search-count").text()).toBe("commitGraph.searchNoMatches");
});
```

Add a registration assertion by reading the graph context shortcuts after mount:

```ts
import { getContextShortcuts } from "../../composables/useShortcutContext";

expect(getContextShortcuts("graph")).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ action: "commitGraph.shortcutSearch", keys: "/" }),
    expect.objectContaining({ action: "commitGraph.shortcutSearchAlt", keys: "⌘F" }),
    expect.objectContaining({ action: "commitGraph.shortcutNextPrevMatch", keys: "n / N" }),
  ])
);
```

- [ ] **Step 2: Run the component test file to verify the copy/shortcut expectations fail**

Run:

```bash
pnpm --dir apps/desktop test -- src/components/__tests__/CommitGraphView.test.ts
```

Expected:

- FAIL because `commitGraph` has no search locale keys yet
- FAIL because the `"graph"` context does not register search-related shortcut labels yet

- [ ] **Step 3: Add the i18n strings and graph shortcut labels**

In `CommitGraphView.vue`, replace hard-coded graph shortcut labels:

```ts
registerContextShortcuts("graph", [
  { label: t("commitGraph.shortcutSearch"), display: "/" },
  { label: t("commitGraph.shortcutSearchAlt"), display: "⌘F" },
  { label: t("commitGraph.shortcutNextPrevMatch"), display: "n / N" },
  { label: t("commitGraph.shortcutLineUpDown"), display: "j / k" },
  { label: t("commitGraph.shortcutPageUpDown"), display: "f / b" },
  { label: t("commitGraph.shortcutHalfUpDown"), display: "d / u" },
  { label: t("commitGraph.shortcutTopBottom"), display: "g / G" },
  { label: t("commitGraph.shortcutToggleMode"), display: "Space" },
  { label: t("commitGraph.shortcutClose"), display: "q" },
]);
```

Add a new `commitGraph` locale object in each locale file:

```json
"commitGraph": {
  "searchPlaceholder": "Search commits, hashes, authors, and refs",
  "searchNoMatches": "No matches",
  "shortcutSearch": "Search",
  "shortcutSearchAlt": "Search (alt)",
  "shortcutNextPrevMatch": "Next / Prev match",
  "shortcutLineUpDown": "Line ↓/↑",
  "shortcutPageUpDown": "Page ↓/↑",
  "shortcutHalfUpDown": "Half ↓/↑",
  "shortcutTopBottom": "Top / Bottom",
  "shortcutToggleMode": "Toggle auto / all",
  "shortcutClose": "Close"
}
```

- [ ] **Step 4: Run the component test file again**

Run:

```bash
pnpm --dir apps/desktop test -- src/components/__tests__/CommitGraphView.test.ts
```

Expected:

- PASS for no-match copy
- PASS for graph shortcut registration

- [ ] **Step 5: Commit the copy and help-overlay slice**

```bash
git add apps/desktop/src/components/CommitGraphView.vue apps/desktop/src/i18n/locales/en.json apps/desktop/src/i18n/locales/ja.json apps/desktop/src/i18n/locales/ko.json apps/desktop/src/components/__tests__/CommitGraphView.test.ts
git commit -m "feat: add commit graph search copy"
```

## Task 4: Add Mock E2E Coverage For Commit Graph Search

**Files:**
- Create: `apps/desktop/tests/e2e/mock/commit-graph.test.ts`
- Test: `apps/desktop/tests/e2e/mock/commit-graph.test.ts`

- [ ] **Step 1: Write the failing mock E2E test**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { WebDriverClient } from "../helpers/webdriver";
import { resetDatabase, importTestRepo } from "../helpers/reset";
import { cleanupFixtureRepos, createFixtureRepo } from "../helpers/fixture-repo";

describe("commit graph", () => {
  const client = new WebDriverClient();
  let fixtureRepoRoot = "";
  let testRepoPath = "";

  beforeAll(async () => {
    await client.createSession();
    await resetDatabase(client);
    fixtureRepoRoot = await createFixtureRepo("commit-graph-test");
    testRepoPath = join(fixtureRepoRoot, "apps");
    await importTestRepo(client, testRepoPath, "commit-graph-test");
  });

  afterAll(async () => {
    await cleanupFixtureRepos(fixtureRepoRoot ? [fixtureRepoRoot] : []);
    await client.deleteSession();
  });

  it("opens search inside the commit graph and closes search before the modal", async () => {
    await client.executeSync(
      "window.__KANNA_E2E__.setupState.showCommitGraphModal = true;"
    );

    await client.waitForElement(".graph-scroll", 5000);

    await client.keys(["/"]);
    await client.waitForElement(".graph-modal .search-input", 5000);

    await client.setValue(".graph-modal .search-input", "main");
    expect(await client.getText(".graph-modal .search-count")).toContain("/");

    await client.keys(["Escape"]);
    expect(await client.hasElement(".graph-modal .search-input")).toBe(false);
    expect(await client.hasElement(".graph-modal")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the mock E2E test to verify it fails**

Run:

```bash
pnpm --dir apps/desktop test:e2e -- commit-graph.test.ts
```

Expected:

- FAIL because the commit graph does not expose `.search-input`
- or FAIL because `Escape` still closes the whole modal instead of the search layer first

- [ ] **Step 3: Adjust selectors or minor view wiring if the E2E reveals a real gap**

If the E2E needs stable selectors, add them in `CommitGraphView.vue`:

```vue
<div v-if="isSearching" class="search-bar" data-testid="commit-graph-search">
```

and:

```vue
<input
  ref="searchInputRef"
  v-model="searchQuery"
  data-testid="commit-graph-search-input"
  ...
/>
```

Keep selectors minimal and only add them if the existing classes are not stable enough in practice.

- [ ] **Step 4: Run the mock E2E test again**

Run:

```bash
pnpm --dir apps/desktop test:e2e -- commit-graph.test.ts
```

Expected:

- PASS for opening commit-graph search
- PASS for `Escape` closing the search layer while leaving the modal open

- [ ] **Step 5: Commit the E2E coverage**

```bash
git add apps/desktop/tests/e2e/mock/commit-graph.test.ts apps/desktop/src/components/CommitGraphView.vue
git commit -m "test: cover commit graph search"
```

## Task 5: Final Verification

**Files:**
- Verify only

- [ ] **Step 1: Run the targeted frontend test suite**

Run:

```bash
pnpm --dir apps/desktop test -- src/components/__tests__/CommitGraphView.test.ts src/App.test.ts
```

Expected:

- PASS

- [ ] **Step 2: Run the mock E2E coverage for the new flow**

Run:

```bash
pnpm --dir apps/desktop test:e2e -- commit-graph.test.ts
```

Expected:

- PASS

- [ ] **Step 3: Run TypeScript verification for the desktop app**

Run:

```bash
pnpm --dir apps/desktop exec vue-tsc --noEmit
```

Expected:

- PASS with no TypeScript errors

- [ ] **Step 4: Review git diff for scope**

Run:

```bash
git diff --stat HEAD~4..HEAD
git diff -- apps/desktop/src/components/CommitGraphView.vue apps/desktop/src/components/CommitGraphModal.vue apps/desktop/src/App.vue apps/desktop/src/i18n/locales/en.json apps/desktop/src/i18n/locales/ja.json apps/desktop/src/i18n/locales/ko.json apps/desktop/src/components/__tests__/CommitGraphView.test.ts apps/desktop/src/App.test.ts apps/desktop/tests/e2e/mock/commit-graph.test.ts
```

Expected:

- Only commit-graph search behavior, copy, dismiss wiring, and tests are included

- [ ] **Step 5: Create the final integration commit**

```bash
git add apps/desktop/src/components/CommitGraphView.vue apps/desktop/src/components/CommitGraphModal.vue apps/desktop/src/App.vue apps/desktop/src/i18n/locales/en.json apps/desktop/src/i18n/locales/ja.json apps/desktop/src/i18n/locales/ko.json apps/desktop/src/components/__tests__/CommitGraphView.test.ts apps/desktop/src/App.test.ts apps/desktop/tests/e2e/mock/commit-graph.test.ts
git commit -m "feat: add commit graph search"
```
