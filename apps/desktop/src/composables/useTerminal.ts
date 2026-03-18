import { ref, onUnmounted } from "vue"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { invoke } from "../invoke"
import { listen } from "../listen"

export function useTerminal(sessionId: string) {
  const terminal = ref<Terminal | null>(null)
  const fitAddon = new FitAddon()
  let unlistenOutput: (() => void) | null = null
  let unlistenExit: (() => void) | null = null
  let logged = false

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
    term.open(container)
    // Only fit if the container is visible (has non-zero dimensions)
    // v-show hidden containers report 0 size — fit() will be called
    // by the ResizeObserver when the tab becomes visible
    if (container.offsetWidth > 0 && container.offsetHeight > 0) {
      fitAddon.fit()
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
    // Listen for terminal output from daemon
    unlistenOutput = await listen<{ session_id: string; data_b64?: string; data?: number[] }>(
      "terminal_output",
      (event) => {
        if (event.payload.session_id === sessionId && terminal.value) {
          if (!logged) {
            console.log("[terminal] payload keys:", Object.keys(event.payload), "has b64:", !!event.payload.data_b64, "has data:", !!event.payload.data)
            logged = true
          }
          if (event.payload.data_b64) {
            // Base64 encoded binary data
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

    // Listen for session exit
    unlistenExit = await listen<{ session_id: string; code: number }>(
      "session_exit",
      (event) => {
        if (event.payload.session_id === sessionId && terminal.value) {
          terminal.value.write(`\r\n[Process exited with code ${event.payload.code}]\r\n`)
        }
      }
    )

    // Attach to daemon session to start receiving output
    await invoke("attach_session", { sessionId })

    // Sync xterm.js size to the PTY — the spawn may have used different dimensions
    if (terminal.value) {
      const { cols, rows } = terminal.value;
      invoke("resize_session", { sessionId, cols, rows }).catch(() => {})
    }
  }

  function fit() {
    fitAddon.fit()
  }

  function dispose() {
    if (unlistenOutput) unlistenOutput()
    if (unlistenExit) unlistenExit()
    terminal.value?.dispose()
  }

  onUnmounted(() => {
    dispose()
  })

  return { terminal, init, startListening, fit, dispose }
}
