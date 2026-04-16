<script setup lang="ts">
import type { MobileTask } from "../lib/mobile-types";
import TerminalView from "./TerminalView.vue";

defineProps<{
  task: MobileTask;
}>();

defineEmits<{
  back: [];
}>();
</script>

<template>
  <section class="task-screen">
    <header class="task-header">
      <button class="back-button" type="button" @click="$emit('back')">‹</button>
      <div class="task-heading">
        <h1>{{ task.title }}</h1>
        <p>{{ task.repoName }} · {{ task.stage }}</p>
      </div>
    </header>
    <TerminalView :task="task" @back="$emit('back')" />
  </section>
</template>

<style scoped>
.task-screen {
  min-height: 100dvh;
}

.task-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px 10px;
  border-bottom: 1px solid rgba(73, 68, 61, 0.12);
  background: rgba(248, 243, 234, 0.96);
  backdrop-filter: blur(14px);
}

.back-button {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 999px;
  background: rgba(49, 45, 39, 0.1);
  color: #2f2a24;
  font-size: 22px;
  line-height: 1;
}

.task-heading {
  min-width: 0;
}

.task-heading h1 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #1f1b15;
}

.task-heading p {
  margin: 4px 0 0;
  color: #6e675e;
  font-size: 12px;
}
</style>
