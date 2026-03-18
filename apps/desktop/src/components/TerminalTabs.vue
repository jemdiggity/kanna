<script setup lang="ts">
import AgentView from "./AgentView.vue";
import TerminalView from "./TerminalView.vue";

defineProps<{
  sessionId: string | null;
  agentType?: string;
  worktreePath?: string;
  repoPath?: string;
  prompt?: string;
  spawnPtySession?: (sessionId: string, cwd: string, prompt: string, cols: number, rows: number) => Promise<void>;
}>();

const emit = defineEmits<{
  (e: "agent-completed"): void;
}>();
</script>

<template>
  <div class="terminal-panel">
    <!-- PTY mode: key by sessionId so switching tasks creates a new terminal -->
    <TerminalView
      v-if="sessionId && agentType === 'pty'"
      ref="termRef"
      :key="sessionId"
      :session-id="sessionId"
      :spawn-options="spawnPtySession && worktreePath && prompt ? {
        cwd: worktreePath,
        prompt: prompt,
        spawnFn: spawnPtySession,
      } : undefined"
    />
    <!-- SDK mode: key by sessionId so switching tasks creates a new view -->
    <AgentView
      v-if="sessionId && agentType !== 'pty'"
      :key="sessionId"
      :session-id="sessionId"
      @completed="emit('agent-completed')"
    />
    <div v-if="!sessionId" class="placeholder">
      No agent session active
    </div>
  </div>
</template>

<style scoped>
.terminal-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #555;
  font-size: 13px;
}
</style>
