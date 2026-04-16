<script setup lang="ts">
import type { MobileCommand } from "../lib/mobile-types";

defineProps<{
  visible: boolean;
  title: string;
  commands: MobileCommand[];
}>();

defineEmits<{
  close: [];
  execute: [commandId: string];
}>();
</script>

<template>
  <div v-if="visible" class="sheet-overlay" @click.self="$emit('close')">
    <section class="sheet">
      <div class="grabber" />
      <div class="sheet-header">
        <h2>{{ title }}</h2>
        <button class="close-button" type="button" @click="$emit('close')">Done</button>
      </div>
      <div class="command-list">
        <button
          v-for="command in commands"
          :key="command.id"
          class="command-item"
          type="button"
          :disabled="command.disabled"
          @click="$emit('execute', command.id)"
        >
          <span>{{ command.label }}</span>
          <small v-if="command.description">{{ command.description }}</small>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.sheet-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: flex-end;
  background: rgba(24, 19, 15, 0.28);
  z-index: 30;
}

.sheet {
  width: 100%;
  padding: 10px 16px calc(env(safe-area-inset-bottom) + 24px);
  border-radius: 24px 24px 0 0;
  background: #fffaf2;
  box-shadow: 0 -12px 30px rgba(39, 32, 24, 0.16);
}

.grabber {
  width: 42px;
  height: 5px;
  margin: 0 auto 14px;
  border-radius: 999px;
  background: #d7ccbc;
}

.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.sheet-header h2 {
  margin: 0;
  font-size: 18px;
}

.close-button {
  border: none;
  background: transparent;
  color: #6f675c;
  font-size: 14px;
  font-weight: 600;
}

.command-list {
  display: grid;
  gap: 10px;
}

.command-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
  width: 100%;
  padding: 14px 16px;
  border: 1px solid rgba(86, 74, 56, 0.12);
  border-radius: 16px;
  background: #fff;
  color: #201c16;
  text-align: left;
}

.command-item small {
  color: #6d665c;
  font-size: 12px;
}

.command-item:disabled {
  color: #9d968d;
  background: #f7f1e6;
}
</style>
