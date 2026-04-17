<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { invoke } from "../invoke";
import type { AgentProvider } from "@kanna/db";
import { useModalZIndex } from "../composables/useModalZIndex";
import { registerContextShortcuts } from "../composables/useShortcutContext";
import { macOsTextInputAttrs } from "../utils/textInput";
import {
  filterBaseBranchCandidates,
  getDefaultBaseBranch,
} from "../utils/baseBranchPicker";
const { zIndex } = useModalZIndex();

registerContextShortcuts("newTask", [
  { label: "Switch agent", display: "⇧⌘[ / ⇧⌘]" },
]);

const props = defineProps<{
  defaultAgentProvider?: AgentProvider;
  pipelines?: string[];
  defaultPipeline?: string;
  baseBranches?: string[];
  defaultBaseBranch?: string;
  defaultBranchName?: string;
}>();

const emit = defineEmits<{
  submit: [prompt: string, agentProvider: AgentProvider, pipelineName: string, baseBranch?: string];
  cancel: [];
}>();

const prompt = ref("");
const agentProvider = ref<AgentProvider>(props.defaultAgentProvider ?? "claude");
const pipelineOptions = computed(() => {
  if (props.pipelines && props.pipelines.length > 0) return props.pipelines;
  return ["default"];
});
const selectedPipeline = ref<string>(props.defaultPipeline ?? pipelineOptions.value[0] ?? "default");
const showPipelinePicker = ref(false);
const pipelineLabelId = "pipeline-label";
const pipelineActionLabelId = "pipeline-action-label";
const pipelineValueId = "pipeline-value";
const pipelineToggleId = "pipeline-toggle";
const pipelinePickerId = "pipeline-picker";
const defaultBranchName = computed(() => props.defaultBranchName ?? "main");
const resolvedBaseBranch = computed(() => {
  if (props.defaultBaseBranch) return props.defaultBaseBranch;
  if (props.defaultBranchName) {
    return getDefaultBaseBranch(props.baseBranches ?? [], props.defaultBranchName) || props.defaultBranchName;
  }

  return getDefaultBaseBranch(props.baseBranches ?? [], defaultBranchName.value) || undefined;
});
const selectedBaseBranch = ref(resolvedBaseBranch.value ?? defaultBranchName.value);
const hasExplicitBaseBranchSelection = ref(false);
const showBaseBranchPicker = ref(false);
const baseBranchQuery = ref("");
const selectedBaseBranchIndex = ref(0);
const visibleBaseBranches = computed(() =>
  filterBaseBranchCandidates(
    props.baseBranches ?? [],
    baseBranchQuery.value,
    defaultBranchName.value,
  ),
);
const textareaRef = ref<HTMLTextAreaElement>();
const baseBranchSearchRef = ref<HTMLInputElement | null>(null);

const MAX_VISIBLE_BRANCH_ROWS = 7;
const BRANCH_ROW_HEIGHT_PX = 36;
const baseBranchOptionsMaxHeight = `${MAX_VISIBLE_BRANCH_ROWS * BRANCH_ROW_HEIGHT_PX}px`;

const providers: Array<AgentProvider> = ["claude", "copilot", "codex"];
const availableProviders = ref<Array<AgentProvider>>([...providers]);

function cycleProvider(direction: -1 | 1) {
  const idx = availableProviders.value.indexOf(agentProvider.value);
  if (idx === -1) return;
  agentProvider.value = availableProviders.value[(idx + direction + availableProviders.value.length) % availableProviders.value.length];
}

onMounted(async () => {
  textareaRef.value?.focus();
  try {
    // Detect installed CLIs and filter options
    const checks = await Promise.all(providers.map(async (p) => {
      try { await invoke("which_binary", { name: p }); return p; } catch { return null as AgentProvider | null; }
    }));
    const found = checks.filter(Boolean) as AgentProvider[];
    if (found.length > 0) availableProviders.value = found;
    else availableProviders.value = [...providers]; // if none detected, keep all options

    // Ensure selected provider is available; prefer defaultAgentProvider when provided
    const preferred = props.defaultAgentProvider ?? agentProvider.value;
    if (availableProviders.value.includes(preferred)) {
      agentProvider.value = preferred;
    } else {
      agentProvider.value = availableProviders.value[0];
    }
  } catch (e) {
    console.debug("[newtask] cli detection failed:", e);
  }
});

watch(baseBranchQuery, () => {
  selectedBaseBranchIndex.value = 0;
});

watch(showBaseBranchPicker, async (open) => {
  if (open) {
    baseBranchQuery.value = "";
    selectedBaseBranchIndex.value = Math.max(0, visibleBaseBranches.value.indexOf(selectedBaseBranch.value));
    await nextTick();
    baseBranchSearchRef.value?.focus();
    return;
  }

  baseBranchQuery.value = "";
  selectedBaseBranchIndex.value = 0;
});

function handleSubmit() {
  const text = prompt.value.trim();
  if (!text) return;
  const emittedBaseBranch = hasExplicitBaseBranchSelection.value ? selectedBaseBranch.value : undefined;
  emit("submit", text, agentProvider.value, selectedPipeline.value, emittedBaseBranch);
  prompt.value = "";
}

function handleBaseBranchSelect(branch: string) {
  selectedBaseBranch.value = branch;
  hasExplicitBaseBranchSelection.value = true;
  showBaseBranchPicker.value = false;
}

function toggleBaseBranchPicker() {
  showBaseBranchPicker.value = !showBaseBranchPicker.value;
}

function clampSelectedBaseBranchIndex(nextIndex: number): number {
  if (visibleBaseBranches.value.length === 0) return 0;
  return Math.min(Math.max(nextIndex, 0), visibleBaseBranches.value.length - 1);
}

function isSubmitShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.altKey;
}

function handleBaseBranchSearchKeydown(event: KeyboardEvent) {
  if (isSubmitShortcut(event)) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    showBaseBranchPicker.value = false;
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    selectedBaseBranchIndex.value = clampSelectedBaseBranchIndex(selectedBaseBranchIndex.value + 1);
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    selectedBaseBranchIndex.value = clampSelectedBaseBranchIndex(selectedBaseBranchIndex.value - 1);
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    const branch = visibleBaseBranches.value[selectedBaseBranchIndex.value];
    if (branch) handleBaseBranchSelect(branch);
  }
}

function handlePipelineSelect(pipeline: string) {
  selectedPipeline.value = pipeline;
  showPipelinePicker.value = false;
  nextTick(() => {
    document.getElementById(pipelineToggleId)?.focus();
  });
}

function focusPipelineOption(pipeline: string) {
  nextTick(() => {
    document.getElementById(`pipeline-option-${pipeline}`)?.focus();
  });
}

function focusSelectedPipelineOption() {
  focusPipelineOption(selectedPipeline.value);
}

function handlePipelineToggle() {
  showPipelinePicker.value = !showPipelinePicker.value;
  if (showPipelinePicker.value) focusSelectedPipelineOption();
}

function handlePipelineToggleKeydown(e: KeyboardEvent) {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (!showPipelinePicker.value) showPipelinePicker.value = true;
    focusSelectedPipelineOption();
    return;
  }

  if (e.key === "Escape" && showPipelinePicker.value) {
    e.preventDefault();
    showPipelinePicker.value = false;
  }
}

function handlePipelineOptionKeydown(e: KeyboardEvent, index: number) {
  const options = pipelineOptions.value;
  const lastIndex = options.length - 1;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    const nextIndex = index === lastIndex ? 0 : index + 1;
    focusPipelineOption(options[nextIndex]);
    return;
  }

  if (e.key === "ArrowUp") {
    e.preventDefault();
    const nextIndex = index === 0 ? lastIndex : index - 1;
    focusPipelineOption(options[nextIndex]);
    return;
  }

  if (e.key === "Home") {
    e.preventDefault();
    focusPipelineOption(options[0]);
    return;
  }

  if (e.key === "End") {
    e.preventDefault();
    focusPipelineOption(options[lastIndex]);
    return;
  }

  if (e.key === "Enter" || e.key === " ") {
    return;
  }

  if (e.key === "Escape") {
    e.preventDefault();
    showPipelinePicker.value = false;
    document.getElementById(pipelineToggleId)?.focus();
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.defaultPrevented) {
    return;
  }

  if (isSubmitShortcut(e)) {
    e.preventDefault();
    handleSubmit();
    return;
  }

  // ⇧⌘[ / ⇧⌘] to switch agent provider
  if (e.metaKey && e.shiftKey && (e.key === "[" || e.key === "{")) {
    e.preventDefault();
    e.stopPropagation();
    cycleProvider(-1);
    return;
  }
  if (e.metaKey && e.shiftKey && (e.key === "]" || e.key === "}")) {
    e.preventDefault();
    e.stopPropagation();
    cycleProvider(1);
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    emit("cancel");
  }
}
</script>

<template>
  <div class="modal-overlay" :style="{ zIndex }" @click.self="emit('cancel')">
    <div class="modal" @keydown="handleKeydown">
      <div class="modal-header">
        <h3>{{ $t('tasks.newTask') }}</h3>
        <button class="agent-provider" type="button" @mousedown.prevent @click="cycleProvider(1)">
          {{ agentProvider === 'claude' ? 'Claude' : agentProvider === 'copilot' ? 'Copilot' : 'Codex' }}
        </button>
      </div>
      <div class="modal-body">
        <textarea
          ref="textareaRef"
          v-model="prompt"
          v-bind="macOsTextInputAttrs"
          class="prompt-input"
          :placeholder="$t('tasks.descriptionPlaceholder')"
          rows="6"
        />
        <div class="pipeline-row">
          <label class="pipeline-label">{{ $t("tasks.baseBranch") }}</label>
          <div class="base-branch-dropdown-shell">
            <div class="base-branch-row">
              <span class="base-branch-value" data-testid="base-branch-value">{{ selectedBaseBranch }}</span>
              <button
                id="base-branch-toggle"
                type="button"
                class="change-link"
                data-testid="base-branch-toggle"
                @mousedown.prevent
                @click="toggleBaseBranchPicker"
              >
                <span data-testid="base-branch-change-link">{{ $t("addRepo.change") }}</span>
              </button>
            </div>

            <div
              v-if="showBaseBranchPicker"
              class="base-branch-dropdown"
              data-testid="base-branch-dropdown"
            >
              <input
                ref="baseBranchSearchRef"
                v-model="baseBranchQuery"
                v-bind="macOsTextInputAttrs"
                class="text-input base-branch-search"
                type="text"
                :placeholder="$t('tasks.baseBranchSearchPlaceholder')"
                data-testid="base-branch-search"
                @keydown="handleBaseBranchSearchKeydown"
              />
              <div
                class="base-branch-options"
                :style="{ maxHeight: baseBranchOptionsMaxHeight }"
                data-testid="base-branch-options"
              >
                <button
                  v-for="(branch, index) in visibleBaseBranches"
                  :key="branch"
                  type="button"
                  class="base-branch-option"
                  :class="{ selected: branch === selectedBaseBranch, active: index === selectedBaseBranchIndex }"
                  :data-testid="`base-branch-option-${branch}`"
                  @mouseenter="selectedBaseBranchIndex = index"
                  @mousedown.prevent
                  @click="handleBaseBranchSelect(branch)"
                >
                  {{ branch }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="pipeline-row">
          <label :id="pipelineLabelId" class="pipeline-label">Pipeline</label>
          <div class="base-branch-row pipeline-value-row">
            <span :id="pipelineActionLabelId" class="sr-only">{{ $t("addRepo.change") }}</span>
            <span :id="pipelineValueId" class="base-branch-value" data-testid="pipeline-value">{{ selectedPipeline }}</span>
            <button
              :id="pipelineToggleId"
              type="button"
              class="change-link"
              data-testid="pipeline-toggle"
              :aria-controls="pipelinePickerId"
              :aria-expanded="showPipelinePicker"
              aria-haspopup="listbox"
              :aria-labelledby="`${pipelineActionLabelId} ${pipelineLabelId} ${pipelineValueId}`"
              @mousedown.prevent
              @click="handlePipelineToggle"
              @keydown="handlePipelineToggleKeydown"
            >
              {{ $t("addRepo.change") }}
            </button>
          </div>
        </div>

        <div
          v-if="showPipelinePicker"
          :id="pipelinePickerId"
          class="base-branch-picker"
          role="listbox"
          :aria-labelledby="pipelineLabelId"
        >
          <button
            v-for="(name, index) in pipelineOptions"
            :key="name"
            :id="`pipeline-option-${name}`"
            type="button"
            class="pipeline-picker-option"
            role="option"
            :class="{ selected: name === selectedPipeline }"
            :aria-selected="name === selectedPipeline"
            :data-testid="`pipeline-option-${name}`"
            :tabindex="name === selectedPipeline ? 0 : -1"
            @mousedown.prevent
            @click="handlePipelineSelect(name)"
            @keydown="handlePipelineOptionKeydown($event, index)"
          >
            {{ name }}
          </button>
        </div>
      </div>
      <div class="modal-footer">
        <span class="hint">{{ $t('modals.submitHint', { action: $t('actions.submit').toLowerCase() }) }}</span>
        <div class="modal-actions">
          <button class="btn btn-cancel" @click="emit('cancel')">{{ $t('actions.cancel') }}</button>
          <button
            class="btn btn-primary"
            :disabled="!prompt.trim()"
            @click="handleSubmit"
          >
            {{ $t('actions.create') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal {
  background: #252525;
  border: 1px solid #444;
  border-radius: 8px;
  width: 480px;
  max-width: 90vw;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.modal-header {
  padding: 14px 16px 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #e0e0e0;
}

.agent-provider {
  padding: 0;
  background: transparent;
  border: none;
  font-size: 11px;
  font-weight: 600;
  color: #b8b8b8;
  cursor: pointer;
}

.agent-provider:hover {
  color: #d6d6d6;
}

.modal-body {
  padding: 12px 16px;
}

.prompt-input {
  width: 100%;
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 4px;
  color: #e0e0e0;
  font-family: "JetBrains Mono", "SF Mono", Menlo, monospace;
  font-size: 13px;
  padding: 10px;
  resize: vertical;
  outline: none;
  line-height: 1.5;
}

.prompt-input:focus {
  border-color: #0066cc;
}

.prompt-input::placeholder {
  color: #555;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.pipeline-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.pipeline-label {
  font-size: 11px;
  color: #888;
  white-space: nowrap;
}

.pipeline-value-row {
  flex: 1;
}

.base-branch-dropdown-shell {
  position: relative;
  flex: 1;
  min-width: 0;
}

.base-branch-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.base-branch-value {
  color: #e0e0e0;
  font-family: "JetBrains Mono", "SF Mono", Menlo, monospace;
  font-size: 12px;
  min-width: 0;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.change-link {
  padding: 0;
  background: transparent;
  border: none;
  color: #0066cc;
  cursor: pointer;
  font-size: 11px;
}

.change-link:hover {
  color: #0077ee;
  text-decoration: underline;
}

.base-branch-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 4;
  overflow: hidden;
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 8px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.42);
}

.text-input {
  width: 100%;
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 4px;
  color: #e0e0e0;
  font-size: 12px;
  padding: 6px 8px;
  outline: none;
}

.text-input:focus {
  border-color: #0066cc;
}

.base-branch-search {
  border: none;
  border-bottom: 1px solid #333;
  border-radius: 0;
}

.base-branch-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.base-branch-options {
  overflow-y: auto;
}

.base-branch-option {
  width: 100%;
  min-height: 36px;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  background: transparent;
  border: none;
  color: #b8b8b8;
  cursor: pointer;
  font-family: "JetBrains Mono", "SF Mono", Menlo, monospace;
  font-size: 12px;
  text-align: left;
}

.base-branch-option:hover,
.base-branch-option.active {
  background: #2d2d2d;
}

.base-branch-option.selected {
  color: #e0e0e0;
  font-weight: 600;
}

.pipeline-picker-option {
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

.pipeline-picker-option:hover,
.pipeline-picker-option.selected {
  border-color: #0066cc;
  color: #e0e0e0;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px 14px;
}

.hint {
  font-size: 11px;
  color: #555;
}

.modal-actions {
  display: flex;
  gap: 8px;
}

.btn {
  padding: 5px 14px;
  border-radius: 4px;
  border: 1px solid #444;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.btn-cancel {
  background: #2a2a2a;
  color: #ccc;
}

.btn-cancel:hover {
  background: #333;
}

.btn-primary {
  background: #0066cc;
  border-color: #0077ee;
  color: #fff;
}

.btn-primary:hover {
  background: #0077ee;
}

.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
