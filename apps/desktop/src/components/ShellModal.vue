<script setup lang="ts">
import { ref, onMounted, nextTick } from "vue";
import { invoke } from "../invoke";
import { parseRepoConfig } from "@kanna/core";
import TerminalView from "./TerminalView.vue";

const props = defineProps<{
  sessionId: string;
  cwd: string;
  repoPath?: string;
  portOffset?: number | null;
  maximized?: boolean;
}>();

const emit = defineEmits<{ (e: "close"): void }>();
const termRef = ref<InstanceType<typeof TerminalView> | null>(null);

onMounted(async () => {
  await nextTick();
  termRef.value?.focus();
});

async function spawnShell(sessionId: string, cwd: string, _prompt: string, cols: number, rows: number) {
  const env: Record<string, string> = { TERM: "xterm-256color", KANNA_WORKTREE: "1" };

  // Read port env vars from .kanna/config.json
  if (props.repoPath && props.portOffset) {
    try {
      const configContent = await invoke<string>("read_text_file", {
        path: `${props.repoPath}/.kanna/config.json`,
      });
      if (configContent) {
        const repoConfig = parseRepoConfig(configContent);
        if (repoConfig.ports) {
          for (const [name, base] of Object.entries(repoConfig.ports)) {
            env[name] = String(base + props.portOffset);
          }
        }
      }
    } catch {
      // Non-fatal
    }
  }

  await invoke("spawn_session", {
    sessionId,
    cwd,
    executable: "/bin/zsh",
    args: ["--login"],
    env,
    cols,
    rows,
  });
}
</script>

<template>
  <div class="modal-overlay" :class="{ maximized }" @click.self="emit('close')">
    <div class="shell-modal">
      <TerminalView
        ref="termRef"
        :key="sessionId"
        :session-id="sessionId"
        :spawn-options="{ cwd, prompt: '', spawnFn: spawnShell }"
      />
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
  z-index: 1000;
}

.shell-modal {
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 8px;
  width: 90vw;
  height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 4px;
}

.maximized { background: none; }
.maximized .shell-modal {
  width: 100vw;
  height: 100vh;
  border-radius: 0;
  border: none;
  padding: 0;
}
</style>
