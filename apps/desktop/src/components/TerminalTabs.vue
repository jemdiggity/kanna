<script setup lang="ts">
import { ref, watch, nextTick, type ComponentPublicInstance } from "vue";
import type { AgentProvider } from "@kanna/db";
import AgentView from "./AgentView.vue";
import TerminalView from "./TerminalView.vue";
import { shouldEnableKittyKeyboard } from "../composables/terminalSessionRecovery";
import { buildTerminalSpawnOptions } from "../composables/terminalSpawnOptions";

const props = defineProps<{
  sessionId: string | null;
  activeSessionIds: Set<string>;
  activePtySessions?: Array<{
    sessionId: string;
    worktreePath?: string;
    prompt?: string;
    agentProvider?: AgentProvider;
  }>;
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

const emit = defineEmits<{
  (e: "agent-completed"): void;
}>();

// Keep PTY terminals alive across switches (VSCode-style show/hide)
interface PtySessionConfig {
  worktreePath?: string;
  prompt?: string;
  agentProvider?: AgentProvider;
}
interface TerminalViewInstance extends ComponentPublicInstance {
  fit?: () => void;
  focus?: () => void;
  ensureConnected?: () => Promise<void>;
}
const visitedPtySessions = ref(new Map<string, PtySessionConfig>());
const termRefs = ref<Record<string, TerminalViewInstance | null>>({});

watch(
  () => props.activePtySessions,
  (sessions) => {
    if (!sessions) return;
    for (const session of sessions) {
      visitedPtySessions.value.set(session.sessionId, {
        worktreePath: session.worktreePath,
        prompt: session.prompt,
        agentProvider: session.agentProvider,
      });
    }
  },
  { immediate: true, deep: true },
);

watch(
  () => [props.sessionId, props.agentType] as const,
  ([newId, agentType], oldVal) => {
    const oldId = oldVal?.[0];
    if (!newId || agentType !== "pty") return;
    const wasVisited = visitedPtySessions.value.has(newId);

    visitedPtySessions.value.set(newId, {
      worktreePath: props.worktreePath,
      prompt: props.prompt,
      agentProvider: props.agentProvider,
    });

    // Returning to an already-mounted terminal: keep the existing xterm buffer,
    // but probe the backend connection in case the daemon restarted while this
    // terminal was hidden. Only reconnect on demand.
    if (oldId && newId !== oldId && wasVisited) {
      nextTick(async () => {
        const ref = termRefs.value[newId];
        if (ref) {
          await ref.ensureConnected?.();
          ref.fit?.();
          ref.focus?.();
        }
      });
    }
  },
  { immediate: true }
);

function setTermRef(sessionId: string, el: TerminalViewInstance | null) {
  termRefs.value[sessionId] = el;
}

function buildSpawnOptions(config: PtySessionConfig) {
  return buildTerminalSpawnOptions(props.spawnPtySession, config);
}

// Prune terminals for sessions that are no longer active (closed/deleted tasks).
// This unmounts the TerminalView so undo gets a fresh mount with proper attach.
watch(
  () => props.activeSessionIds,
  (activeIds) => {
    for (const sid of visitedPtySessions.value.keys()) {
      if (!activeIds.has(sid)) {
        visitedPtySessions.value.delete(sid);
        delete termRefs.value[sid];
      }
    }
  }
);
</script>

<template>
  <div class="terminal-panel">
    <!-- PTY mode: keep all visited terminals alive, show only active one -->
    <TerminalView
      v-for="[sid, config] of visitedPtySessions"
      v-show="sid === sessionId"
      :key="sid"
      :ref="(el: any) => setTermRef(sid, el)"
      :session-id="sid"
      :active="sid === sessionId"
      :spawn-options="buildSpawnOptions(config)"
      :kitty-keyboard="!!(spawnPtySession && config.worktreePath && config.prompt) && shouldEnableKittyKeyboard({ agentProvider: config.agentProvider })"
      :agent-provider="config.agentProvider"
      :worktree-path="config.worktreePath"
    />
    <!-- SDK mode: key by sessionId so switching tasks creates a new view -->
    <AgentView
      v-if="sessionId && agentType !== 'pty'"
      :key="sessionId"
      :session-id="sessionId"
      @completed="emit('agent-completed')"
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
