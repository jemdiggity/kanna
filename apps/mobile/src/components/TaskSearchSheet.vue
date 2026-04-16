<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { MobileTask } from "../lib/mobile-types";

const props = defineProps<{
  visible: boolean;
  tasks: MobileTask[];
}>();

defineEmits<{
  close: [];
  select: [task: MobileTask];
}>();

const query = ref("");

const filteredTasks = computed(() => {
  const normalizedQuery = query.value.trim().toLowerCase();
  if (!normalizedQuery) return props.tasks;

  return props.tasks.filter((task) => {
    const haystacks = [
      task.title,
      task.repoName,
      task.displayName ?? "",
      task.prompt ?? "",
      task.lastOutputPreview,
      task.stage,
    ];

    return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery));
  });
});

watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      query.value = "";
    }
  },
);
</script>

<template>
  <div v-if="visible" class="search-overlay" @click.self="$emit('close')">
    <section class="search-sheet">
      <div class="sheet-header">
        <input
          v-model="query"
          type="text"
          placeholder="Search tasks"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
        />
        <button type="button" @click="$emit('close')">Done</button>
      </div>

      <div class="results">
        <button
          v-for="task in filteredTasks"
          :key="task.id"
          :data-task-id="task.id"
          class="result-row"
          type="button"
          @click="$emit('select', task)"
        >
          <div class="result-head">
            <span class="title">{{ task.title }}</span>
            <span class="stage">{{ task.stage }}</span>
          </div>
          <div class="meta">{{ task.repoName }}</div>
          <div class="preview">{{ task.lastOutputPreview || "No recent agent output yet." }}</div>
        </button>

        <p v-if="filteredTasks.length === 0" class="empty">No matching tasks.</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.search-overlay {
  position: fixed;
  inset: 0;
  z-index: 35;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  background: rgba(24, 19, 15, 0.24);
  padding-top: calc(env(safe-area-inset-top) + 12px);
}

.search-sheet {
  width: calc(100% - 24px);
  max-width: 720px;
  border: 1px solid rgba(86, 74, 56, 0.12);
  border-radius: 24px;
  background: rgba(255, 250, 242, 0.97);
  backdrop-filter: blur(18px);
  box-shadow: 0 18px 40px rgba(39, 32, 24, 0.16);
  overflow: hidden;
}

.sheet-header {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 14px;
  border-bottom: 1px solid rgba(86, 74, 56, 0.1);
}

.sheet-header input {
  flex: 1;
  border: 1px solid rgba(86, 74, 56, 0.12);
  border-radius: 14px;
  background: #fff;
  padding: 12px 14px;
  color: #201c16;
}

.sheet-header button {
  border: none;
  background: transparent;
  color: #6f675c;
  font-weight: 600;
}

.results {
  max-height: min(70dvh, 560px);
  overflow-y: auto;
  padding: 0 14px 14px;
}

.result-row {
  width: 100%;
  border: none;
  border-bottom: 1px solid rgba(86, 74, 56, 0.08);
  background: transparent;
  padding: 14px 0;
  text-align: left;
}

.result-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.title {
  font-weight: 700;
  color: #1f1b15;
}

.stage {
  color: #82652e;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.meta {
  margin-top: 4px;
  color: #6e675e;
  font-size: 12px;
}

.preview {
  margin-top: 6px;
  color: #5d564d;
  font-size: 13px;
  line-height: 1.4;
}

.empty {
  margin: 0;
  padding: 24px 0 8px;
  text-align: center;
  color: #766e63;
}
</style>
