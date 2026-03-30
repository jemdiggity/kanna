<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue"
import { useTerminal, type SpawnOptions } from "../composables/useTerminal"
import { shouldDelayConnectUntilAfterInitialLayout } from "../composables/terminalSessionRecovery"
import "@xterm/xterm/css/xterm.css"

const props = defineProps<{
  sessionId: string
  spawnOptions?: SpawnOptions
  kittyKeyboard?: boolean
  agentProvider?: string
  worktreePath?: string
}>()

const containerRef = ref<HTMLElement | null>(null)
const { terminal, init, startListening, fit, fitDeferred, redraw, ensureConnected, dispose } = useTerminal(props.sessionId, props.spawnOptions, { kittyKeyboard: props.kittyKeyboard, agentProvider: props.agentProvider, worktreePath: props.worktreePath })

defineExpose({
  focus: () => terminal.value?.focus(),
  fit,
  redraw,
  ensureConnected,
})

let resizeObserver: ResizeObserver | null = null

async function waitForStableLayout(el: HTMLElement) {
  let last = { width: 0, height: 0 }
  for (let i = 0; i < 10; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const current = { width: el.offsetWidth, height: el.offsetHeight }
    if (
      current.width > 0 &&
      current.height > 0 &&
      current.width === last.width &&
      current.height === last.height
    ) {
      return
    }
    last = current
  }
}

onMounted(async () => {
  if (containerRef.value) {
    init(containerRef.value)
    resizeObserver = new ResizeObserver(() => fitDeferred())
    resizeObserver.observe(containerRef.value)
    if (shouldDelayConnectUntilAfterInitialLayout(props.spawnOptions, {
      agentProvider: props.agentProvider,
      worktreePath: props.worktreePath,
    })) {
      await waitForStableLayout(containerRef.value)
    }
    startListening()
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  dispose()
})
</script>

<template>
  <div class="terminal-wrapper">
    <div ref="containerRef" class="terminal-container"></div>
  </div>
</template>

<style scoped>
.terminal-wrapper {
  flex: 1;
  overflow: hidden;
  background: #1e1e1e;
  padding: 8px 12px;
}
.terminal-container {
  width: 100%;
  height: 100%;
}
</style>
