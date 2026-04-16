# Add Repo Cmd+Enter Submission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Cmd+Enter` submit from every text input in `AddRepoModal`, while preserving plain `Enter` and `Escape` behavior for the inline local repo rename field.

**Architecture:** Keep the change inside `AddRepoModal.vue` by adding explicit modifier-submit handlers at the input level instead of trying to make the window-level keydown handler win event ordering. The local repo rename field gets a dedicated helper that first commits the current draft using the existing fallback rules and then immediately routes through the normal submit path. Focused component tests in `AddRepoModal.test.ts` lock down create, clone/import, and local-rename submission behavior.

**Tech Stack:** Vue 3 with `<script setup lang="ts">`, Vitest, Vue Test Utils, pnpm

---

## File Map

- `apps/desktop/src/components/AddRepoModal.vue`
  Owns modal-local keyboard handling, rename draft commit behavior, and submit routing for create/import/clone.
- `apps/desktop/src/components/__tests__/AddRepoModal.test.ts`
  Verifies `Cmd+Enter` behavior for create input, import-or-clone input, and local repo rename input without changing existing plain `Enter` semantics.

### Task 1: Lock Down Cmd+Enter Behavior With Failing Tests

**Files:**
- Modify: `apps/desktop/src/components/__tests__/AddRepoModal.test.ts`

- [ ] **Step 1: Write the failing tests for `Cmd+Enter` across the modal inputs**

Add three tests to `apps/desktop/src/components/__tests__/AddRepoModal.test.ts`:

```ts
it("submits create when Cmd+Enter is pressed in the create name input", async () => {
  const wrapper = mountModal("create");

  await flushPromises();

  const createInput = wrapper.get('input[placeholder="addRepo.namePlaceholder"]');
  await createInput.setValue("my-app");
  await createInput.trigger("keydown", { key: "Enter", metaKey: true });
  await flushPromises();

  expect(wrapper.emitted("create")).toEqual([
    ["my-app", "/Users/me/.kanna/repos/my-app"],
  ]);
});

it("submits clone when Cmd+Enter is pressed in the import input", async () => {
  const wrapper = mountModal();

  await flushPromises();

  const importInput = wrapper.get('input[placeholder="addRepo.importPlaceholder"]');
  await importInput.setValue("owner/repo");
  await flushPromises();

  await importInput.trigger("keydown", { key: "Enter", metaKey: true });
  await flushPromises();

  expect(wrapper.emitted("clone")).toEqual([
    ["https://github.com/owner/repo.git", "/Users/me/.kanna/repos/repo"],
  ]);
});

it("submits import immediately with the edited draft when Cmd+Enter is pressed in the local repo rename input", async () => {
  const wrapper = mountModal();

  await flushPromises();

  const importInput = wrapper.get('input[placeholder="addRepo.importPlaceholder"]');
  await importInput.setValue("/Users/me/code/project");
  await flushPromises();

  await wrapper.get(".repo-name-change").trigger("click");
  await flushPromises();

  const repoNameInput = wrapper.get('input[placeholder="addRepo.repoNamePlaceholder"]');
  await repoNameInput.setValue("Project Desktop");
  await repoNameInput.trigger("keydown", { key: "Enter", metaKey: true });
  await flushPromises();

  expect(wrapper.emitted("import")).toEqual([
    ["/Users/me/code/project", "Project Desktop", "main"],
  ]);
});
```

- [ ] **Step 2: Run the focused modal test file and verify the new cases fail for the current implementation**

Run: `pnpm --dir apps/desktop test -- __tests__/AddRepoModal.test.ts`

Expected: FAIL because `Cmd+Enter` in the rename input is currently handled by the plain `@keydown.enter.stop.prevent="commitLocalRepoRename"` path, and the other text inputs do not yet have explicit input-level modifier submit handlers.

- [ ] **Step 3: Commit the red test-only state**

Run:

```bash
git add apps/desktop/src/components/__tests__/AddRepoModal.test.ts
git commit -m "test: cover add repo cmd-enter submission"
```

### Task 2: Implement Input-Level Cmd+Enter Submission

**Files:**
- Modify: `apps/desktop/src/components/AddRepoModal.vue`

- [ ] **Step 1: Add explicit helper functions for modifier submission**

Add these helpers to `apps/desktop/src/components/AddRepoModal.vue` near the existing submit and rename helpers:

```ts
function isMetaEnter(event: KeyboardEvent): boolean {
  return event.key === "Enter" && event.metaKey && !event.ctrlKey && !event.altKey;
}

function submitFromInput(event: KeyboardEvent) {
  if (!isMetaEnter(event)) return;
  event.preventDefault();
  event.stopPropagation();
  handleSubmit();
}

function commitLocalRepoRenameAndSubmit(event: KeyboardEvent) {
  if (!isMetaEnter(event)) return;
  event.preventDefault();
  event.stopPropagation();
  commitLocalRepoRename();
  handleSubmit();
}
```

These helpers keep plain `Enter` behavior separate from `Cmd+Enter` behavior and avoid depending on the window-level `handleKeydown()` listener.

- [ ] **Step 2: Wire `Cmd+Enter` to the create and import text inputs**

Update the create and import inputs in `apps/desktop/src/components/AddRepoModal.vue`:

```vue
<input
  ref="createInputRef"
  v-model="createName"
  v-bind="macOsTextInputAttrs"
  class="text-input"
  type="text"
  :placeholder="$t('addRepo.namePlaceholder')"
  @keydown="submitFromInput"
/>
```

```vue
<input
  ref="importInputRef"
  v-model="importInput"
  v-bind="macOsTextInputAttrs"
  class="text-input"
  type="text"
  :placeholder="$t('addRepo.importPlaceholder')"
  :disabled="cloning"
  @keydown="submitFromInput"
/>
```

The helper itself filters to `Cmd+Enter`, so other keys remain unchanged.

- [ ] **Step 3: Wire `Cmd+Enter` in the local repo rename input to commit-then-submit**

Update both rename input render paths in `apps/desktop/src/components/AddRepoModal.vue`:

```vue
<input
  ref="localRepoNameInputRef"
  v-model="localRepoNameDraft"
  v-bind="macOsTextInputAttrs"
  class="text-input"
  type="text"
  :placeholder="$t('addRepo.repoNamePlaceholder')"
  @blur="commitLocalRepoRename"
  @keydown="commitLocalRepoRenameAndSubmit"
  @keydown.enter.stop.prevent="commitLocalRepoRename"
  @keydown.escape.stop.prevent="cancelLocalRepoRename"
/>
```

The generic `@keydown` handler must be declared before the specialized plain-Enter handler so `Cmd+Enter` is handled by `commitLocalRepoRenameAndSubmit()`, while plain `Enter` still runs `commitLocalRepoRename()` only.

- [ ] **Step 4: Run the focused modal test file and verify the new behavior is green**

Run: `pnpm --dir apps/desktop test -- __tests__/AddRepoModal.test.ts`

Expected: PASS, including the new create, clone, and local-rename `Cmd+Enter` tests.

- [ ] **Step 5: Commit the implementation**

Run:

```bash
git add apps/desktop/src/components/AddRepoModal.vue
git commit -m "feat: submit add repo modal with cmd-enter"
```

### Task 3: Final Verification And Diff Review

**Files:**
- Modify: `apps/desktop/src/components/AddRepoModal.vue`
- Modify: `apps/desktop/src/components/__tests__/AddRepoModal.test.ts`

- [ ] **Step 1: Re-run the focused modal test file from the final head**

Run: `pnpm --dir apps/desktop test -- __tests__/AddRepoModal.test.ts`

Expected: PASS with the Add Repo modal tests green.

- [ ] **Step 2: Run app-level TypeScript verification**

Run: `pnpm --dir apps/desktop exec vue-tsc --noEmit`

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Review the final diff**

Run:

```bash
git status --short
git diff -- apps/desktop/src/components/AddRepoModal.vue \
  apps/desktop/src/components/__tests__/AddRepoModal.test.ts
```

Expected: only the modal component, the focused test file, and any unrelated pre-existing worktree files appear.

- [ ] **Step 4: Commit any verification-driven fixes**

If verification reveals a defect, fix it and run:

```bash
git add apps/desktop/src/components/AddRepoModal.vue \
  apps/desktop/src/components/__tests__/AddRepoModal.test.ts
git commit -m "test: finish add repo cmd-enter verification"
```
