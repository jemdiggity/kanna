<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
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
const pipelineCurrentValueId = "pipeline-current-value";
const pipelineToggleId = "pipeline-toggle";
const pipelinePickerId = "pipeline-picker";
const suppressNextPipelineOptionClick = ref(false);
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
const visibleBaseBranches = computed(() =>
  filterBaseBranchCandidates(
    props.baseBranches ?? [],
    baseBranchQuery.value,
    defaultBranchName.value,
  ),
);
const textareaRef = ref<HTMLTextAreaElement>();

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
    e.preventDefault();
    suppressNextPipelineOptionClick.value = true;
    handlePipelineSelect(options[index]);
    return;
  }

  if (e.key === "Escape") {
    e.preventDefault();
    showPipelinePicker.value = false;
    document.getElementById(pipelineToggleId)?.focus();
  }
}

function handlePipelineOptionClick(pipeline: string) {
  if (suppressNextPipelineOptionClick.value) {
    suppressNextPipelineOptionClick.value = false;
    return;
  }

  handlePipelineSelect(pipeline);
}

function handleKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    handleSubmit();
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
    <div class="modal">
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
          @keydown="handleKeydown"
        />
        <div class="pipeline-row">
          <label :id="pipelineLabelId" class="pipeline-label">Pipeline</label>
          <div class="base-branch-row pipeline-value-row">
            <span :id="pipelineActionLabelId" class="sr-only">{{ $t("addRepo.change") }}</span>
            <span :id="pipelineValueId" class="base-branch-value" data-testid="pipeline-value">{{ selectedPipeline }}</span>
            <span :id="pipelineCurrentValueId" class="sr-only">current {{ selectedPipeline }}</span>
            <button
              :id="pipelineToggleId"
              type="button"
              class="change-link"
              data-testid="pipeline-toggle"
              :aria-controls="pipelinePickerId"
              :aria-expanded="showPipelinePicker"
              aria-haspopup="listbox"
              :aria-labelledby="`${pipelineActionLabelId} ${pipelineLabelId} ${pipelineCurrentValueId}`"
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
            class="base-branch-option"
            role="option"
            :class="{ selected: name === selectedPipeline }"
            :aria-selected="name === selectedPipeline"
            :data-testid="`pipeline-option-${name}`"
            :tabindex="name === selectedPipeline ? 0 : -1"
            @mousedown.prevent
            @click="handlePipelineOptionClick(name)"
            @keydown="handlePipelineOptionKeydown($event, index)"
          >
            {{ name }}
          </button>
        </div>
        <div class="pipeline-row">
          <label class="pipeline-label">{{ $t("tasks.baseBranch") }}</label>
          <div class="base-branch-row">
            <span class="base-branch-value" data-testid="base-branch-value">{{ selectedBaseBranch }}</span>
            <button
              type="button"
              class="change-link"
              data-testid="base-branch-toggle"
              @mousedown.prevent
              @click="showBaseBranchPicker = !showBaseBranchPicker"
            >
              {{ $t("addRepo.change") }}
            </button>
          </div>
        </div>

        <div v-if="showBaseBranchPicker" class="base-branch-picker">
          <input
            v-model="baseBranchQuery"
            v-bind="macOsTextInputAttrs"
            class="text-input"
            type="text"
            :placeholder="$t('tasks.baseBranchSearchPlaceholder')"
            data-testid="base-branch-search"
          />
          <button
            v-for="branch in visibleBaseBranches"
            :key="branch"
            type="button"
            class="base-branch-option"
            :class="{ selected: branch === selectedBaseBranch }"
            :data-testid="`base-branch-option-${branch}`"
            @mousedown.prevent
            @click="handleBaseBranchSelect(branch)"
          >
            {{ branch }}
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

.base-branch-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
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

.base-branch-option {
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

.base-branch-option:hover,
.base-branch-option.selected {
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
