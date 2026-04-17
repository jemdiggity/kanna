import type { TaskTerminalStatus } from "../state/sessionStore";

interface BuildTerminalDocumentOptions {
  bottomInset: number;
}

interface BuildTerminalUpdateScriptOptions {
  output: string;
  status: TaskTerminalStatus;
}

export function buildTerminalDocument({ bottomInset }: BuildTerminalDocumentOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=yes"
    />
    <style>
      :root {
        color-scheme: dark;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        height: 100%;
      }

      body {
        margin: 0;
        background: #09111d;
        color: #dfe9f7;
        font-family: Menlo, Monaco, Consolas, "Courier New", monospace;
        overflow: hidden;
      }

      .viewport {
        height: 100%;
        overflow-x: auto;
        overflow-y: auto;
        padding: 14px 14px ${bottomInset}px 14px;
      }

      pre {
        margin: 0;
        min-width: max-content;
        white-space: pre;
        word-break: normal;
        font-size: 12px;
        line-height: 1.45;
      }
    </style>
  </head>
  <body>
    <div class="viewport" id="viewport">
      <pre id="terminal"></pre>
    </div>
    <script>
      const viewport = document.getElementById("viewport");
      const terminal = document.getElementById("terminal");
      let stickyToBottom = true;

      function isNearBottom() {
        const distanceFromBottom =
          viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
        return distanceFromBottom <= 24;
      }

      viewport.addEventListener("scroll", () => {
        stickyToBottom = isNearBottom();
      });

      window.__setTerminalState = function setTerminalState(state) {
        const shouldStick = stickyToBottom || isNearBottom();
        terminal.textContent = state.text;

        if (shouldStick) {
          requestAnimationFrame(() => {
            viewport.scrollTop = viewport.scrollHeight;
            stickyToBottom = true;
          });
        }
      };
    </script>
  </body>
</html>`;
}

export function buildTerminalUpdateScript({
  output,
  status
}: BuildTerminalUpdateScriptOptions): string {
  const terminalText = output.trim() ? normalizeTerminalText(output) : getStatusCopy(status);
  return `window.__setTerminalState(${JSON.stringify({ text: terminalText })}); true;`;
}

function getStatusCopy(status: TaskTerminalStatus): string {
  switch (status) {
    case "connecting":
      return "Connecting to desktop daemon...";
    case "error":
      return "Terminal stream failed.";
    case "closed":
      return "Terminal session closed.";
    case "idle":
    case "live":
    default:
      return "Waiting for terminal output...";
  }
}

function normalizeTerminalText(input: string): string {
  if (!looksLikeMojibake(input)) {
    return input;
  }

  const normalized = new TextDecoder("utf-8", { fatal: false }).decode(
    Uint8Array.from(input, (char) => char.charCodeAt(0) & 0xff)
  );

  return containsTerminalGlyphs(normalized) ? normalized : input;
}

function looksLikeMojibake(input: string): boolean {
  return input.includes("â") || input.includes("ð") || input.includes("Ã");
}

function containsTerminalGlyphs(input: string): boolean {
  return /[╭╮╰╯│─┌┐└┘├┤┬┴┼]/u.test(input);
}
