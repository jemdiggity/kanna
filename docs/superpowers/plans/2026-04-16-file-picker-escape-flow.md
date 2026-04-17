# File Picker Escape Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Escape` exit the file picker/file preview flow in one shot after inline search is dismissed, while preserving `q` as a preview-only close that returns to the picker.

**Architecture:** Keep preview-local layered behavior in `FilePreviewModal.vue`, especially search teardown and `q` handling through `useLessScroll`. Change `App.vue` so the centralized dismiss shortcut resets the entire file flow only after the preview says it has no local state left to dismiss.

**Tech Stack:** Vue 3, Vitest, Vue Test Utils, TypeScript

---

### Task 1: Lock the Behavior with Tests

**Files:**
- Modify: `apps/desktop/src/App.test.ts`
- Modify: `apps/desktop/src/components/__tests__/FilePreviewModal.test.ts`

- [ ] **Step 1: Write the failing app-level dismiss test**

```ts
it("Escape closes the entire file flow after preview-local dismiss is exhausted", async () => {
  // Open picker, select a file so preview opens from picker, then invoke dismiss.
  // Expect neither picker nor preview to remain visible.
});
```

- [ ] **Step 2: Run the targeted app test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/src/App.test.ts`
Expected: FAIL because `Escape` currently reopens the picker instead of clearing the whole file flow

- [ ] **Step 3: Write the failing preview-local close test**

```ts
it("q closes the preview and returns to the picker intent", async () => {
  // Mount the preview, trigger the exposed close path through window keydown,
  // and assert a close event without relying on Escape semantics.
});
```

- [ ] **Step 4: Run the targeted preview test to verify it fails or exposes the missing assertion**

Run: `pnpm exec vitest run apps/desktop/src/components/__tests__/FilePreviewModal.test.ts`
Expected: FAIL until the test correctly captures the close behavior distinction

### Task 2: Implement the Minimal File-Flow Reset

**Files:**
- Modify: `apps/desktop/src/App.vue`
- Modify: `apps/desktop/src/components/FilePreviewModal.vue`
- Test: `apps/desktop/src/App.test.ts`
- Test: `apps/desktop/src/components/__tests__/FilePreviewModal.test.ts`

- [ ] **Step 1: Change app-level dismiss to clear file-flow state only after preview-local dismiss is done**

```ts
function closeFileFlow() {
  showFilePreviewModal.value = false;
  showFilePickerModal.value = false;
  previewHidden.value = false;
  previewFromPicker.value = false;
}
```

- [ ] **Step 2: Keep preview-local dismiss layered**

```ts
function dismiss() {
  if (isSearching.value) {
    closeSearch();
    return false;
  }

  emit("close");
  return true;
}
```

- [ ] **Step 3: Re-run the targeted tests**

Run: `pnpm exec vitest run apps/desktop/src/App.test.ts apps/desktop/src/components/__tests__/FilePreviewModal.test.ts`
Expected: PASS

### Task 3: Verify Type Safety

**Files:**
- Verify only

- [ ] **Step 1: Run TypeScript verification**

Run: `pnpm exec tsc --noEmit`
Expected: PASS
