import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../appError";

const invokeMock = vi.fn();
const listenMock = vi.fn();
const warningToastMock = vi.fn();
const errorToastMock = vi.fn();
const eventListeners = new Map<string, ((event: any) => void)[]>();
const onWebviewDragDropEventMock = vi.fn();
const onWindowDragDropEventMock = vi.fn();
let nativeWebviewDragDropHandler: ((event: any) => void) | null = null;
let nativeWindowDragDropHandler: ((event: any) => void) | null = null;
let isTauriMock = false;

function emitTerminalSnapshot(
  sessionId: string,
  vt = "restored scrollback",
) {
  const listeners = eventListeners.get("terminal_snapshot") ?? [];
  for (const listener of listeners) {
    listener({
      payload: {
        session_id: sessionId,
        snapshot: {
          version: 1,
          rows: 24,
          cols: 80,
          cursor_row: 0,
          cursor_col: 0,
          cursor_visible: true,
          vt,
        },
      },
    });
  }
}

interface PendingWrite {
  data: string | Uint8Array;
  callback?: () => void;
}

class FakeTerminal {
  cols = 80;
  rows = 24;
  buffer = {
    active: {
      viewportY: 0,
      getLine: () => null,
    },
  };
  element: HTMLElement | null = null;
  pendingStringWrites: PendingWrite[] = [];
  reset = vi.fn();
  loadAddon = vi.fn();
  open = vi.fn((element: HTMLElement) => {
    this.element = element;
  });
  attachCustomKeyEventHandler = vi.fn();
  onData = vi.fn();
  onResize = vi.fn();
  registerLinkProvider = vi.fn();
  getSelection = vi.fn(() => "");
  scrollToLine = vi.fn();
  dispose = vi.fn();
  write = vi.fn((data: string | Uint8Array, callback?: () => void) => {
    if (typeof data === "string") {
      this.pendingStringWrites.push({ data, callback });
      return;
    }
    callback?.();
  });

  flushNextStringWrite() {
    const pending = this.pendingStringWrites.shift();
    pending?.callback?.();
  }
}

const terminals: FakeTerminal[] = [];

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(function TerminalMock() {
    const terminal = new FakeTerminal();
    terminals.push(terminal);
    return terminal;
  }),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {},
}));

vi.mock("@xterm/addon-image", () => ({
  ImageAddon: class {},
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: onWebviewDragDropEventMock,
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: onWindowDragDropEventMock,
  }),
}));

vi.mock("../tauri-mock", () => ({
  get isTauri() {
    return isTauriMock;
  },
  mockInvoke: invokeMock,
  mockListen: listenMock,
}));

vi.mock("./useToast", () => ({
  useToast: () => ({
    warning: warningToastMock,
    error: errorToastMock,
  }),
}));

vi.mock("../i18n", () => ({
  default: {
    global: {
      t: (key: string) => key,
    },
  },
}));

describe("useTerminal", () => {
  beforeEach(() => {
    if (!("SVGElement" in globalThis)) {
      // happy-dom preload does not currently expose this global.
      // Vue runtime-dom checks it during mount.
      // @ts-expect-error test shim
      globalThis.SVGElement = class SVGElement {};
    }
    if (!("Element" in globalThis)) {
      // @ts-expect-error test shim
      globalThis.Element = window.Element;
    }
    invokeMock.mockReset();
    listenMock.mockReset();
    warningToastMock.mockReset();
    errorToastMock.mockReset();
    eventListeners.clear();
    nativeWebviewDragDropHandler = null;
    nativeWindowDragDropHandler = null;
    isTauriMock = false;
    onWebviewDragDropEventMock.mockReset();
    onWindowDragDropEventMock.mockReset();
    onWebviewDragDropEventMock.mockImplementation(async (handler: (event: any) => void) => {
      nativeWebviewDragDropHandler = handler;
      return () => {
        if (nativeWebviewDragDropHandler === handler) {
          nativeWebviewDragDropHandler = null;
        }
      };
    });
    onWindowDragDropEventMock.mockImplementation(async (handler: (event: any) => void) => {
      nativeWindowDragDropHandler = handler;
      return () => {
        if (nativeWindowDragDropHandler === handler) {
          nativeWindowDragDropHandler = null;
        }
      };
    });
    terminals.length = 0;
    listenMock.mockImplementation(async (eventName: string, handler: (event: any) => void) => {
      const listeners = eventListeners.get(eventName) ?? [];
      listeners.push(handler);
      eventListeners.set(eventName, listeners);
      return () => {
        const current = eventListeners.get(eventName) ?? [];
        eventListeners.set(
          eventName,
          current.filter((listener) => listener !== handler),
        );
      };
    });
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "attach_session_with_snapshot") {
        emitTerminalSnapshot("session-1");
        return null;
      }
      if (cmd === "get_session_recovery_state") {
        return {
          serialized: "restored scrollback",
          cols: 80,
          rows: 24,
          cursorRow: 1,
          cursorCol: 0,
          cursorVisible: true,
          savedAt: 1,
          sequence: 1,
        };
      }
      return null;
    });
  });

  afterEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(null);
    listenMock.mockReset();
    eventListeners.clear();
    warningToastMock.mockReset();
    errorToastMock.mockReset();
    vi.clearAllMocks();
  });

  it("applies the initial task snapshot from the ordered stream without a resume step", async () => {
    const callOrder: string[] = [];
    const { useTerminal } = await import("./useTerminal");
    invokeMock.mockImplementation(async (cmd: string) => {
      callOrder.push(cmd);
      if (cmd === "attach_session_with_snapshot") {
        return null;
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "hello",
            spawnFn: async () => {},
          },
          {
            agentProvider: "claude",
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);

    const startPromise = wrapper.vm.startListening();
    const terminal = terminals[0];
    expect(terminal).toBeDefined();
    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    let startSettled = false;
    startPromise.finally(() => {
      startSettled = true;
    });
    for (let attempt = 0; attempt < 50 && !startSettled; attempt += 1) {
      while (terminal.pendingStringWrites.length > 0) {
        terminal.flushNextStringWrite();
        await Promise.resolve();
      }
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await startPromise;

    const snapshotListeners = eventListeners.get("terminal_snapshot") ?? [];
    expect(snapshotListeners).toHaveLength(1);

    snapshotListeners[0]({
      payload: {
        session_id: "session-1",
        snapshot: {
          version: 1,
          rows: 24,
          cols: 80,
          cursor_row: 0,
          cursor_col: 0,
          cursor_visible: true,
          vt: "restored scrollback",
        },
      },
    });

    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    while (terminal.pendingStringWrites.length > 0) {
      terminal.flushNextStringWrite();
      await Promise.resolve();
    }

    expect(callOrder).toEqual([
      "attach_session_with_snapshot",
      "resize_session",
      "resize_session",
    ]);
    expect(terminal.reset).toHaveBeenCalledTimes(1);
  });

  it("detaches the active task session stream when the terminal unmounts", async () => {
    const callOrder: string[] = [];
    const { useTerminal } = await import("./useTerminal");
    invokeMock.mockImplementation(async (cmd: string) => {
      callOrder.push(cmd);
      if (cmd === "attach_session_with_snapshot") {
        emitTerminalSnapshot("session-1");
        return null;
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "hello",
            spawnFn: async () => {},
          },
          {
            agentProvider: "claude",
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);

    const startPromise = wrapper.vm.startListening();
    const terminal = terminals[0];
    expect(terminal).toBeDefined();
    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    while (terminal.pendingStringWrites.length > 0) {
      terminal.flushNextStringWrite();
      await Promise.resolve();
    }
    await startPromise;

    wrapper.unmount();

    for (let attempt = 0; attempt < 10 && !callOrder.includes("detach_session"); attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(callOrder).toEqual([
      "attach_session_with_snapshot",
      "resize_session",
      "resize_session",
      "detach_session",
    ]);
  });

  it("respawns a task terminal when scrollback exists but the PTY is gone", async () => {
    const spawnFn = vi.fn(async () => {});
    const { useTerminal } = await import("./useTerminal");

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_session_recovery_state") {
        return {
          serialized: "restored scrollback",
          cols: 80,
          rows: 24,
          cursorRow: 1,
          cursorCol: 0,
          cursorVisible: true,
          savedAt: 1,
          sequence: 7,
        };
      }
      if (cmd === "attach_session_with_snapshot") {
        if (spawnFn.mock.calls.length === 0) {
          throw new AppError("session not found: session-1", "session_not_found");
        }
        emitTerminalSnapshot("session-1");
        return null;
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "hello",
            spawnFn,
          },
          {
            agentProvider: "codex",
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);

    const startPromise = wrapper.vm.startListening();
    const terminal = terminals[0];
    expect(terminal).toBeDefined();

    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    while (terminal.pendingStringWrites.length > 0) {
      terminal.flushNextStringWrite();
      await Promise.resolve();
    }
    void startPromise;

    for (let attempt = 0; attempt < 20 && (spawnFn.mock.calls.length === 0 || warningToastMock.mock.calls.length === 0); attempt += 1) {
      while (terminal.pendingStringWrites.length > 0) {
        terminal.flushNextStringWrite();
        await Promise.resolve();
      }
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(warningToastMock).toHaveBeenCalledWith("toasts.sessionRespawnedWithScrollback");
    expect(errorToastMock).not.toHaveBeenCalled();
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "attach_session_with_snapshot")).toHaveLength(1);
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "attach_session")).toHaveLength(1);
    expect(terminal.write).toHaveBeenCalledWith("restored scrollback", expect.any(Function));
    expect(
      terminal.write.mock.calls.some(
        ([data]) =>
          typeof data === "string" &&
          data.includes("Failed to reconnect to existing session"),
      ),
    ).toBe(false);
  });

  it("leaves a terminal message when the first task attach cannot find a live PTY", async () => {
    const spawnFn = vi.fn(async () => {});
    const { useTerminal } = await import("./useTerminal");

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_exists") {
        return false;
      }
      if (cmd === "attach_session_with_snapshot") {
        throw new AppError("session not found: session-1", "session_not_found");
      }
      if (cmd === "get_session_recovery_state") {
        return null;
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "hello",
            spawnFn,
          },
          {
            agentProvider: "codex",
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);

    await wrapper.vm.startListening();

    const terminal = terminals[0];
    expect(terminal).toBeDefined();
    expect(spawnFn).not.toHaveBeenCalled();
    expect(warningToastMock).not.toHaveBeenCalled();
    expect(errorToastMock).not.toHaveBeenCalled();
    expect(
      terminal.write.mock.calls.some(
        ([data]) =>
          typeof data === "string" &&
          data.includes("Knock, knock, Neo."),
      ),
    ).toBe(true);
  });

  it("respawns a missing task session on first attach when the worktree still exists", async () => {
    const spawnFn = vi.fn(async () => {});
    const { useTerminal } = await import("./useTerminal");

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_exists") {
        return true;
      }
      if (cmd === "attach_session_with_snapshot") {
        if (spawnFn.mock.calls.length === 0) {
          throw new AppError("session not found: session-1", "session_not_found");
        }
        emitTerminalSnapshot("session-1", "fresh session output");
        return null;
      }
      if (cmd === "attach_session") {
        return null;
      }
      if (cmd === "get_session_recovery_state") {
        return null;
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "hello",
            spawnFn,
          },
          {
            agentProvider: "codex",
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);

    const startPromise = wrapper.vm.startListening();
    const terminal = terminals[0];
    expect(terminal).toBeDefined();

    for (let attempt = 0; attempt < 20 && (spawnFn.mock.calls.length === 0 || warningToastMock.mock.calls.length === 0); attempt += 1) {
      while (terminal.pendingStringWrites.length > 0) {
        terminal.flushNextStringWrite();
        await Promise.resolve();
      }
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    let startSettled = false;
    startPromise.finally(() => {
      startSettled = true;
    });
    for (let attempt = 0; attempt < 50 && !startSettled; attempt += 1) {
      while (terminal.pendingStringWrites.length > 0) {
        terminal.flushNextStringWrite();
        await Promise.resolve();
      }
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    await startPromise;

    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(warningToastMock).toHaveBeenCalledWith("toasts.sessionRespawned");
    expect(errorToastMock).not.toHaveBeenCalled();
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "attach_session_with_snapshot")).toHaveLength(1);
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "attach_session")).toHaveLength(1);
    expect(terminal.write).not.toHaveBeenCalledWith("fresh session output", expect.any(Function));
    expect(
      terminal.write.mock.calls.some(
        ([data]) =>
          typeof data === "string" &&
          data.includes("Knock, knock, Neo."),
      ),
    ).toBe(false);
  });

  it("attaches freshly spawned task sessions live instead of replaying a snapshot", async () => {
    const spawnFn = vi.fn(async () => {});
    const { useTerminal } = await import("./useTerminal");

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "attach_session_with_snapshot") {
        throw new AppError("session not found: session-1", "session_not_found");
      }
      if (cmd === "attach_session") {
        return null;
      }
      if (cmd === "file_exists") {
        return true;
      }
      if (cmd === "get_session_recovery_state") {
        return null;
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "hello",
            spawnFn,
          },
          {
            agentProvider: "claude",
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);

    await wrapper.vm.startListening();

    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "attach_session_with_snapshot")).toHaveLength(1);
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "attach_session")).toHaveLength(1);
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "resume_session_stream")).toHaveLength(0);
    expect(terminals[0]?.reset).not.toHaveBeenCalled();
  });

  it("spawns a shell terminal when no pre-warmed session exists", async () => {
    const spawnFn = vi.fn(async () => {});
    const { useTerminal } = await import("./useTerminal");

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "attach_session") {
        if (spawnFn.mock.calls.length === 0) {
          throw new Error("session not found: shell-wt-1");
        }
        return null;
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "shell-wt-1",
          {
            cwd: "/tmp/task",
            prompt: "",
            spawnFn,
          },
          undefined,
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);

    await wrapper.vm.startListening();

    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(spawnFn).toHaveBeenCalledWith("shell-wt-1", "/tmp/task", "", 80, 24);
    expect(errorToastMock).not.toHaveBeenCalled();
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "attach_session")).toHaveLength(2);
  });

  it("respawns once when a previously attached task session disappears and daemon_ready fires", async () => {
    let attachCount = 0;
    let resolveSpawn: (() => void) | null = null;
    let spawnCompleted = false;
    const spawnFn = vi.fn(
      async () =>
        await new Promise<void>((resolve) => {
          resolveSpawn = () => {
            spawnCompleted = true;
            resolve();
          };
        }),
    );
    const { useTerminal } = await import("./useTerminal");

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_session_recovery_state") {
        return {
          serialized: "restored scrollback",
          cols: 80,
          rows: 24,
          cursorRow: 1,
          cursorCol: 0,
          cursorVisible: true,
          savedAt: 1,
          sequence: 7,
        };
      }
      if (cmd === "attach_session_with_snapshot") {
        attachCount += 1;
        if (attachCount === 1) {
          emitTerminalSnapshot("session-1");
          return null;
        }
      }
      if (cmd === "attach_session") {
        if (!spawnCompleted) {
          throw new AppError("session not found: session-1", "session_not_found");
        }
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "hello",
            spawnFn,
          },
          {
            agentProvider: "codex",
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);

    const startPromise = wrapper.vm.startListening();
    const terminal = terminals[0];
    expect(terminal).toBeDefined();

    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    while (terminal.pendingStringWrites.length > 0) {
      terminal.flushNextStringWrite();
      await Promise.resolve();
    }
    await startPromise;

    const streamLostListeners = eventListeners.get("session_stream_lost") ?? [];
    const daemonReadyListeners = eventListeners.get("daemon_ready") ?? [];
    expect(streamLostListeners).toHaveLength(1);
    expect(daemonReadyListeners).toHaveLength(1);

    streamLostListeners[0]({ payload: { session_id: "session-1" } });

    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    terminal.flushNextStringWrite();

    for (let attempt = 0; attempt < 10 && spawnFn.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    daemonReadyListeners[0]({ payload: {} });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    while (terminal.pendingStringWrites.length > 0) {
      terminal.flushNextStringWrite();
      await Promise.resolve();
    }

    resolveSpawn?.();

    for (
      let attempt = 0;
      attempt < 10 &&
      (spawnFn.mock.calls.length === 0 || invokeMock.mock.calls.filter(([cmd]) => cmd === "attach_session").length < 2);
      attempt += 1
    ) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(warningToastMock).toHaveBeenCalledWith("toasts.sessionRespawnedWithScrollback");
  });

  it("attaches Copilot sessions without replaying recovery state on first mount", async () => {
    const callOrder: string[] = [];
    const { useTerminal } = await import("./useTerminal");
    invokeMock.mockImplementation(async (cmd: string) => {
      callOrder.push(cmd);
      if (cmd === "attach_session_with_snapshot") {
        emitTerminalSnapshot("session-1", "restored copilot scrollback");
        return null;
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "hello",
            spawnFn: async () => {},
          },
          {
            agentProvider: "copilot",
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);

    const startPromise = wrapper.vm.startListening();
    const terminal = terminals[0];
    expect(terminal).toBeDefined();
    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    while (terminal.pendingStringWrites.length > 0) {
      terminal.flushNextStringWrite();
      await Promise.resolve();
    }
    await startPromise;

    expect(callOrder).toEqual([
      "attach_session_with_snapshot",
      "resize_session",
    ]);
    expect(terminal.reset).toHaveBeenCalledTimes(1);
  });

  it("reconnects immediately after session_stream_lost for task terminals", async () => {
    const callOrder: string[] = [];
    const { useTerminal } = await import("./useTerminal");

    invokeMock.mockImplementation(async (cmd: string) => {
      callOrder.push(cmd);
      if (cmd === "attach_session_with_snapshot") {
        emitTerminalSnapshot("session-1", "restored copilot scrollback");
        return null;
      }
      if (cmd === "get_session_recovery_state") {
        return {
          serialized: "restored copilot scrollback",
          cols: 80,
          rows: 24,
          cursorRow: 1,
          cursorCol: 0,
          cursorVisible: true,
          savedAt: 1,
          sequence: 10,
        };
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "hello",
            spawnFn: async () => {},
          },
          {
            agentProvider: "copilot",
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);

    const startPromise = wrapper.vm.startListening();
    const terminal = terminals[0];
    expect(terminal).toBeDefined();

    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    while (terminal.pendingStringWrites.length > 0) {
      terminal.flushNextStringWrite();
      await Promise.resolve();
    }
    await startPromise;

    expect(callOrder).toEqual([
      "attach_session_with_snapshot",
      "resize_session",
    ]);

    const streamLostListeners = eventListeners.get("session_stream_lost") ?? [];
    const daemonReadyListeners = eventListeners.get("daemon_ready") ?? [];
    expect(streamLostListeners).toHaveLength(1);
    expect(daemonReadyListeners).toHaveLength(1);

    streamLostListeners[0]({ payload: { session_id: "session-1" } });

    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    terminal.flushNextStringWrite();

    for (let attempt = 0; attempt < 10 && callOrder.length < 5; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(callOrder).toEqual([
      "attach_session_with_snapshot",
      "resize_session",
      "attach_session",
      "resize_session",
    ]);
    expect(terminal.reset).toHaveBeenCalledTimes(1);
  });

  it("marks the terminal detached after session_exit so ensureConnected rechecks the daemon", async () => {
    const callOrder: string[] = [];
    const { useTerminal } = await import("./useTerminal");
    let resizeCount = 0;

    invokeMock.mockImplementation(async (cmd: string) => {
      callOrder.push(cmd);
      if (cmd === "attach_session_with_snapshot") {
        emitTerminalSnapshot("session-1");
        return null;
      }
      if (cmd === "get_session_recovery_state") {
        return {
          serialized: "restored scrollback",
          cols: 80,
          rows: 24,
          cursorRow: 1,
          cursorCol: 0,
          cursorVisible: true,
          savedAt: 1,
          sequence: 12,
        };
      }
      if (cmd === "resize_session") {
        resizeCount += 1;
        if (resizeCount === 2) {
          throw new AppError("session not found: session-1", "session_not_found");
        }
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening, ensureConnected } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "hello",
            spawnFn: async () => {},
          },
          {
            agentProvider: "copilot",
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening, ensureConnected };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);

    const startPromise = wrapper.vm.startListening();
    const terminal = terminals[0];
    expect(terminal).toBeDefined();

    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    while (terminal.pendingStringWrites.length > 0) {
      terminal.flushNextStringWrite();
      await Promise.resolve();
    }
    await startPromise;

    const exitListeners = eventListeners.get("session_exit") ?? [];
    expect(exitListeners).toHaveLength(1);
    exitListeners[0]({ payload: { session_id: "session-1", code: 0 } });

    const ensurePromise = wrapper.vm.ensureConnected();

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      while (terminal.pendingStringWrites.length > 0) {
        terminal.flushNextStringWrite();
        await Promise.resolve();
      }
      if (callOrder.length >= 5) break;
    }

    await ensurePromise;

    expect(callOrder).toEqual([
      "attach_session_with_snapshot",
      "resize_session",
      "attach_session",
      "resize_session",
    ]);
  });

  it("re-attaches during daemon turnover without depending on snapshot replay", async () => {
    const callOrder: string[] = [];
    const { useTerminal } = await import("./useTerminal");
    invokeMock.mockImplementation(async (cmd: string) => {
      callOrder.push(cmd);
      if (cmd === "attach_session_with_snapshot") {
        emitTerminalSnapshot("session-1", "restored copilot scrollback");
        return null;
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "hello",
            spawnFn: async () => {},
          },
          {
            agentProvider: "copilot",
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);

    const startPromise = wrapper.vm.startListening();
    const terminal = terminals[0];
    expect(terminal).toBeDefined();
    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    while (terminal.pendingStringWrites.length > 0) {
      terminal.flushNextStringWrite();
      await Promise.resolve();
    }
    await startPromise;
    expect(terminal.reset).toHaveBeenCalledTimes(1);

    const streamLostListeners = eventListeners.get("session_stream_lost") ?? [];
    expect(streamLostListeners).toHaveLength(1);
    streamLostListeners[0]({ payload: { session_id: "session-1" } });

    for (let attempt = 0; attempt < 10 && callOrder.length < 6; attempt += 1) {
      while (terminal.pendingStringWrites.length > 0) {
        terminal.flushNextStringWrite();
        await Promise.resolve();
      }
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(callOrder).toEqual([
      "attach_session_with_snapshot",
      "resize_session",
      "attach_session",
      "resize_session",
    ]);
    expect(terminal.reset).toHaveBeenCalledTimes(1);
  });

  it("suppresses browser navigation and pastes dropped file paths into agent terminals", async () => {
    const { useTerminal } = await import("./useTerminal");

    const TestHarness = defineComponent({
      setup() {
        const { init } = useTerminal(
          "session-1",
          undefined,
          {
            agentTerminal: true,
            worktreePath: "/tmp/task",
          },
        );

        return { init };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);

    const dropEvent = new Event("drop") as Event & {
      dataTransfer: { files: Array<{ path: string; type: string }> };
      preventDefault: ReturnType<typeof vi.fn>;
      stopPropagation: ReturnType<typeof vi.fn>;
    };
    dropEvent.dataTransfer = {
      files: [{ path: "/tmp/task/screenshot one.png", type: "image/png" }],
    };
    dropEvent.preventDefault = vi.fn();
    dropEvent.stopPropagation = vi.fn();

    terminalElement.dispatchEvent(dropEvent);

    expect(dropEvent.preventDefault).toHaveBeenCalled();
    expect(dropEvent.stopPropagation).toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("send_input", {
      sessionId: "session-1",
      data: Array.from(new TextEncoder().encode("'/tmp/task/screenshot one.png'")),
    });
  });

  it("wraps dropped file paths in bracketed paste markers after attach snapshots enable bracketed paste", async () => {
    const { useTerminal } = await import("./useTerminal");
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "attach_session_with_snapshot") {
        return null;
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "",
            spawnFn: async () => {},
          },
          {
            agentProvider: "claude",
            agentTerminal: true,
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);

    const startPromise = wrapper.vm.startListening();
    const terminal = terminals[0];
    expect(terminal).toBeDefined();
    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    while (terminal.pendingStringWrites.length > 0) {
      terminal.flushNextStringWrite();
      await Promise.resolve();
    }
    await startPromise;
    emitTerminalSnapshot("session-1", "\u001b[?2004hrestored scrollback");
    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    while (terminal.pendingStringWrites.length > 0) {
      terminal.flushNextStringWrite();
      await Promise.resolve();
    }

    invokeMock.mockClear();

    const dropEvent = new Event("drop") as Event & {
      dataTransfer: { files: Array<{ path: string; type: string }> };
      preventDefault: ReturnType<typeof vi.fn>;
      stopPropagation: ReturnType<typeof vi.fn>;
    };
    dropEvent.dataTransfer = {
      files: [{ path: "/tmp/task/screenshot one.png", type: "image/png" }],
    };
    dropEvent.preventDefault = vi.fn();
    dropEvent.stopPropagation = vi.fn();

    terminalElement.dispatchEvent(dropEvent);

    expect(invokeMock).toHaveBeenCalledWith("send_input", {
      sessionId: "session-1",
      data: Array.from(new TextEncoder().encode("\u001b[200~'/tmp/task/screenshot one.png'\u001b[201~")),
    });
  });

  it("pastes native Tauri window drop paths for agent terminals when browser files do not expose path", async () => {
    isTauriMock = true;
    vi.resetModules();
    const { useTerminal } = await import("./useTerminal");

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "attach_session_with_snapshot") {
        return null;
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "",
            spawnFn: async () => {},
          },
          {
            agentProvider: "claude",
            agentTerminal: true,
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    terminalElement.getBoundingClientRect = vi.fn(() => ({
      x: 240,
      y: 180,
      left: 240,
      top: 180,
      right: 1040,
      bottom: 780,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    })) as typeof terminalElement.getBoundingClientRect;
    wrapper.vm.init(terminalElement);

    const startPromise = wrapper.vm.startListening();
    const terminal = terminals[0];
    expect(terminal).toBeDefined();
    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    while (terminal.pendingStringWrites.length > 0) {
      terminal.flushNextStringWrite();
      await Promise.resolve();
    }
    await startPromise;
    emitTerminalSnapshot("session-1", "\u001b[?2004hrestored scrollback");
    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    while (terminal.pendingStringWrites.length > 0) {
      terminal.flushNextStringWrite();
      await Promise.resolve();
    }

    invokeMock.mockClear();
    expect(nativeWindowDragDropHandler).not.toBeNull();

    nativeWindowDragDropHandler?.({
      payload: {
        type: "drop",
        paths: ["/tmp/task/screenshot one.png"],
        position: {
          x: 320,
          y: 260,
        },
      },
    });

    expect(invokeMock).toHaveBeenCalledWith("send_input", {
      sessionId: "session-1",
      data: Array.from(new TextEncoder().encode("\u001b[200~'/tmp/task/screenshot one.png'\u001b[201~")),
    });
  });

  it("pastes native Tauri webview drop paths when the runtime exposes logical conversion", async () => {
    isTauriMock = true;
    vi.resetModules();
    const { useTerminal } = await import("./useTerminal");

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "attach_session_with_snapshot") {
        return null;
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "",
            spawnFn: async () => {},
          },
          {
            agentProvider: "claude",
            agentTerminal: true,
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    terminalElement.getBoundingClientRect = vi.fn(() => ({
      x: 240,
      y: 180,
      left: 240,
      top: 180,
      right: 1040,
      bottom: 780,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    })) as typeof terminalElement.getBoundingClientRect;
    wrapper.vm.init(terminalElement);

    const startPromise = wrapper.vm.startListening();
    const terminal = terminals[0];
    expect(terminal).toBeDefined();
    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    while (terminal.pendingStringWrites.length > 0) {
      terminal.flushNextStringWrite();
      await Promise.resolve();
    }
    await startPromise;
    emitTerminalSnapshot("session-1", "\u001b[?2004hrestored scrollback");
    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    while (terminal.pendingStringWrites.length > 0) {
      terminal.flushNextStringWrite();
      await Promise.resolve();
    }

    invokeMock.mockClear();
    expect(nativeWebviewDragDropHandler).not.toBeNull();

    nativeWebviewDragDropHandler?.({
      payload: {
        type: "drop",
        paths: ["/tmp/task/screenshot one.png"],
        position: {
          x: 640,
          y: 520,
          toLogical: () => ({ x: 320, y: 260 }),
        },
      },
    });

    expect(invokeMock).toHaveBeenCalledWith("send_input", {
      sessionId: "session-1",
      data: Array.from(new TextEncoder().encode("\u001b[200~'/tmp/task/screenshot one.png'\u001b[201~")),
    });
  });

  it("deduplicates native Tauri drop events when window and webview listeners both fire", async () => {
    isTauriMock = true;
    vi.resetModules();
    const { useTerminal } = await import("./useTerminal");

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "attach_session_with_snapshot") {
        return null;
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "",
            spawnFn: async () => {},
          },
          {
            agentProvider: "codex",
            agentTerminal: true,
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    terminalElement.getBoundingClientRect = vi.fn(() => ({
      x: 240,
      y: 180,
      left: 240,
      top: 180,
      right: 1040,
      bottom: 780,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    })) as typeof terminalElement.getBoundingClientRect;
    wrapper.vm.init(terminalElement);

    const startPromise = wrapper.vm.startListening();
    const terminal = terminals[0];
    expect(terminal).toBeDefined();
    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    while (terminal.pendingStringWrites.length > 0) {
      terminal.flushNextStringWrite();
      await Promise.resolve();
    }
    await startPromise;
    emitTerminalSnapshot("session-1", "\u001b[?2004hrestored scrollback");
    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    while (terminal.pendingStringWrites.length > 0) {
      terminal.flushNextStringWrite();
      await Promise.resolve();
    }

    invokeMock.mockClear();

    const dropEvent = {
      payload: {
        type: "drop",
        paths: ["/tmp/task/screenshot one.png"],
        position: {
          x: 320,
          y: 260,
          toLogical: () => ({ x: 320, y: 260 }),
        },
      },
    };

    nativeWindowDragDropHandler?.(dropEvent);
    nativeWebviewDragDropHandler?.(dropEvent);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("send_input", {
      sessionId: "session-1",
      data: Array.from(new TextEncoder().encode("\u001b[200~'/tmp/task/screenshot one.png'\u001b[201~")),
    });
  });

  it("treats Copilot drops as bracketed paste even when the restored stream does not advertise bracketed mode", async () => {
    isTauriMock = true;
    vi.resetModules();
    const { useTerminal } = await import("./useTerminal");

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "attach_session_with_snapshot") {
        emitTerminalSnapshot("session-1", "restored copilot scrollback");
        return null;
      }
      return null;
    });

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "",
            spawnFn: async () => {},
          },
          {
            agentProvider: "copilot",
            agentTerminal: true,
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    terminalElement.getBoundingClientRect = vi.fn(() => ({
      x: 240,
      y: 180,
      left: 240,
      top: 180,
      right: 1040,
      bottom: 780,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    })) as typeof terminalElement.getBoundingClientRect;
    wrapper.vm.init(terminalElement);

    const startPromise = wrapper.vm.startListening();
    const terminal = terminals[0];
    expect(terminal).toBeDefined();
    for (let attempt = 0; attempt < 10 && terminal.pendingStringWrites.length === 0; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    while (terminal.pendingStringWrites.length > 0) {
      terminal.flushNextStringWrite();
      await Promise.resolve();
    }
    await startPromise;

    invokeMock.mockClear();

    nativeWindowDragDropHandler?.({
      payload: {
        type: "drop",
        paths: ["/tmp/task/ChatGPT Image Feb 21, 2026, 12_59_00 AM.png"],
        position: {
          x: 320,
          y: 260,
        },
      },
    });

    expect(invokeMock).toHaveBeenCalledWith("send_input", {
      sessionId: "session-1",
      data: Array.from(new TextEncoder().encode("\u001b[200~'/tmp/task/ChatGPT Image Feb 21, 2026, 12_59_00 AM.png'\u001b[201~")),
    });
  });

  it("does not install dropped-file handlers for non-agent terminals", async () => {
    const { useTerminal } = await import("./useTerminal");

    const TestHarness = defineComponent({
      setup() {
        const { init } = useTerminal(
          "session-1",
          undefined,
          {
            agentTerminal: false,
          },
        );

        return { init };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    const addEventListenerSpy = vi.spyOn(terminalElement, "addEventListener");

    wrapper.vm.init(terminalElement);

    expect(addEventListenerSpy).not.toHaveBeenCalledWith("drop", expect.any(Function), undefined);
  });

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
        const { init } = useTerminal(
          "session-1",
          undefined,
          {
            agentTerminal: true,
          },
        );

        return { init };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);

    const terminal = terminals[0];
    const keyHandler = terminal.attachCustomKeyEventHandler.mock.calls[0][0] as (event: KeyboardEvent) => boolean;
    const keyboardEvent = {
      type: "keydown",
      key: "v",
      metaKey: true,
      altKey: false,
      ctrlKey: false,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;

    const allowed = keyHandler(keyboardEvent);
    await Promise.resolve();

    expect(allowed).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith("read_clipboard_image_png", {});
  });

  it("responds to kitty clipboard image reads after an explicit paste", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "read_clipboard_image_png") {
        return {
          mimeType: "image/png",
          pngBase64: "aGVsbG8=",
          width: 1,
          height: 1,
        };
      }
      if (cmd === "attach_session") {
        return null;
      }
      return null;
    });

    const { useTerminal } = await import("./useTerminal");

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "",
            spawnFn: async () => {},
          },
          {
            agentTerminal: true,
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn(() => null) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);
    await wrapper.vm.startListening();

    const terminal = terminals[0];
    const keyHandler = terminal.attachCustomKeyEventHandler.mock.calls[0][0] as (event: KeyboardEvent) => boolean;
    keyHandler({
      type: "keydown",
      key: "v",
      metaKey: true,
      altKey: false,
      ctrlKey: false,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent);
    await Promise.resolve();

    const outputListener = eventListeners.get("terminal_output")?.[0];
    outputListener?.({
      payload: {
        session_id: "session-1",
        data: Array.from(new TextEncoder().encode("\u001b]5522;type=read;aW1hZ2UvcG5n\u0007")),
      },
    });

    for (let attempt = 0; attempt < 10 && !invokeMock.mock.calls.some(([cmd]) => cmd === "send_input"); attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(invokeMock).toHaveBeenCalledWith("send_input", expect.objectContaining({
      sessionId: "session-1",
      data: expect.any(Array),
    }));
  });

  it("does not force-scroll the viewport after manual scrollback during live output", async () => {
    const { useTerminal } = await import("./useTerminal");

    const TestHarness = defineComponent({
      setup() {
        const { init, startListening } = useTerminal(
          "session-1",
          {
            cwd: "/tmp/task",
            prompt: "hello",
            spawnFn: async () => {},
          },
          {
            agentProvider: "copilot",
            worktreePath: "/tmp/task",
          },
        );

        return { init, startListening };
      },
      render() {
        return h("div");
      },
    });

    const wrapper = mount(TestHarness);
    const terminalElement = document.createElement("div");
    const viewport = document.createElement("div");
    Object.defineProperty(terminalElement, "offsetWidth", { configurable: true, value: 800 });
    Object.defineProperty(terminalElement, "offsetHeight", { configurable: true, value: 600 });
    terminalElement.querySelector = vi.fn((selector: string) => {
      return selector === ".xterm-viewport" ? viewport : null;
    }) as typeof terminalElement.querySelector;
    terminalElement.closest = vi.fn(() => null) as typeof terminalElement.closest;
    wrapper.vm.init(terminalElement);
    await wrapper.vm.startListening();

    const terminal = terminals[0];
    expect(terminal).toBeDefined();
    terminal.buffer.active.viewportY = 12;

    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -30 }));

    const outputListener = eventListeners.get("terminal_output")?.[0];
    outputListener?.({
      payload: {
        session_id: "session-1",
        data: Array.from(new TextEncoder().encode("streaming output")),
      },
    });

    expect(terminal.scrollToLine).not.toHaveBeenCalled();
  });
});
