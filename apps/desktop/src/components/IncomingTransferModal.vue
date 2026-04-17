<script setup lang="ts">
import { useModalZIndex } from "../composables/useModalZIndex";

const props = defineProps<{
  sourceName?: string | null;
}>();

const emit = defineEmits<{
  (e: "approve"): void;
  (e: "reject"): void;
}>();

const { zIndex } = useModalZIndex();
</script>

<template>
  <div class="modal-overlay" :style="{ zIndex }" @click.self="emit('reject')">
    <div class="modal-card">
      <h2 class="title">{{ $t("taskTransfer.incomingTitle") }}</h2>
      <p v-if="props.sourceName" class="subtitle">{{ props.sourceName }}</p>

      <div class="actions">
        <button class="btn btn-danger" @click="emit('reject')">
          {{ $t("taskTransfer.reject") }}
        </button>
        <button class="btn btn-primary" @click="emit('approve')">
          {{ $t("taskTransfer.approve") }}
        </button>
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

.modal-card {
  width: 420px;
  max-width: 90vw;
  background: #252525;
  border: 1px solid #444;
  border-radius: 8px;
  padding: 16px;
}

.title {
  font-size: 14px;
  color: #d8d8d8;
  margin-bottom: 8px;
}

.subtitle {
  font-size: 12px;
  color: #a0a0a0;
  margin-bottom: 14px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn {
  padding: 5px 14px;
  border-radius: 4px;
  border: 1px solid #444;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  background: #2a2a2a;
  color: #ccc;
  transition: background 0.15s;
}

.btn:hover {
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

.btn-danger {
  background: #333;
  border-color: #555;
  color: #ccc;
}

.btn-danger:hover {
  background: #b62324;
  border-color: #d13435;
  color: #fff;
}
</style>
