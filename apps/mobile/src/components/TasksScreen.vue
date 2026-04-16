<script setup lang="ts">
import type { MobileTask } from "../lib/mobile-types";
import RepoSection from "./RepoSection.vue";

interface TaskGroup {
  repoId: string;
  repoName: string;
  tasks: MobileTask[];
}

defineProps<{
  groups: TaskGroup[];
}>();

defineEmits<{
  select: [task: MobileTask];
}>();
</script>

<template>
  <div class="tasks-screen">
    <p v-if="groups.length === 0" class="empty">No active tasks.</p>
    <RepoSection
      v-for="group in groups"
      :key="group.repoId"
      :repo-id="group.repoId"
      :repo-name="group.repoName"
      :tasks="group.tasks"
      @select="$emit('select', $event)"
    />
  </div>
</template>

<style scoped>
.tasks-screen {
  padding: 0 16px 120px;
}

.empty {
  padding: 40px 0;
  color: #766e63;
  text-align: center;
}
</style>
