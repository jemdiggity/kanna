# Repo Import Rename Affordance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change local repo import to show the detected repo name as static text with a separate `change` link that opens rename mode on demand.

**Architecture:** Keep the change inside `AddRepoModal.vue` by introducing a small amount of local UI state for the derived name, rename mode, and rename draft. Preserve the existing import emit contract and clone flow, and lock the new interaction down in focused component tests before changing the template. Add one new locale key for the inline label so the new row renders correctly in shipped builds.

**Tech Stack:** Vue 3 with `<script setup lang="ts">`, Vitest with Vue Test Utils, vue-i18n locale JSON, pnpm

---

## File Map

- `apps/desktop/src/components/AddRepoModal.vue`
  Owns local import state, focus management, inline rename interactions, and the emitted import payload.
- `apps/desktop/src/components/__tests__/AddRepoModal.test.ts`
  Defines the component contract for detected local repos, rename affordance behavior, keyboard handling, and import payloads.
- `apps/desktop/src/i18n/locales/en.json`
  Adds the shipped English label for the collapsed repo-name row.
- `apps/desktop/src/i18n/locales/ja.json`
  Adds the shipped Japanese label for the collapsed repo-name row.
- `apps/desktop/src/i18n/locales/ko.json`
  Adds the shipped Korean label for the collapsed repo-name row.

### Task 1: Collapse The Local Repo Name UI Behind A Change Link

**Files:**
- Modify: `apps/desktop/src/components/__tests__/AddRepoModal.test.ts`
- Modify: `apps/desktop/src/components/AddRepoModal.vue`
- Modify: `apps/desktop/src/i18n/locales/en.json`
- Modify: `apps/desktop/src/i18n/locales/ja.json`
- Modify: `apps/desktop/src/i18n/locales/ko.json`

- [ ] **Step 1: Write the failing tests for the collapsed repo-name row and rename-on-demand flow**

Update the component test fixture so it can answer for more than one local repo path, then add one new behavior test and rewrite the existing focus test around the new interaction.

```ts
const localRepos: Record<string, { branch: string; remote: string }> = {
  "/Users/me/code/project": {
    branch: "main",
    remote: "git@github.com:owner/project.git",
  },
  "/Users/me/code/second-project": {
    branch: "develop",
    remote: "git@github.com:owner/second-project.git",
  },
};

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (command: string, args?: { path?: string; repoPath?: string }) => {
    if (command === "file_exists") {
      return !!(args?.path && localRepos[args.path]);
    }
    if (command === "git_default_branch" && args?.repoPath) {
      return localRepos[args.repoPath]?.branch ?? false;
    }
    if (command === "git_remote_url" && args?.repoPath) {
      return localRepos[args.repoPath]?.remote ?? false;
    }
    return false;
  }),
}));

it("renders a detected repo name as text until rename is requested", async () => {
  const wrapper = mountModal();

  await flushPromises();
  await wrapper.get('input[placeholder="addRepo.importPlaceholder"]').setValue("/Users/me/code/project");
  await flushPromises();

  expect(wrapper.find('input[placeholder="addRepo.repoNamePlaceholder"]').exists()).toBe(false);
  expect(wrapper.get(".repo-name-label").text()).toBe("addRepo.repoNameLabel");
  expect(wrapper.get(".repo-name-value").text()).toBe("project");

  await wrapper.get(".repo-name-change").trigger("click");
  await flushPromises();

  const renameInput = wrapper.get('input[placeholder="addRepo.repoNamePlaceholder"]');
  expect(document.activeElement).toBe(renameInput.element);
  expect(renameInput.element).toHaveProperty("selectionStart", 0);
  expect(renameInput.element).toHaveProperty("selectionEnd", "project".length);

  await renameInput.setValue("Project Desktop");
  await renameInput.trigger("keydown", { key: "Enter" });
  await flushPromises();

  expect(wrapper.get(".repo-name-value").text()).toBe("Project Desktop");

  await wrapper.get(".btn-primary").trigger("click");

  expect(wrapper.emitted("import")).toEqual([
    ["/Users/me/code/project", "Project Desktop", "main"],
  ]);
});

it("keeps focus on the import input until rename mode is explicitly opened", async () => {
  const wrapper = mountModal("create");

  await flushPromises();

  const createInput = wrapper.get('input[placeholder="addRepo.namePlaceholder"]');
  const tabs = wrapper.findAll("button.tab");
  const createTab = tabs[0];
  const importTab = tabs[1];

  createInput.element.focus();
  await flushPromises();

  const importMouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  importTab.element.dispatchEvent(importMouseDown);
  expect(importMouseDown.defaultPrevented).toBe(true);

  await importTab.trigger("click");
  await flushPromises();

  const importInput = wrapper.get('input[placeholder="addRepo.importPlaceholder"]');
  expect(document.activeElement).toBe(importInput.element);

  await importInput.setValue("/Users/me/code/project");
  await flushPromises();

  expect(document.activeElement).toBe(importInput.element);

  await wrapper.get(".repo-name-change").trigger("click");
  await flushPromises();

  expect(document.activeElement).toBe(wrapper.get('input[placeholder="addRepo.repoNamePlaceholder"]').element);
});
```

- [ ] **Step 2: Run the focused test file and verify the new assertions fail for the right reason**

Run: `pnpm exec vitest run apps/desktop/src/components/__tests__/AddRepoModal.test.ts`

Expected: FAIL with assertions showing the current component still renders `input[placeholder="addRepo.repoNamePlaceholder"]` immediately and does not render `.repo-name-label`, `.repo-name-value`, or `.repo-name-change`.

- [ ] **Step 3: Implement the collapsed row, explicit change link, and on-demand focus behavior**

Update `AddRepoModal.vue` so the local import section keeps the input hidden until rename mode starts. Add a derived-name ref for fallback, a boolean for rename mode, and helper methods that open rename mode and commit the edited name. Keep the current `localRepoName` as the committed value for this first pass.

Add the new locale key in all three shipped locale files:

```json
"repoNameLabel": "Repository name"
```

```json
"repoNameLabel": "リポジトリ名"
```

```json
"repoNameLabel": "저장소 이름"
```

In `AddRepoModal.vue`, introduce the local rename state and helper methods:

```ts
const localRepoName = ref("");
const localDerivedRepoName = ref("");
const isEditingLocalRepoName = ref(false);

const shouldFocusLocalRepoName = computed(() =>
  activeTab.value === "import" &&
  !!activeLocalPath.value &&
  localIsGitRepo.value &&
  !localLoading.value &&
  isEditingLocalRepoName.value,
);

function resetLocalRepoState() {
  localRepoName.value = "";
  localDerivedRepoName.value = "";
  localBranch.value = "main";
  localRemote.value = "";
  localPathExists.value = false;
  localIsGitRepo.value = false;
  localLoading.value = false;
  isEditingLocalRepoName.value = false;
}

function startLocalRepoRename() {
  if (!localIsGitRepo.value || localLoading.value) return;
  isEditingLocalRepoName.value = true;
  void nextTick(() => {
    localRepoNameInputRef.value?.focus();
    localRepoNameInputRef.value?.select();
  });
}

function commitLocalRepoRename() {
  localRepoName.value = localRepoName.value.trim() || localDerivedRepoName.value;
  isEditingLocalRepoName.value = false;
}
```

Set the derived name during path inspection:

```ts
async function inspectLocalPath(dirPath: string) {
  const inspectionId = ++localInspectVersion.value;
  localLoading.value = true;

  const derivedName = deriveRepoName(dirPath);
  localDerivedRepoName.value = derivedName;
  localRepoName.value = derivedName;
  isEditingLocalRepoName.value = false;

  try {
    const exists = await invoke<boolean>("file_exists", { path: dirPath });
    if (inspectionId !== localInspectVersion.value) return;

    localPathExists.value = exists;
    if (!exists) {
      localIsGitRepo.value = false;
      localBranch.value = "main";
      localRemote.value = "";
      return;
    }

    try {
      const branch = await invoke<string>("git_default_branch", { repoPath: dirPath });
      if (inspectionId !== localInspectVersion.value) return;
      localBranch.value = branch || "main";
      localIsGitRepo.value = true;
      try {
        const remote = await invoke<string>("git_remote_url", { repoPath: dirPath });
        if (inspectionId !== localInspectVersion.value) return;
        localRemote.value = remote;
      } catch {
        if (inspectionId !== localInspectVersion.value) return;
        localRemote.value = "";
      }
    } catch {
      if (inspectionId !== localInspectVersion.value) return;
      localIsGitRepo.value = false;
      localBranch.value = "main";
      localRemote.value = "";
    }
  } finally {
    if (inspectionId === localInspectVersion.value) {
      localLoading.value = false;
    }
  }
}
```

Replace the always-visible input with a collapsed summary row plus a conditional input:

```vue
<div v-if="localIsGitRepo && !localLoading" class="name-field">
  <template v-if="isEditingLocalRepoName">
    <input
      ref="localRepoNameInputRef"
      v-model="localRepoName"
      v-bind="macOsTextInputAttrs"
      class="text-input"
      type="text"
      :placeholder="$t('addRepo.repoNamePlaceholder')"
      @keydown.enter.stop.prevent="commitLocalRepoRename"
      @blur="commitLocalRepoRename"
    />
  </template>
  <template v-else>
    <div class="repo-name-row">
      <span class="repo-name-label">{{ $t('addRepo.repoNameLabel') }}</span>
      <span class="repo-name-value">{{ localRepoName }}</span>
      <a class="change-link repo-name-change" @click="startLocalRepoRename">{{ $t('addRepo.change') }}</a>
    </div>
  </template>
</div>
```

Add only the minimal styling needed for the new row:

```css
.repo-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
}

.repo-name-label {
  font-size: 11px;
  color: #777;
}

.repo-name-value {
  color: #e0e0e0;
}
```

- [ ] **Step 4: Re-run the focused tests and verify the first behavior set is green**

Run: `pnpm exec vitest run apps/desktop/src/components/__tests__/AddRepoModal.test.ts`

Expected: PASS for the new collapsed-row test and the updated focus test.

- [ ] **Step 5: Commit the first working slice**

Run:

```bash
git add apps/desktop/src/components/AddRepoModal.vue \
  apps/desktop/src/components/__tests__/AddRepoModal.test.ts \
  apps/desktop/src/i18n/locales/en.json \
  apps/desktop/src/i18n/locales/ja.json \
  apps/desktop/src/i18n/locales/ko.json
git commit -m "feat: collapse repo import rename behind change link"
```

### Task 2: Add Cancel, Fallback, And Path-Reset Semantics

**Files:**
- Modify: `apps/desktop/src/components/__tests__/AddRepoModal.test.ts`
- Modify: `apps/desktop/src/components/AddRepoModal.vue`

- [ ] **Step 1: Write the failing tests for Escape cancel, empty-value fallback, and path-change reset**

Add two more tests so the remaining spec requirements are enforced before refactoring the component state.

```ts
it("cancels an in-progress rename with Escape and keeps the last committed name", async () => {
  const wrapper = mountModal();

  await flushPromises();
  await wrapper.get('input[placeholder="addRepo.importPlaceholder"]').setValue("/Users/me/code/project");
  await flushPromises();

  await wrapper.get(".repo-name-change").trigger("click");
  await flushPromises();

  const renameInput = wrapper.get('input[placeholder="addRepo.repoNamePlaceholder"]');
  await renameInput.setValue("Project Desktop");
  await renameInput.trigger("keydown", { key: "Enter" });
  await flushPromises();

  await wrapper.get(".repo-name-change").trigger("click");
  await flushPromises();

  const secondRenameInput = wrapper.get('input[placeholder="addRepo.repoNamePlaceholder"]');
  await secondRenameInput.setValue("Temporary Name");
  await secondRenameInput.trigger("keydown", { key: "Escape" });
  await flushPromises();

  expect(wrapper.get(".repo-name-value").text()).toBe("Project Desktop");

  await wrapper.get(".btn-primary").trigger("click");
  expect(wrapper.emitted("import")).toEqual([
    ["/Users/me/code/project", "Project Desktop", "main"],
  ]);
});

it("falls back to the derived name when cleared and resets when the local path changes", async () => {
  const wrapper = mountModal();

  await flushPromises();
  const importInput = wrapper.get('input[placeholder="addRepo.importPlaceholder"]');

  await importInput.setValue("/Users/me/code/project");
  await flushPromises();

  await wrapper.get(".repo-name-change").trigger("click");
  await flushPromises();

  const renameInput = wrapper.get('input[placeholder="addRepo.repoNamePlaceholder"]');
  await renameInput.setValue("");
  await renameInput.trigger("blur");
  await flushPromises();

  expect(wrapper.get(".repo-name-value").text()).toBe("project");

  await importInput.setValue("/Users/me/code/second-project");
  await flushPromises();

  expect(wrapper.get(".repo-name-value").text()).toBe("second-project");
});
```

- [ ] **Step 2: Run the focused tests again and verify these new cases fail**

Run: `pnpm exec vitest run apps/desktop/src/components/__tests__/AddRepoModal.test.ts`

Expected: FAIL because the current implementation edits `localRepoName` in place, so `Escape` cannot restore the previous committed value, and path changes do not preserve a separate committed-versus-draft state.

- [ ] **Step 3: Refactor the component to use committed and draft rename state**

Introduce a rename draft ref and a path tracker so the component can cancel edits cleanly and reset when the inspected path changes. Update the input handlers to stop `Escape` and `Enter` from bubbling to the window-level modal handlers.

```ts
const localRepoName = ref("");
const localRepoNameDraft = ref("");
const localDerivedRepoName = ref("");
const localRepoNamePath = ref<string | null>(null);
const isEditingLocalRepoName = ref(false);

function resetLocalRepoState() {
  localRepoName.value = "";
  localRepoNameDraft.value = "";
  localDerivedRepoName.value = "";
  localRepoNamePath.value = null;
  localBranch.value = "main";
  localRemote.value = "";
  localPathExists.value = false;
  localIsGitRepo.value = false;
  localLoading.value = false;
  isEditingLocalRepoName.value = false;
}

function startLocalRepoRename() {
  if (!localIsGitRepo.value || localLoading.value) return;
  localRepoNameDraft.value = localRepoName.value;
  isEditingLocalRepoName.value = true;
  void nextTick(() => {
    localRepoNameInputRef.value?.focus();
    localRepoNameInputRef.value?.select();
  });
}

function commitLocalRepoRename() {
  localRepoName.value = localRepoNameDraft.value.trim() || localDerivedRepoName.value;
  localRepoNameDraft.value = "";
  isEditingLocalRepoName.value = false;
}

function cancelLocalRepoRename() {
  localRepoNameDraft.value = "";
  isEditingLocalRepoName.value = false;
}
```

Only replace the committed name when the inspected path actually changes:

```ts
async function inspectLocalPath(dirPath: string) {
  const inspectionId = ++localInspectVersion.value;
  localLoading.value = true;

  const derivedName = deriveRepoName(dirPath);
  const isNewPath = localRepoNamePath.value !== dirPath;

  localDerivedRepoName.value = derivedName;
  if (isNewPath) {
    localRepoNamePath.value = dirPath;
    localRepoName.value = derivedName;
    localRepoNameDraft.value = "";
    isEditingLocalRepoName.value = false;
  }

  try {
    const exists = await invoke<boolean>("file_exists", { path: dirPath });
    if (inspectionId !== localInspectVersion.value) return;

    localPathExists.value = exists;
    if (!exists) {
      localIsGitRepo.value = false;
      localBranch.value = "main";
      localRemote.value = "";
      return;
    }

    try {
      const branch = await invoke<string>("git_default_branch", { repoPath: dirPath });
      if (inspectionId !== localInspectVersion.value) return;
      localBranch.value = branch || "main";
      localIsGitRepo.value = true;
      try {
        const remote = await invoke<string>("git_remote_url", { repoPath: dirPath });
        if (inspectionId !== localInspectVersion.value) return;
        localRemote.value = remote;
      } catch {
        if (inspectionId !== localInspectVersion.value) return;
        localRemote.value = "";
      }
    } catch {
      if (inspectionId !== localInspectVersion.value) return;
      localIsGitRepo.value = false;
      localBranch.value = "main";
      localRemote.value = "";
    }
  } finally {
    if (inspectionId === localInspectVersion.value) {
      localLoading.value = false;
    }
  }
}
```

Bind the input to the draft value and stop rename keystrokes from reaching `window.addEventListener("keydown", handleKeydown)`:

```vue
<input
  ref="localRepoNameInputRef"
  v-model="localRepoNameDraft"
  v-bind="macOsTextInputAttrs"
  class="text-input"
  type="text"
  :placeholder="$t('addRepo.repoNamePlaceholder')"
  @keydown.enter.stop.prevent="commitLocalRepoRename"
  @keydown.escape.stop.prevent="cancelLocalRepoRename"
  @blur="commitLocalRepoRename"
/>
```

- [ ] **Step 4: Re-run the focused tests and verify the full local-import rename contract passes**

Run: `pnpm exec vitest run apps/desktop/src/components/__tests__/AddRepoModal.test.ts`

Expected: PASS for absolute-path import, tilde-path import, collapsed rename affordance, focus behavior, `Escape` cancel, empty blur fallback, and path-change reset.

- [ ] **Step 5: Commit the completed interaction behavior**

Run:

```bash
git add apps/desktop/src/components/AddRepoModal.vue \
  apps/desktop/src/components/__tests__/AddRepoModal.test.ts
git commit -m "feat: add inline rename affordance to repo import"
```

### Task 3: Run Final Verification And Capture The Finished State

**Files:**
- Modify: `apps/desktop/src/components/AddRepoModal.vue`
- Modify: `apps/desktop/src/components/__tests__/AddRepoModal.test.ts`
- Modify: `apps/desktop/src/i18n/locales/en.json`
- Modify: `apps/desktop/src/i18n/locales/ja.json`
- Modify: `apps/desktop/src/i18n/locales/ko.json`

- [ ] **Step 1: Run the focused component tests one more time from a clean working tree**

Run: `pnpm exec vitest run apps/desktop/src/components/__tests__/AddRepoModal.test.ts`

Expected: PASS with all `AddRepoModal` tests green.

- [ ] **Step 2: Run TypeScript verification for the repo root**

Run: `pnpm exec tsc --noEmit`

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Review the final diff before handing the branch back**

Run:

```bash
git status --short
git diff -- apps/desktop/src/components/AddRepoModal.vue \
  apps/desktop/src/components/__tests__/AddRepoModal.test.ts \
  apps/desktop/src/i18n/locales/en.json \
  apps/desktop/src/i18n/locales/ja.json \
  apps/desktop/src/i18n/locales/ko.json
```

Expected: Only the modal, its focused tests, and the three locale files are changed.

- [ ] **Step 4: Commit any verification-driven cleanup**

If Step 3 required no follow-up edits, skip this step. Otherwise run:

```bash
git add apps/desktop/src/components/AddRepoModal.vue \
  apps/desktop/src/components/__tests__/AddRepoModal.test.ts \
  apps/desktop/src/i18n/locales/en.json \
  apps/desktop/src/i18n/locales/ja.json \
  apps/desktop/src/i18n/locales/ko.json
git commit -m "test: finish repo import rename affordance verification"
```
