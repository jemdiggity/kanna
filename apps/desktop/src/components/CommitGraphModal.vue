<script setup lang="ts">
import { ref, onMounted, nextTick } from "vue";
import CommitGraphView from "./CommitGraphView.vue";
import { useShortcutContext } from "../composables/useShortcutContext";
import { useModalZIndex } from "../composables/useModalZIndex";
useShortcutContext("graph");
const { zIndex, bringToFront } = useModalZIndex();
const graphViewRef = ref<InstanceType<typeof CommitGraphView> | null>(null);

function dismiss(): boolean {
  return graphViewRef.value?.dismiss() ?? true;
}

defineExpose({ zIndex, bringToFront, dismiss });

const modalRef = ref<HTMLElement | null>(null);

defineProps<{
  repoPath: string;
  worktreePath?: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

onMounted(() => {
  nextTick(() => modalRef.value?.focus());
});
</script>

<template>
  <div class="modal-overlay" :style="{ zIndex }" @click.self="emit('close')">
    <div ref="modalRef" class="graph-modal" tabindex="-1">
      <CommitGraphView
        ref="graphViewRef"
        :repo-path="repoPath"
        :worktree-path="worktreePath"
        @close="emit('close')"
      />
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

.graph-modal {
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 8px;
  width: 90vw;
  height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  outline: none;
}
</style>
