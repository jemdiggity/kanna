# Agent Terminal Image Paste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Kanna's macOS agent PTY terminal behave like Ghostty for dropped image files and pasted clipboard images without changing shell terminal behavior.

**Architecture:** The implementation stays at the terminal client boundary. `TerminalTabs` opts PTY agent terminals into an `agentTerminal` mode, `useTerminal` installs a small media bridge for dropped files and Kitty clipboard reads, and a macOS-only Tauri command exposes clipboard images as PNG for explicit `Cmd+V` actions. The daemon remains unchanged and still receives only PTY bytes through `send_input`.

**Tech Stack:** Vue 3, TypeScript, xterm.js, Vitest, Tauri v2, Rust, macOS clipboard APIs via Rust dependencies, `pnpm`, `cargo`

---

## File Structure

- `apps/desktop/src/components/TerminalTabs.vue`
  Agent PTY entrypoint. Opts agent terminals into image-aware terminal behavior.

- `apps/desktop/src/components/ShellModal.vue`
  Shell entrypoint. Must remain opted out of the new behavior.

- `apps/desktop/src/components/TerminalView.vue`
  Bridges terminal props into `useTerminal`.

- `apps/desktop/src/components/__tests__/TerminalTabs.test.ts`
  Verifies agent PTY terminals pass `agentTerminal=true`.

- `apps/desktop/src/components/__tests__/ShellModal.test.ts`
  Verifies shell terminals do not opt into image behavior.

- `apps/desktop/src/components/__tests__/TerminalView.test.ts`
  Verifies `TerminalView` forwards the `agentTerminal` option into `useTerminal`.

- `apps/desktop/src/composables/terminalMediaBridge.ts`
  Focused helper for dropped-path escaping, bracketed paste encoding, Kitty clipboard request parsing, and response encoding.

- `apps/desktop/src/composables/terminalMediaBridge.test.ts`
  Unit coverage for pure media-bridge behavior.

- `apps/desktop/src/composables/useTerminal.ts`
  Owns terminal lifecycle. Integrates drop listeners, clipboard image arming, Kitty clipboard response handling, and PTY writes.

- `apps/desktop/src/composables/useTerminal.test.ts`
  Covers drop suppression, PTY path insertion, `Cmd+V` interception, and Kitty clipboard response flow.

- `apps/desktop/src/tauri-mock.ts`
  Browser/test fallback for the new clipboard command.

- `apps/desktop/src-tauri/Cargo.toml`
  Adds macOS-only clipboard/image dependencies.

- `apps/desktop/src-tauri/src/commands/fs.rs`
  Exposes `read_clipboard_image_png` as a macOS-focused Tauri command returning PNG bytes and metadata.

- `apps/desktop/src-tauri/src/lib.rs`
  Registers the new Tauri command.

### Task 1: Plumb Agent Terminal Scope

**Files:**
- Create: `apps/desktop/src/components/__tests__/TerminalTabs.test.ts`
- Create: `apps/desktop/src/components/__tests__/ShellModal.test.ts`
- Modify: `apps/desktop/src/components/TerminalTabs.vue`
- Modify: `apps/desktop/src/components/ShellModal.vue`
- Modify: `apps/desktop/src/components/TerminalView.vue`
- Modify: `apps/desktop/src/components/__tests__/TerminalView.test.ts`

- [ ] **Step 1: Write the failing component tests**

Add component coverage that locks the scope boundary before changing implementation:

```ts
it("passes agentTerminal to PTY agent terminals", () => {
  const wrapper = mount(TerminalTabs, {
    props: {
      sessionId: "agent-1",
      agentType: "pty",
      worktreePath: "/tmp/task",
    },
    global: {
      stubs: {
        TerminalView: {
          props: ["agentTerminal"],
          template: "<div data-agent-terminal='{{ agentTerminal }}' />",
        },
      },
    },
  });

  expect(wrapper.findComponent({ name: "TerminalView" }).props("agentTerminal")).toBe(true);
});

it("does not pass agentTerminal to shell terminals", () => {
  const wrapper = mount(ShellModal, {
    props: {
      sessionId: "shell-1",
      cwd: "/tmp/task",
    },
    global: {
      stubs: {
        TerminalView: {
          props: ["agentTerminal"],
          template: "<div />",
        },
      },
    },
  });

  expect(wrapper.findComponent({ name: "TerminalView" }).props("agentTerminal")).toBeUndefined();
});
```

Also update `TerminalView.test.ts` so the mocked `useTerminal` call asserts the forwarded option:

```ts
const useTerminalMock = vi.fn(() => ({
  terminal: ref({ focus: focusMock }),
  init: initMock,
  startListening: startListeningMock,
  fit: fitMock,
  fitDeferred: fitDeferredMock,
  redraw: redrawMock,
  ensureConnected: ensureConnectedMock,
  dispose: disposeMock,
}));

expect(useTerminalMock).toHaveBeenCalledWith(
  "session-1",
  undefined,
  expect.objectContaining({ agentTerminal: true }),
);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run apps/desktop/src/components/__tests__/TerminalTabs.test.ts apps/desktop/src/components/__tests__/ShellModal.test.ts apps/desktop/src/components/__tests__/TerminalView.test.ts`

Expected: FAIL because `TerminalView` does not accept `agentTerminal`, `TerminalTabs` does not pass it, and `ShellModal` has no explicit scope coverage yet.

- [ ] **Step 3: Write minimal implementation**

Add the prop plumbing only:

```ts
// TerminalView.vue
const props = defineProps<{
  sessionId: string
  spawnOptions?: SpawnOptions
  active?: boolean
  kittyKeyboard?: boolean
  agentProvider?: string
  worktreePath?: string
  agentTerminal?: boolean
}>()

const { terminal, init, startListening, fit, fitDeferred, redraw, ensureConnected, dispose } =
  useTerminal(props.sessionId, props.spawnOptions, {
    kittyKeyboard: props.kittyKeyboard,
    agentProvider: props.agentProvider,
    worktreePath: props.worktreePath,
    agentTerminal: props.agentTerminal,
  })
```

```vue
<!-- TerminalTabs.vue -->
<TerminalView
  v-if="sessionId && agentType === 'pty'"
  :session-id="sessionId"
  :active="true"
  :spawn-options="buildSpawnOptions()"
  :kitty-keyboard="!!(spawnPtySession && worktreePath && prompt) && shouldEnableKittyKeyboard({ agentProvider })"
  :agent-provider="agentProvider"
  :worktree-path="worktreePath"
  :agent-terminal="true"
/>
```

```vue
<!-- ShellModal.vue -->
<TerminalView
  ref="termRef"
  :key="sessionId"
  :session-id="sessionId"
  :active="true"
  :spawn-options="{ cwd, prompt: '', spawnFn: spawnShell }"
/>
```

Add `agentTerminal?: boolean` to `TerminalOptions` in `useTerminal.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run apps/desktop/src/components/__tests__/TerminalTabs.test.ts apps/desktop/src/components/__tests__/ShellModal.test.ts apps/desktop/src/components/__tests__/TerminalView.test.ts`

Expected: PASS with the agent/shell scope boundary locked down.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/TerminalTabs.vue \
  apps/desktop/src/components/ShellModal.vue \
  apps/desktop/src/components/TerminalView.vue \
  apps/desktop/src/components/__tests__/TerminalTabs.test.ts \
  apps/desktop/src/components/__tests__/ShellModal.test.ts \
  apps/desktop/src/components/__tests__/TerminalView.test.ts \
  apps/desktop/src/composables/useTerminal.ts
git commit -m "test: scope agent terminal image behavior"
```

### Task 2: Build a Focused Terminal Media Helper

**Files:**
- Create: `apps/desktop/src/composables/terminalMediaBridge.ts`
- Create: `apps/desktop/src/composables/terminalMediaBridge.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Add pure tests for the behavior that should not be embedded directly inside `useTerminal`:

```ts
it("shell-escapes dropped file paths", () => {
  expect(formatDroppedPathsForPaste([
    "/tmp/with spaces.png",
    "/tmp/quote's.png",
  ])).toBe("'/tmp/with spaces.png' '/tmp/quote'\"'\"'s.png'");
});

it("wraps pasted text in bracketed paste markers when enabled", () => {
  const bytes = encodeTerminalPasteBytes("hello world", true);
  expect(new TextDecoder().decode(bytes)).toBe("\u001b[200~hello world\u001b[201~");
});

it("parses kitty clipboard image read requests", () => {
  const requests = collectKittyClipboardRequests("\u001b]5522;type=read:mime=aW1hZ2UvcG5n;\u0007");
  expect(requests).toEqual([{ mimeTypes: ["image/png"] }]);
});

it("builds a kitty clipboard image response", () => {
  expect(buildKittyClipboardResponse({
    mimeType: "image/png",
    pngBase64: "aGVsbG8=",
  })).toContain("5522;");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run apps/desktop/src/composables/terminalMediaBridge.test.ts`

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Write minimal implementation**

Create a helper with small, testable primitives:

```ts
export interface ClipboardImagePayload {
  mimeType: "image/png"
  pngBase64: string
  width: number
  height: number
}

export interface KittyClipboardReadRequest {
  mimeTypes: string[]
}

export function formatDroppedPathsForPaste(paths: string[]): string {
  return paths.map(shellEscapePath).join(" ")
}

export function encodeTerminalPasteBytes(text: string, bracketed: boolean): Uint8Array {
  const paste = bracketed ? `\u001b[200~${text}\u001b[201~` : text
  return new TextEncoder().encode(paste)
}

export function collectKittyClipboardRequests(chunk: string): KittyClipboardReadRequest[] {
  // Parse OSC 5522 read requests and return only read operations.
}

export function buildKittyClipboardResponse(payload: ClipboardImagePayload): string {
  // Return a valid OSC 5522 DATA/DONE response for image/png.
}
```

Keep this module free of DOM access so it stays unit-testable.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run apps/desktop/src/composables/terminalMediaBridge.test.ts`

Expected: PASS with escaping, paste framing, request parsing, and response formatting covered.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/composables/terminalMediaBridge.ts \
  apps/desktop/src/composables/terminalMediaBridge.test.ts
git commit -m "test: cover terminal media bridge helpers"
```

### Task 3: Integrate Dropped File Handling Into `useTerminal`

**Files:**
- Modify: `apps/desktop/src/composables/useTerminal.ts`
- Modify: `apps/desktop/src/composables/useTerminal.test.ts`

- [ ] **Step 1: Write the failing drop-handling tests**

Extend `useTerminal.test.ts` with agent-terminal-only drop coverage:

```ts
it("suppresses browser navigation and pastes dropped file paths into agent terminals", async () => {
  const { useTerminal } = await import("./useTerminal");
  const TestHarness = defineComponent({
    setup() {
      return useTerminal("session-1", undefined, {
        agentTerminal: true,
        worktreePath: "/tmp/task",
      });
    },
    render() {
      return h("div");
    },
  });
  const wrapper = mount(TestHarness);
  const container = document.createElement("div");
  Object.defineProperty(container, "offsetWidth", { configurable: true, value: 800 });
  Object.defineProperty(container, "offsetHeight", { configurable: true, value: 600 });
  container.querySelector = vi.fn(() => null) as typeof container.querySelector;
  container.closest = vi.fn(() => null) as typeof container.closest;
  wrapper.vm.init(container);

  const drop = new Event("drop") as Event & {
    dataTransfer: { files: Array<{ path: string; type: string }> }
    preventDefault: ReturnType<typeof vi.fn>
    stopPropagation: ReturnType<typeof vi.fn>
  };
  drop.dataTransfer = {
    files: [{ path: "/tmp/task/screenshot one.png", type: "image/png" }],
  };
  drop.preventDefault = vi.fn();
  drop.stopPropagation = vi.fn();

  container.dispatchEvent(drop);

  expect(drop.preventDefault).toHaveBeenCalled();
  expect(drop.stopPropagation).toHaveBeenCalled();
  expect(invokeMock).toHaveBeenCalledWith("send_input", expect.objectContaining({
    sessionId: "session-1",
  }));
});

it("ignores drop handling for shell terminals", async () => {
  const { useTerminal } = await import("./useTerminal");
  const TestHarness = defineComponent({
    setup() {
      return useTerminal("session-1", undefined, {
        agentTerminal: false,
      });
    },
    render() {
      return h("div");
    },
  });
  const wrapper = mount(TestHarness);
  const container = document.createElement("div");
  Object.defineProperty(container, "offsetWidth", { configurable: true, value: 800 });
  Object.defineProperty(container, "offsetHeight", { configurable: true, value: 600 });
  container.querySelector = vi.fn(() => null) as typeof container.querySelector;
  container.closest = vi.fn(() => null) as typeof container.closest;
  const addEventListenerSpy = vi.spyOn(container, "addEventListener");
  wrapper.vm.init(container);

  expect(addEventListenerSpy).not.toHaveBeenCalledWith("drop", expect.any(Function), undefined);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run apps/desktop/src/composables/useTerminal.test.ts`

Expected: FAIL because `useTerminal` does not install drop listeners or encode dropped file paths yet.

- [ ] **Step 3: Write minimal implementation**

Integrate the helper only for agent terminals:

```ts
function sendTerminalBytes(bytes: Uint8Array) {
  return invoke("send_input", {
    sessionId,
    data: Array.from(bytes),
  })
}

function installDropHandlers(el: HTMLElement) {
  const handleDrop = (event: DragEvent) => {
    const files = Array.from(event.dataTransfer?.files ?? []);
    const paths = files
      .map((file) => ("path" in file ? String((file as File & { path?: string }).path ?? "") : ""))
      .filter((path) => path.length > 0);

    if (paths.length === 0) return;

    event.preventDefault();
    event.stopPropagation();

    const text = formatDroppedPathsForPaste(paths);
    void sendTerminalBytes(encodeTerminalPasteBytes(text, mediaState.bracketedPasteMode));
  };

  el.addEventListener("dragenter", suppressDragNavigation);
  el.addEventListener("dragover", suppressDragNavigation);
  el.addEventListener("drop", handleDrop);
}
```

Track bracketed paste mode in terminal output by observing `\u001b[?2004h` and `\u001b[?2004l` before writing chunks to xterm.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run apps/desktop/src/composables/useTerminal.test.ts`

Expected: PASS for dropped file suppression and PTY insertion behavior.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/composables/useTerminal.ts \
  apps/desktop/src/composables/useTerminal.test.ts
git commit -m "feat: paste dropped terminal paths into agent ptys"
```

### Task 4: Integrate Clipboard Image Paste And Kitty Responses

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/src/commands/fs.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src/tauri-mock.ts`
- Modify: `apps/desktop/src/composables/useTerminal.ts`
- Modify: `apps/desktop/src/composables/useTerminal.test.ts`

- [ ] **Step 1: Write the failing clipboard tests**

Add `useTerminal` coverage for explicit image paste:

```ts
it("reads clipboard image data on Cmd+V for agent terminals", async () => {
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "read_clipboard_image_png") {
      return {
        mimeType: "image/png",
        pngBase64: "aGVsbG8=",
        width: 1,
        height: 1,
      };
    }
    return null;
  });

  const { useTerminal } = await import("./useTerminal");
  const TestHarness = defineComponent({
    setup() {
      return useTerminal("session-1", undefined, {
        agentTerminal: true,
      });
    },
    render() {
      return h("div");
    },
  });
  const wrapper = mount(TestHarness);
  const container = document.createElement("div");
  Object.defineProperty(container, "offsetWidth", { configurable: true, value: 800 });
  Object.defineProperty(container, "offsetHeight", { configurable: true, value: 600 });
  container.querySelector = vi.fn(() => null) as typeof container.querySelector;
  container.closest = vi.fn(() => null) as typeof container.closest;
  wrapper.vm.init(container);
  const terminal = terminals[0];
  const keyHandler = terminal.attachCustomKeyEventHandler.mock.calls[0][0];

  const allowed = keyHandler(new KeyboardEvent("keydown", { key: "v", metaKey: true }));

  expect(allowed).toBe(false);
  expect(invokeMock).toHaveBeenCalledWith("read_clipboard_image_png", {});
});

it("responds to kitty clipboard image reads after an explicit paste", async () => {
  const outputListener = eventListeners.get("terminal_output")?.[0];
  outputListener?.({
    payload: {
      session_id: "session-1",
      data: Array.from(new TextEncoder().encode("\u001b]5522;type=read:mime=aW1hZ2UvcG5n;\u0007")),
    },
  });

  expect(invokeMock).toHaveBeenCalledWith("send_input", expect.objectContaining({
    sessionId: "session-1",
  }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run apps/desktop/src/composables/useTerminal.test.ts`

Expected: FAIL because no clipboard image command exists and `useTerminal` does not arm or answer Kitty clipboard reads.

- [ ] **Step 3: Add the macOS clipboard command**

Add a macOS-only Tauri command contract:

```rust
#[derive(Serialize)]
pub struct ClipboardImagePayload {
    pub mime_type: String,
    pub png_base64: String,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub fn read_clipboard_image_png() -> Result<Option<ClipboardImagePayload>, String> {
    #[cfg(target_os = "macos")]
    {
        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        let image = clipboard.get_image().map_err(|e| e.to_string())?;
        let rgba = image::RgbaImage::from_raw(
            image.width as u32,
            image.height as u32,
            image.bytes.into_owned(),
        ).ok_or_else(|| "invalid RGBA clipboard buffer".to_string())?;

        let mut png = Vec::new();
        image::DynamicImage::ImageRgba8(rgba)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;

        return Ok(Some(ClipboardImagePayload {
            mime_type: "image/png".to_string(),
            png_base64: base64::engine::general_purpose::STANDARD.encode(png),
            width: image.width as u32,
            height: image.height as u32,
        }));
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(None)
    }
}
```

Register the command in `lib.rs`, add the mock handler in `tauri-mock.ts`, and add macOS-only dependencies in `Cargo.toml`:

```toml
[target.'cfg(target_os = "macos")'.dependencies]
objc2 = "0.6"
block2 = "0.6"
arboard = { version = "3.6", default-features = false, features = ["image-data"] }
image = { version = "0.25", default-features = false, features = ["png", "tiff"] }
```

- [ ] **Step 4: Wire `useTerminal` clipboard-image flow**

Add one-shot clipboard image state and answer Kitty reads only after explicit paste:

```ts
let pendingClipboardImage: ClipboardImagePayload | null = null
let clipboardImageExpiresAt = 0

async function armClipboardImagePaste(): Promise<boolean> {
  const payload = await invoke<ClipboardImagePayload | null>("read_clipboard_image_png", {})
  if (!payload) return false
  pendingClipboardImage = payload
  clipboardImageExpiresAt = Date.now() + 10_000
  return true
}

function maybeHandleClipboardImageRequest(chunkText: string) {
  if (!pendingClipboardImage || Date.now() > clipboardImageExpiresAt) {
    pendingClipboardImage = null
    return
  }

  for (const request of collectKittyClipboardRequests(chunkText)) {
    if (!request.mimeTypes.includes("image/png")) continue
    void sendTerminalBytes(new TextEncoder().encode(
      buildKittyClipboardResponse(pendingClipboardImage),
    ))
    pendingClipboardImage = null
  }
}
```

Update the custom key handler so `Cmd+V` in an agent terminal:

- first tries `armClipboardImagePaste()`
- returns `false` to stop browser paste when image data is armed
- falls back to existing browser text paste behavior when no image exists

Also clear the pending image on unrelated user input and terminal disposal.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run apps/desktop/src/composables/useTerminal.test.ts apps/desktop/src/composables/terminalMediaBridge.test.ts`

Expected: PASS for `Cmd+V` interception, one-shot image arming, and Kitty clipboard response behavior.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml \
  apps/desktop/src-tauri/src/commands/fs.rs \
  apps/desktop/src-tauri/src/lib.rs \
  apps/desktop/src/tauri-mock.ts \
  apps/desktop/src/composables/useTerminal.ts \
  apps/desktop/src/composables/useTerminal.test.ts
git commit -m "feat: support image paste in agent terminal"
```

### Task 5: Full Verification And Manual Smoke Test

**Files:**
- Modify: no new files expected

- [ ] **Step 1: Run the focused frontend test suite**

Run:

```bash
pnpm exec vitest run \
  apps/desktop/src/components/__tests__/TerminalTabs.test.ts \
  apps/desktop/src/components/__tests__/ShellModal.test.ts \
  apps/desktop/src/components/__tests__/TerminalView.test.ts \
  apps/desktop/src/composables/terminalMediaBridge.test.ts \
  apps/desktop/src/composables/useTerminal.test.ts
```

Expected: PASS with 0 failing tests.

- [ ] **Step 2: Run TypeScript verification**

Run: `pnpm exec tsc --noEmit`

Expected: PASS with no type errors.

- [ ] **Step 3: Run Rust verification**

Run:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --tests -- -D warnings
```

Expected: PASS for the desktop Tauri crate with no clippy warnings.

- [ ] **Step 4: Smoke test in the worktree app**

Run the worktree dev app and manually verify:

```text
1. Drop a PNG from Finder onto the active agent terminal.
2. Confirm Kanna does not navigate away.
3. Confirm the PTY receives escaped file path text.
4. Copy an image to the clipboard and press Cmd+V in the agent terminal.
5. Confirm the target agent CLI behaves the same way it does in Ghostty.
6. Open ShellModal and confirm image drop/paste behavior is unchanged there.
```

Expected: Agent terminal works like Ghostty for the two targeted flows; shell modal remains unchanged.

- [ ] **Step 5: Commit any final verification-only fixes**

```bash
git add -A
git diff --cached --quiet || git commit -m "chore: finalize agent terminal image paste verification"
```
