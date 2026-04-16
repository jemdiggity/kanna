<script setup lang="ts">
import type { MobileTab } from "../lib/mobile-types";

defineProps<{
  currentTab: MobileTab;
}>();

defineEmits<{
  select: [tab: MobileTab];
}>();

const tabs: Array<{ id: MobileTab; label: string }> = [
  { id: "tasks", label: "Tasks" },
  { id: "recent", label: "Recent" },
  { id: "more", label: "More" },
];
</script>

<template>
  <nav class="toolbar">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="toolbar-button"
      :class="{ active: currentTab === tab.id }"
      type="button"
      @click="$emit('select', tab.id)"
    >
      {{ tab.label }}
    </button>
  </nav>
</template>

<style scoped>
.toolbar {
  position: fixed;
  left: 16px;
  right: 16px;
  bottom: calc(env(safe-area-inset-bottom) + 12px);
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 8px;
  border: 1px solid rgba(60, 53, 43, 0.14);
  border-radius: 24px;
  background: rgba(255, 250, 242, 0.92);
  backdrop-filter: blur(18px);
  box-shadow: 0 18px 40px rgba(47, 39, 28, 0.14);
}

.toolbar-button {
  border: none;
  border-radius: 18px;
  background: transparent;
  color: #6e675e;
  font-size: 13px;
  font-weight: 600;
  padding: 12px 10px;
}

.toolbar-button.active {
  background: #312d27;
  color: #fff8ef;
}
</style>
