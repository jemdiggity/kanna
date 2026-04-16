<script setup lang="ts">
import type { MobileTask } from "../lib/mobile-types";

defineProps<{
  task: MobileTask;
  showRepoName?: boolean;
}>();

defineEmits<{
  select: [task: MobileTask];
}>();
</script>

<template>
  <button class="task-row" type="button" @click="$emit('select', task)">
    <div class="title-line">
      <span class="title">{{ task.title }}</span>
      <span class="stage">{{ task.stage }}</span>
    </div>
    <p v-if="showRepoName" class="repo-name">{{ task.repoName }}</p>
    <p class="preview">{{ task.lastOutputPreview || "No recent agent output yet." }}</p>
  </button>
</template>

<style scoped>
.task-row {
  width: 100%;
  border: none;
  border-bottom: 1px solid rgba(90, 82, 71, 0.12);
  background: transparent;
  color: inherit;
  text-align: left;
  padding: 14px 0;
}

.title-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.title {
  font-size: 15px;
  font-weight: 700;
  color: #1f1b15;
}

.stage {
  flex-shrink: 0;
  color: #82652e;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.repo-name {
  margin-top: 4px;
  color: #6e675e;
  font-size: 12px;
  font-weight: 600;
}

.preview {
  margin-top: 6px;
  color: #5d564d;
  font-size: 13px;
  line-height: 1.4;
}
</style>
