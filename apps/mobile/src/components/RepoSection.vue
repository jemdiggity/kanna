<script setup lang="ts">
import type { MobileTask } from "../lib/mobile-types";
import TaskRow from "./TaskRow.vue";

defineProps<{
  repoId: string;
  repoName: string;
  tasks: MobileTask[];
}>();

defineEmits<{
  select: [task: MobileTask];
}>();
</script>

<template>
  <section class="repo-section">
    <h2>{{ repoName }}</h2>
    <TaskRow
      v-for="task in tasks"
      :key="task.id"
      :task="task"
      @select="$emit('select', $event)"
    />
  </section>
</template>

<style scoped>
.repo-section + .repo-section {
  margin-top: 24px;
}

h2 {
  margin-bottom: 4px;
  color: #7b5a20;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
</style>
