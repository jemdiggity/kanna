# New Task Pipeline Inline Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the new-task modal pipeline control from a native select to the same inline value plus subtle `change` interaction used by the base-branch control.

**Architecture:** Keep the change local to `NewTaskModal.vue` and its component tests. Add modal-local state for toggling the pipeline picker, derive a small pipeline options list from props with a `default` fallback, and reuse the existing inline-row and option-button styling patterns so submit behavior stays unchanged.

**Tech Stack:** Vue 3 with `<script setup lang="ts">`, Vitest, Vue Test Utils

---

## File Map

- `apps/desktop/src/components/NewTaskModal.vue`
  Responsibility: render the new-task modal, own local UI state for pipeline/base-branch selection, and emit the selected values on submit.
- `apps/desktop/src/components/__tests__/NewTaskModal.test.ts`
  Responsibility: verify modal behavior for provider switching, base-branch selection, and the new pipeline inline-picker flow.

### Task 1: Add Failing Tests For The Pipeline Inline Picker

**Files:**
- Modify: `apps/desktop/src/components/__tests__/NewTaskModal.test.ts`
- Test: `apps/desktop/src/components/__tests__/NewTaskModal.test.ts`

- [ ] **Step 1: Write the failing test for collapsed pipeline display and picker toggle**

```ts
it("shows the selected pipeline inline before the picker is opened", async () => {
  const wrapper = mount(NewTaskModal, {
    props: {
      pipelines: ["default", "review"],
      defaultPipeline: "review",
    },
    global: { mocks: { $t: (key: string) => key } },
  });

  await flushPromises();

  expect(wrapper.get('[data-testid="pipeline-value"]').text()).toContain("review");
  expect(wrapper.find('[data-testid="pipeline-option-default"]').exists()).toBe(false);

  await wrapper.get('[data-testid="pipeline-toggle"]').trigger("click");

  expect(wrapper.get('[data-testid="pipeline-option-default"]').exists()).toBe(true);
  expect(wrapper.get('[data-testid="pipeline-option-review"]').classes()).toContain("selected");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest apps/desktop/src/components/__tests__/NewTaskModal.test.ts -t "shows the selected pipeline inline before the picker is opened"`
Expected: FAIL because the modal still renders a native `select` and the new `data-testid` hooks do not exist yet

- [ ] **Step 3: Write the failing test for selection and submit behavior**

```ts
it("updates the selected pipeline through the inline picker before submit", async () => {
  const wrapper = mount(NewTaskModal, {
    props: {
      defaultAgentProvider: "claude",
      pipelines: ["default", "review"],
      defaultPipeline: "default",
      baseBranches: ["origin/main", "main"],
      defaultBaseBranch: "origin/main",
      defaultBranchName: "main",
    },
    global: { mocks: { $t: (key: string) => key } },
  });

  await flushPromises();
  await wrapper.get("textarea").setValue("Ship pipeline picker");
  await wrapper.get('[data-testid="pipeline-toggle"]').trigger("click");
  await wrapper.get('[data-testid="pipeline-option-review"]').trigger("click");
  await wrapper.get("textarea").trigger("keydown", { key: "Enter", metaKey: true });

  expect(wrapper.emitted("submit")).toEqual([
    ["Ship pipeline picker", "claude", "review", undefined],
  ]);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm exec vitest apps/desktop/src/components/__tests__/NewTaskModal.test.ts -t "updates the selected pipeline through the inline picker before submit"`
Expected: FAIL because pipeline selection still depends on the native `select`

- [ ] **Step 5: Write the failing test for the `default` fallback picker option**

```ts
it("uses a default pipeline option when no pipelines are provided", async () => {
  const wrapper = mount(NewTaskModal, {
    props: {},
    global: { mocks: { $t: (key: string) => key } },
  });

  await flushPromises();
  await wrapper.get('[data-testid="pipeline-toggle"]').trigger("click");

  expect(wrapper.get('[data-testid="pipeline-value"]').text()).toContain("default");
  expect(wrapper.get('[data-testid="pipeline-option-default"]').exists()).toBe(true);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm exec vitest apps/desktop/src/components/__tests__/NewTaskModal.test.ts -t "uses a default pipeline option when no pipelines are provided"`
Expected: FAIL because the inline pipeline picker does not exist yet

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/components/__tests__/NewTaskModal.test.ts
git commit -m "test: cover pipeline inline picker in new task modal"
```

### Task 2: Implement The Inline Pipeline Picker In The Modal

**Files:**
- Modify: `apps/desktop/src/components/NewTaskModal.vue`
- Modify: `apps/desktop/src/components/__tests__/NewTaskModal.test.ts`
- Test: `apps/desktop/src/components/__tests__/NewTaskModal.test.ts`

- [ ] **Step 1: Write the minimal implementation in the modal script**

```ts
const pipelineOptions = computed(() => {
  if (props.pipelines && props.pipelines.length > 0) return props.pipelines;
  return ["default"];
});

const selectedPipeline = ref<string>(props.defaultPipeline ?? pipelineOptions.value[0] ?? "default");
const showPipelinePicker = ref(false);

function handlePipelineSelect(pipeline: string) {
  selectedPipeline.value = pipeline;
  showPipelinePicker.value = false;
}
```

- [ ] **Step 2: Replace the native `select` with the inline row and picker**

```vue
<div class="pipeline-row">
  <label class="pipeline-label">Pipeline</label>
  <div class="pipeline-value-row">
    <span class="pipeline-value" data-testid="pipeline-value">{{ selectedPipeline }}</span>
    <button
      type="button"
      class="change-link"
      data-testid="pipeline-toggle"
      @mousedown.prevent
      @click="showPipelinePicker = !showPipelinePicker"
    >
      {{ $t("addRepo.change") }}
    </button>
  </div>
</div>

<div v-if="showPipelinePicker" class="pipeline-picker">
  <button
    v-for="name in pipelineOptions"
    :key="name"
    type="button"
    class="pipeline-option"
    :class="{ selected: name === selectedPipeline }"
    :data-testid="`pipeline-option-${name}`"
    @mousedown.prevent
    @click="handlePipelineSelect(name)"
  >
    {{ name }}
  </button>
</div>
```

- [ ] **Step 3: Add the minimal styles to match the base-branch row**

```css
.pipeline-value-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.pipeline-value {
  color: #e0e0e0;
  font-family: "JetBrains Mono", "SF Mono", Menlo, monospace;
  font-size: 12px;
}

.pipeline-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.pipeline-option {
  width: 100%;
  padding: 6px 8px;
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 4px;
  color: #b8b8b8;
  cursor: pointer;
  font-family: "JetBrains Mono", "SF Mono", Menlo, monospace;
  font-size: 12px;
  text-align: left;
}

.pipeline-option:hover,
.pipeline-option.selected {
  border-color: #0066cc;
  color: #e0e0e0;
}
```

- [ ] **Step 4: Run the component tests to verify they pass**

Run: `pnpm exec vitest apps/desktop/src/components/__tests__/NewTaskModal.test.ts`
Expected: PASS with the new pipeline inline-picker assertions and no regressions in the existing base-branch/provider tests

- [ ] **Step 5: Run TypeScript verification**

Run: `pnpm exec tsc --noEmit`
Expected: PASS with no new type errors from the modal or test changes

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/components/NewTaskModal.vue apps/desktop/src/components/__tests__/NewTaskModal.test.ts
git commit -m "feat: make new task pipeline picker inline"
```

## Self-Review

### Spec Coverage

- Inline collapsed pipeline value: covered in Task 1 steps 1-2 and Task 2 steps 1-2.
- `change` link opens an inline picker: covered in Task 1 steps 1-2 and Task 2 step 2.
- Selecting a pipeline updates submit output: covered in Task 1 steps 3-4 and Task 2 step 2.
- `default` fallback when no pipelines are provided: covered in Task 1 steps 5-6 and Task 2 step 1.
- Lightweight style matching the base-branch row: covered in Task 2 step 3.

### Placeholder Scan

No `TBD`, `TODO`, deferred steps, or unspecified verification commands remain.

### Type Consistency

- `selectedPipeline` stays a `Ref<string>`.
- `pipelineOptions` is a computed string array derived from `props.pipelines`.
- Test selectors match the planned `data-testid` names in the template.
