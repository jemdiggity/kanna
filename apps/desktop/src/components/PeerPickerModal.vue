<script setup lang="ts">
import { ref, watch } from "vue";
import { useModalZIndex } from "../composables/useModalZIndex";

interface PeerOption {
  id: string;
  name: string;
  subtitle?: string;
}

const props = defineProps<{
  peers: PeerOption[];
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: "select", peerId: string): void;
  (e: "pair-peer", peerId: string): void;
  (e: "cancel"): void;
}>();

const { zIndex } = useModalZIndex();
const selectedPeerId = ref<string | null>(null);

watch(
  () => props.peers,
  (peers) => {
    if (!selectedPeerId.value) return;
    if (!peers.some((peer) => peer.id === selectedPeerId.value)) {
      selectedPeerId.value = null;
    }
  },
);

function confirmSelect() {
  if (!selectedPeerId.value) return;
  emit("select", selectedPeerId.value);
}

function pairSelectedPeer() {
  if (!selectedPeerId.value) return;
  emit("pair-peer", selectedPeerId.value);
}
</script>

<template>
  <div class="modal-overlay" :style="{ zIndex }" @click.self="emit('cancel')">
    <div class="modal-card">
      <h2 class="title">{{ $t("taskTransfer.pushToMachine") }}</h2>

      <div v-if="loading" class="state-text">{{ $t("common.loading") }}</div>

      <div v-else class="peer-list">
        <button
          v-for="peer in peers"
          :key="peer.id"
          class="peer-row"
          :class="{ selected: selectedPeerId === peer.id }"
          @click="selectedPeerId = peer.id"
        >
          <span class="peer-name">{{ peer.name }}</span>
          <span v-if="peer.subtitle" class="peer-subtitle">{{ peer.subtitle }}</span>
        </button>
      </div>

      <div class="actions">
        <button class="btn btn-danger" @click="emit('cancel')">
          {{ $t("actions.cancel") }}
        </button>
        <button class="btn" :disabled="!selectedPeerId || loading" @click="pairSelectedPeer">
          {{ $t("taskTransfer.pairPeer") }}
        </button>
        <button class="btn btn-primary" :disabled="!selectedPeerId || loading" @click="confirmSelect">
          {{ $t("taskTransfer.pushToMachine") }}
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
  width: 520px;
  max-width: 92vw;
  max-height: 70vh;
  background: #252525;
  border: 1px solid #444;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
}

.title {
  padding: 14px 16px;
  border-bottom: 1px solid #333;
  font-size: 14px;
  font-weight: 600;
  color: #d8d8d8;
}

.state-text {
  padding: 16px;
  color: #999;
  font-size: 13px;
}

.peer-list {
  max-height: 45vh;
  overflow-y: auto;
}

.peer-row {
  width: 100%;
  background: transparent;
  border: none;
  border-bottom: 1px solid #2f2f2f;
  color: #d0d0d0;
  text-align: left;
  padding: 10px 14px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.peer-row:hover {
  background: #2e2e2e;
}

.peer-row.selected {
  background: #1f334d;
}

.peer-name {
  font-size: 13px;
  font-weight: 500;
}

.peer-subtitle {
  font-size: 11px;
  color: #8f8f8f;
}

.actions {
  border-top: 1px solid #333;
  padding: 12px 14px;
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

.btn:hover:enabled {
  background: #333;
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.btn-primary {
  background: #0066cc;
  border-color: #0077ee;
  color: #fff;
}

.btn-primary:hover:enabled {
  background: #0077ee;
}

.btn-danger {
  background: #333;
  border-color: #555;
  color: #ccc;
}

.btn-danger:hover:enabled {
  background: #b62324;
  border-color: #d13435;
  color: #fff;
}
</style>
