import { ref, onUnmounted } from "vue"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { SerializeAddon } from "@xterm/addon-serialize"
import { invoke } from "../invoke"
import { listen } from "../listen"

// Module-level cache: sessionId → serialized ANSI scrollback
const scrollbackCache = new Map<string, string>()

export function useTerminal(sessionId: string) {
  const terminal = ref<Terminal | null>(null)
  const fitAddon = new FitAddon()
  const serializeAddon = new SerializeAddon()
  let unlistenOutput: (() => void) | null = null
  let unlistenExit: (() => void) | null = null

  function init(container: HTMLElement) {
    const term = new Terminal({
      fontFamily: '"SF Mono", Menlo, monospace',
      fontSize: 13,
      theme: { background: "#1a1a1a", foreground: "#e0e0e0", cursor: "#e0e0e0" },
      scrollback: 10000,
      cursorBlink: true,
    })
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.loadAddon(serializeAddon)
    term.open(container)

    if (container.offsetWidth > 0 && container.offsetHeight > 0) {
      fitAddon.fit()
    }

    // Restore cached scrollback if available
    const cached = scrollbackCache.get(sessionId)
    if (cached) {
      term.write(cached)
    }

    // Send keystrokes to daemon
    term.onData((data) => {
      invoke("send_input", {
        sessionId,
        data: Array.from(new TextEncoder().encode(data)),
      })
    })

    // Handle resize
    term.onResize(({ cols, rows }) => {
      invoke("resize_session", { sessionId, cols, rows })
    })

    terminal.value = term
  }

  async function startListening() {
    unlistenOutput = await listen<{ session_id: string; data_b64?: string; data?: number[] }>(
      "terminal_output",
      (event) => {
        if (event.payload.session_id === sessionId && terminal.value) {
          if (event.payload.data_b64) {
            const binary = atob(event.payload.data_b64)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i)
            }
            terminal.value.write(bytes)
          } else if (Array.isArray(event.payload.data)) {
            terminal.value.write(new Uint8Array(event.payload.data))
          }
        }
      }
    )

    unlistenExit = await listen<{ session_id: string; code: number }>(
      "session_exit",
      (event) => {
        if (event.payload.session_id === sessionId && terminal.value) {
          terminal.value.write(`\r\n[Process exited with code ${event.payload.code}]\r\n`)
        }
      }
    )

    // Only attach if we don't have cached scrollback (fresh session)
    // If we have cache, the session was already attached before
    await invoke("attach_session", { sessionId })

    if (terminal.value) {
      const { cols, rows } = terminal.value;
      invoke("resize_session", { sessionId, cols, rows }).catch(() => {})
    }
  }

  function fit() {
    fitAddon.fit()
  }

  function dispose() {
    // Save scrollback before disposing
    if (terminal.value) {
      try {
        const serialized = serializeAddon.serialize()
        if (serialized) {
          scrollbackCache.set(sessionId, serialized)
        }
      } catch {
        // Serialize may fail if terminal is already disposed
      }
    }

    if (unlistenOutput) unlistenOutput()
    if (unlistenExit) unlistenExit()
    terminal.value?.dispose()
  }

  onUnmounted(() => {
    dispose()
  })

  return { terminal, init, startListening, fit, dispose }
}
