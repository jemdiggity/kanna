import type { RecoverySnapshot } from "./protocol";

if (typeof globalThis.window === "undefined") {
  Object.defineProperty(globalThis, "window", {
    value: globalThis,
    configurable: true,
    writable: true,
  });
}

const headlessModule = await import("@xterm/headless");
const serializeModule = await import("@xterm/addon-serialize");

interface HeadlessTerminal {
  cols: number;
  rows: number;
  resize(cols: number, rows: number): void;
  write(data: string | Uint8Array, callback?: () => void): void;
  loadAddon(addon: SerializeAddon): void;
}

interface HeadlessTerminalConstructor {
  new (options?: {
    cols?: number;
    rows?: number;
    scrollback?: number;
    allowProposedApi?: boolean;
  }): HeadlessTerminal;
}

interface SerializeAddon {
  activate(terminal: unknown): void;
  dispose(): void;
  serialize(): string;
}

interface SerializeAddonConstructor {
  new (): SerializeAddon;
}

interface HeadlessModuleShape {
  Terminal?: HeadlessTerminalConstructor;
  default?: {
    Terminal?: HeadlessTerminalConstructor;
  };
}

interface SerializeModuleShape {
  SerializeAddon?: SerializeAddonConstructor;
  default?: {
    SerializeAddon?: SerializeAddonConstructor;
  };
}

function resolveTerminalCtor(): HeadlessTerminalConstructor {
  const resolvedHeadlessModule = headlessModule as unknown as HeadlessModuleShape;
  const terminalCtor = resolvedHeadlessModule.Terminal ?? resolvedHeadlessModule.default?.Terminal;
  if (!terminalCtor) {
    throw new Error("Failed to resolve Terminal constructor from @xterm/headless");
  }
  return terminalCtor;
}

function resolveSerializeAddonCtor(): SerializeAddonConstructor {
  const resolvedSerializeModule = serializeModule as unknown as SerializeModuleShape;
  const addonCtor =
    resolvedSerializeModule.SerializeAddon ?? resolvedSerializeModule.default?.SerializeAddon;
  if (!addonCtor) {
    throw new Error("Failed to resolve SerializeAddon constructor from @xterm/addon-serialize");
  }
  return addonCtor;
}

const TerminalCtor = resolveTerminalCtor();
const SerializeAddonCtor = resolveSerializeAddonCtor();

export interface SessionMirrorOptions {
  sessionId: string;
  cols: number;
  rows: number;
}

export class SessionMirror {
  private readonly terminal: HeadlessTerminal;
  private readonly serializeAddon = new SerializeAddonCtor();
  private readonly sessionId: string;
  private sequence = 0;
  private cols: number;
  private rows: number;

  constructor(sessionId: string, options: Omit<SessionMirrorOptions, "sessionId">);
  constructor(options: SessionMirrorOptions);
  constructor(
    sessionOrOptions: string | SessionMirrorOptions,
    options?: Omit<SessionMirrorOptions, "sessionId">,
  ) {
    const session =
      typeof sessionOrOptions === "string"
        ? { sessionId: sessionOrOptions, cols: options?.cols ?? 80, rows: options?.rows ?? 24 }
        : sessionOrOptions;

    this.sessionId = session.sessionId;
    this.cols = session.cols;
    this.rows = session.rows;
    this.terminal = new TerminalCtor({
      cols: session.cols,
      rows: session.rows,
      scrollback: 10_000,
      allowProposedApi: true,
    });
    this.terminal.loadAddon(this.serializeAddon);
  }

  async write(data: Uint8Array, sequence?: number): Promise<void> {
    if (typeof sequence === "number") {
      this.sequence = sequence;
    }

    await new Promise<void>((resolve) => {
      this.terminal.write(data, resolve);
    });
  }

  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows);
    this.cols = cols;
    this.rows = rows;
  }

  async restore(snapshot: RecoverySnapshot): Promise<void> {
    this.cols = snapshot.cols;
    this.rows = snapshot.rows;
    this.terminal.resize(snapshot.cols, snapshot.rows);
    this.sequence = snapshot.sequence;
    await new Promise<void>((resolve) => {
      this.terminal.write(snapshot.serialized, resolve);
    });
  }

  snapshot(): RecoverySnapshot {
    return {
      sessionId: this.sessionId,
      serialized: this.serializeAddon.serialize(),
      cols: this.cols,
      rows: this.rows,
      savedAt: Date.now(),
      sequence: this.sequence,
    };
  }
}
