<script setup lang="ts">
import type { MobileTask } from "../lib/mobile-types";
import TaskRow from "./TaskRow.vue";

defineProps<{
  tasks: MobileTask[];
}>();

defineEmits<{
  select: [task: MobileTask];
}>();
</script>

<template>
  <div class="recent-screen">
    <p v-if="tasks.length === 0" class="empty">No recent task updates.</p>
    <TaskRow
      v-for="task in tasks"
      :key="task.id"
      :task="task"
      show-repo-name
      @select="$emit('select', $event)"
    />
  </div>
</template>

<style scoped>
.recent-screen {
  padding: 0 16px 120px;
}

.empty {
  padding: 40px 0;
  color: #766e63;
  text-align: center;
}
</style>
