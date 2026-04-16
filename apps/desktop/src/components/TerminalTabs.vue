<script setup lang="ts">
import type { AgentProvider } from "@kanna/db";
import AgentView from "./AgentView.vue";
import TerminalView from "./TerminalView.vue";
import { shouldEnableKittyKeyboard } from "../composables/terminalSessionRecovery";
import { buildTerminalSpawnOptions } from "../composables/terminalSpawnOptions";

const props = defineProps<{
  sessionId: string | null;
  agentType?: string;
  agentProvider?: AgentProvider;
  worktreePath?: string;
  repoPath?: string;
  prompt?: string;
  spawnPtySession?: (
    sessionId: string,
    cwd: string,
    prompt: string,
    cols: number,
    rows: number,
    options?: { agentProvider?: AgentProvider },
  ) => Promise<void>;
}>();

function buildSpawnOptions() {
  return buildTerminalSpawnOptions(props.spawnPtySession, {
    worktreePath: props.worktreePath,
    prompt: props.prompt,
    agentProvider: props.agentProvider,
  });
}
</script>

<template>
  <div class="terminal-panel">
    <!-- PTY mode: mount only the active terminal view -->
    <TerminalView
      v-if="sessionId && agentType === 'pty'"
      :key="sessionId"
      :session-id="sessionId"
      :active="true"
      :spawn-options="buildSpawnOptions()"
      :kitty-keyboard="!!(spawnPtySession && worktreePath && prompt) && shouldEnableKittyKeyboard({ agentProvider })"
      :agent-provider="agentProvider"
      :worktree-path="worktreePath"
      :agent-terminal="true"
    />
    <!-- SDK mode: key by sessionId so switching tasks creates a new view -->
    <AgentView
      v-if="sessionId && agentType !== 'pty'"
      :key="sessionId"
      :session-id="sessionId"
    />
    <div v-if="!sessionId" class="placeholder">
      {{ $t('terminalTabs.noSession') }}
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
