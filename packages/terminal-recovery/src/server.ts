import { createInterface } from "node:readline";
import type { Writable } from "node:stream";
import type { Readable } from "node:stream";
import {
  formatResponse,
  parseCommand,
  type RecoveryCommand,
  type RecoveryResponse,
} from "./protocol";
import { SessionMirror } from "./sessionMirror";
import { SnapshotStore } from "./snapshotStore";

interface RecoveryServerOptions {
  input: Readable;
  output: Writable;
  snapshotStore: SnapshotStore;
  flushDebounceMs: number;
}

interface TrackedSession {
  mirror: SessionMirror;
  dirty: boolean;
  version: number;
  flushTimer: Timer | null;
  flushPromise: Promise<void> | null;
}

type Timer = ReturnType<typeof setTimeout>;

export class RecoveryServer {
  private readonly sessions = new Map<string, TrackedSession>();
  private stopping = false;

  constructor(private readonly options: RecoveryServerOptions) {}

  async start(): Promise<void> {
    const lines = createInterface({
      input: this.options.input,
      crlfDelay: Infinity,
    });

    try {
      for await (const line of lines) {
        if (this.stopping) {
          break;
        }
        if (line.trim().length === 0) {
          continue;
        }

        let response: RecoveryResponse;
        try {
          response = await this.handleCommand(parseCommand(line));
        } catch (error) {
          response = {
            type: "Error",
            message: error instanceof Error ? error.message : String(error),
          };
        }

        this.options.output.write(formatResponse(response));
        if (this.stopping) {
          break;
        }
      }
    } finally {
      lines.close();
    }
  }

  async handleCommand(command: RecoveryCommand): Promise<RecoveryResponse> {
    switch (command.type) {
      case "StartSession":
        if (this.sessions.has(command.sessionId)) {
          return {
            type: "Error",
            message: `Session already exists: ${command.sessionId}`,
          };
        }
        this.sessions.set(command.sessionId, {
          mirror: new SessionMirror({
            sessionId: command.sessionId,
            cols: command.cols,
            rows: command.rows,
          }),
          dirty: false,
          version: 0,
          flushTimer: null,
          flushPromise: null,
        });
        return { type: "Ok" };
      case "WriteOutput": {
        const session = this.requireSession(command.sessionId);
        await session.mirror.write(Uint8Array.from(command.data), command.sequence);
        this.markDirty(command.sessionId, session);
        return { type: "Ok" };
      }
      case "ResizeSession": {
        const session = this.requireSession(command.sessionId);
        session.mirror.resize(command.cols, command.rows);
        this.markDirty(command.sessionId, session);
        return { type: "Ok" };
      }
      case "EndSession":
        await this.flushSession(command.sessionId);
        this.cancelFlush(command.sessionId);
        this.sessions.delete(command.sessionId);
        return { type: "Ok" };
      case "GetSnapshot": {
        const liveSession = this.sessions.get(command.sessionId);
        if (liveSession) {
          return {
            type: "Snapshot",
            ...liveSession.mirror.snapshot(),
          };
        }

        const persisted = await this.options.snapshotStore.read(command.sessionId);
        return persisted ? { type: "Snapshot", ...persisted } : { type: "NotFound" };
      }
      case "FlushAndShutdown":
        this.stopping = true;
        await this.flushAll();
        return { type: "Ok" };
    }
  }

  private requireSession(sessionId: string): TrackedSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return session;
  }

  private markDirty(sessionId: string, session: TrackedSession): void {
    session.dirty = true;
    session.version += 1;
    this.cancelFlush(sessionId);
    if (session.flushPromise) {
      return;
    }
    session.flushTimer = setTimeout(() => {
      void this.flushSession(sessionId);
    }, this.options.flushDebounceMs);
  }

  private cancelFlush(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = null;
    }
  }

  private async flushSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.dirty) {
      return;
    }
    if (session.flushPromise) {
      await session.flushPromise;
      return;
    }

    this.cancelFlush(sessionId);
    session.flushPromise = this.flushUntilCurrent(sessionId, session);
    try {
      await session.flushPromise;
    } finally {
      const latestSession = this.sessions.get(sessionId);
      if (latestSession) {
        latestSession.flushPromise = null;
        if (latestSession.dirty && !latestSession.flushTimer) {
          latestSession.flushTimer = setTimeout(() => {
            void this.flushSession(sessionId);
          }, this.options.flushDebounceMs);
        }
      }
    }
  }

  private async flushUntilCurrent(sessionId: string, session: TrackedSession): Promise<void> {
    while (session.dirty) {
      const snapshot = session.mirror.snapshot();
      const versionAtSnapshot = session.version;
      session.dirty = false;
      await this.options.snapshotStore.write(snapshot);

      const latestSession = this.sessions.get(sessionId);
      if (!latestSession || latestSession !== session) {
        return;
      }
      if (latestSession.version === versionAtSnapshot && !latestSession.dirty) {
        return;
      }
    }
  }

  private async flushAll(): Promise<void> {
    await Promise.all(Array.from(this.sessions.keys(), (sessionId) => this.flushSession(sessionId)));
  }
}
