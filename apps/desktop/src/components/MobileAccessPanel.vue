<script setup lang="ts">
import { computed } from "vue";

type ServerStatus = "running" | "stopped" | "error";

const props = defineProps<{
  desktopName: string;
  serverStatus: ServerStatus;
  pairingCode: string | null;
}>();

const emit = defineEmits<{
  (e: "start-pairing"): void;
}>();

const statusLabel = computed(() => {
  if (props.serverStatus === "running") return "Online";
  if (props.serverStatus === "stopped") return "Offline";
  return "Needs attention";
});

const statusClass = computed(() => `status-${props.serverStatus}`);
</script>

<template>
  <section class="mobile-access-panel">
    <div class="panel-header">
      <div>
        <p class="eyebrow">Mobile Access</p>
        <h3 class="desktop-name">{{ desktopName }}</h3>
      </div>
      <span class="status-pill" :class="statusClass">{{ statusLabel }}</span>
    </div>

    <p class="description">
      Pair a phone or tablet to browse tasks and recent activity on this desktop.
    </p>

    <div class="pairing-area">
      <div class="pairing-code">
        <span class="label">Pairing code</span>
        <code v-if="pairingCode" class="code">{{ pairingCode }}</code>
        <span v-else class="placeholder">No pairing session active</span>
      </div>

      <button type="button" class="start-pairing" @click="emit('start-pairing')">
        Start pairing
      </button>
    </div>
  </section>
</template>

<style scoped>
.mobile-access-panel {
  margin-top: 14px;
  padding: 14px;
  border: 1px solid #36506c;
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(19, 28, 40, 0.98), rgba(16, 22, 32, 0.98));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.eyebrow {
  margin: 0 0 4px;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #78a8d8;
}

.desktop-name {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #edf3ff;
}

.status-pill {
  flex: none;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  border: 1px solid transparent;
}

.status-running {
  color: #8be1b5;
  background: rgba(28, 80, 52, 0.6);
  border-color: rgba(139, 225, 181, 0.24);
}

.status-stopped {
  color: #c9d3e1;
  background: rgba(66, 76, 92, 0.45);
  border-color: rgba(201, 211, 225, 0.18);
}

.status-error {
  color: #ffb39d;
  background: rgba(84, 42, 32, 0.55);
  border-color: rgba(255, 179, 157, 0.22);
}

.description {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: #9aa7b8;
}

.pairing-area {
  margin-top: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.pairing-code {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.label {
  font-size: 11px;
  color: #7f8ea3;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.code {
  display: inline-flex;
  align-self: flex-start;
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid #3b5168;
  background: rgba(10, 16, 24, 0.9);
  color: #eaf2ff;
  font-size: 12px;
  letter-spacing: 0.08em;
}

.placeholder {
  font-size: 12px;
  color: #667689;
}

.start-pairing {
  flex: none;
  padding: 8px 12px;
  border: 1px solid #2c79cd;
  border-radius: 7px;
  background: linear-gradient(180deg, #2d84e0, #2364aa);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.start-pairing:hover {
  background: linear-gradient(180deg, #3890ec, #2770bb);
}

.start-pairing:focus-visible {
  outline: 2px solid rgba(121, 177, 240, 0.8);
  outline-offset: 2px;
}
</style>
