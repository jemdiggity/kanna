import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RecoveryResponse, RecoverySnapshot } from "./protocol";
import { SnapshotStore } from "./snapshotStore";
import { RecoveryServer } from "./server";

globalThis.window ??= globalThis;

function createLineReader(stream: PassThrough): () => Promise<string> {
  let buffer = "";
  const queuedLines: string[] = [];
  const waitingResolvers: Array<(line: string) => void> = [];

  const flushQueuedLines = () => {
    while (queuedLines.length > 0 && waitingResolvers.length > 0) {
      const resolve = waitingResolvers.shift();
      const line = queuedLines.shift();
      if (resolve && line !== undefined) {
        resolve(line);
      }
    }
  };

  stream.on("data", (chunk: Buffer | string) => {
    buffer += chunk.toString("utf8");

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }

      queuedLines.push(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
    }

    flushQueuedLines();
  });

  return () =>
    new Promise((resolve) => {
      waitingResolvers.push(resolve);
      flushQueuedLines();
    });
}

class ControlledSnapshotStore extends SnapshotStore {
  private firstWriteStartedResolve!: () => void;
  private releaseFirstWriteResolve!: () => void;
  private firstWriteStarted = new Promise<void>((resolve) => {
    this.firstWriteStartedResolve = resolve;
  });
  private releaseFirstWrite = new Promise<void>((resolve) => {
    this.releaseFirstWriteResolve = resolve;
  });
  private blockFirstWrite = true;

  async waitForFirstWriteStart(): Promise<void> {
    await this.firstWriteStarted;
  }

  allowFirstWriteToFinish(): void {
    this.releaseFirstWriteResolve();
  }

  override async write(snapshot: RecoverySnapshot): Promise<void> {
    if (this.blockFirstWrite) {
      this.blockFirstWrite = false;
      this.firstWriteStartedResolve();
      await this.releaseFirstWrite;
    }
    await super.write(snapshot);
  }
}

describe("RecoveryServer", () => {
  let rootDir: string | null = null;

  afterEach(async () => {
    if (rootDir) {
      await rm(rootDir, { force: true, recursive: true });
      rootDir = null;
    }
  });

  it("serves snapshots over line-delimited stdio after mirroring output", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "kanna-terminal-recovery-"));
    const input = new PassThrough();
    const output = new PassThrough();
    const server = new RecoveryServer({
      input,
      output,
      snapshotStore: new SnapshotStore(rootDir),
      flushDebounceMs: 1_000,
    });
    const readLine = createLineReader(output);

    const running = server.start();

    input.write('{"type":"StartSession","sessionId":"task-1","cols":80,"rows":24}\n');
    input.write('{"type":"WriteOutput","sessionId":"task-1","data":[104,101,108,108,111],"sequence":5}\n');
    input.write('{"type":"GetSnapshot","sessionId":"task-1"}\n');

    expect(JSON.parse(await readLine()) as RecoveryResponse).toEqual({ type: "Ok" });
    expect(JSON.parse(await readLine()) as RecoveryResponse).toEqual({ type: "Ok" });

    const snapshot = JSON.parse(await readLine()) as RecoveryResponse;
    expect(snapshot.type).toBe("Snapshot");
    if (snapshot.type !== "Snapshot") {
      throw new Error("expected snapshot response");
    }
    expect(snapshot.sessionId).toBe("task-1");
    expect(snapshot.sequence).toBe(5);
    expect(snapshot.serialized).toContain("hello");

    input.end();
    await running;
  });

  it("flushes dirty sessions on shutdown and persists them to disk", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "kanna-terminal-recovery-"));
    const input = new PassThrough();
    const output = new PassThrough();
    const store = new SnapshotStore(rootDir);
    const server = new RecoveryServer({
      input,
      output,
      snapshotStore: store,
      flushDebounceMs: 60_000,
    });
    const readLine = createLineReader(output);

    const running = server.start();

    input.write('{"type":"StartSession","sessionId":"task-2","cols":80,"rows":24}\n');
    input.write('{"type":"WriteOutput","sessionId":"task-2","data":[98,121,101],"sequence":9}\n');
    input.write('{"type":"FlushAndShutdown"}\n');

    expect(JSON.parse(await readLine()) as RecoveryResponse).toEqual({ type: "Ok" });
    expect(JSON.parse(await readLine()) as RecoveryResponse).toEqual({ type: "Ok" });
    expect(JSON.parse(await readLine()) as RecoveryResponse).toEqual({ type: "Ok" });

    await running;

    const persisted = await store.read("task-2");
    expect(persisted).not.toBeNull();
    expect(persisted?.serialized).toContain("bye");
    expect(persisted?.sequence).toBe(9);
  });

  it("flushes snapshots on a debounce timer", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "kanna-terminal-recovery-"));
    const input = new PassThrough();
    const output = new PassThrough();
    const server = new RecoveryServer({
      input,
      output,
      snapshotStore: new SnapshotStore(rootDir),
      flushDebounceMs: 10,
    });
    const readLine = createLineReader(output);

    const running = server.start();

    input.write('{"type":"StartSession","sessionId":"task-3","cols":80,"rows":24}\n');
    input.write('{"type":"WriteOutput","sessionId":"task-3","data":[100,101,98,111,117,110,99,101],"sequence":4}\n');

    expect(JSON.parse(await readLine()) as RecoveryResponse).toEqual({ type: "Ok" });
    expect(JSON.parse(await readLine()) as RecoveryResponse).toEqual({ type: "Ok" });

    await Bun.sleep(30);

    const persisted = JSON.parse(await readFile(join(rootDir, "task-3.json"), "utf8")) as {
      serialized: string;
      sequence: number;
    };
    expect(persisted.serialized).toContain("debounce");
    expect(persisted.sequence).toBe(4);

    input.end();
    await running;
  });

  it("reads multiple json lines queued in a single output chunk", async () => {
    const output = new PassThrough();
    const readLine = createLineReader(output);

    output.write('{"type":"Ok"}\n{"type":"Ok"}\n{"type":"NotFound"}\n');

    expect(JSON.parse(await readLine()) as RecoveryResponse).toEqual({ type: "Ok" });
    expect(JSON.parse(await readLine()) as RecoveryResponse).toEqual({ type: "Ok" });
    expect(JSON.parse(await readLine()) as RecoveryResponse).toEqual({ type: "NotFound" });
  });

  it("persists the latest state when output arrives during an in-flight flush", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "kanna-terminal-recovery-"));
    const store = new ControlledSnapshotStore(rootDir);
    const server = new RecoveryServer({
      input: new PassThrough(),
      output: new PassThrough(),
      snapshotStore: store,
      flushDebounceMs: 60_000,
    });

    await server.handleCommand({ type: "StartSession", sessionId: "task-race", cols: 80, rows: 24 });
    await server.handleCommand({
      type: "WriteOutput",
      sessionId: "task-race",
      data: Array.from(Buffer.from("hello")),
      sequence: 1,
    });

    const flushPromise = (
      server as unknown as { flushSession(sessionId: string): Promise<void> }
    ).flushSession("task-race");
    await store.waitForFirstWriteStart();

    await server.handleCommand({
      type: "WriteOutput",
      sessionId: "task-race",
      data: Array.from(Buffer.from(" world")),
      sequence: 2,
    });

    store.allowFirstWriteToFinish();
    await flushPromise;

    const persisted = await store.read("task-race");
    expect(persisted).not.toBeNull();
    expect(persisted?.serialized).toContain("hello world");
    expect(persisted?.sequence).toBe(2);
  });

  it("rejects duplicate start-session requests without discarding the live mirror", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "kanna-terminal-recovery-"));
    const server = new RecoveryServer({
      input: new PassThrough(),
      output: new PassThrough(),
      snapshotStore: new SnapshotStore(rootDir),
      flushDebounceMs: 60_000,
    });

    expect(
      await server.handleCommand({ type: "StartSession", sessionId: "task-dup", cols: 80, rows: 24 }),
    ).toEqual({ type: "Ok" });
    await server.handleCommand({
      type: "WriteOutput",
      sessionId: "task-dup",
      data: Array.from(Buffer.from("keep me")),
      sequence: 3,
    });

    expect(
      await server.handleCommand({ type: "StartSession", sessionId: "task-dup", cols: 120, rows: 40 }),
    ).toEqual({
      type: "Error",
      message: "Session already exists: task-dup",
    });

    const snapshot = await server.handleCommand({ type: "GetSnapshot", sessionId: "task-dup" });
    expect(snapshot.type).toBe("Snapshot");
    if (snapshot.type !== "Snapshot") {
      throw new Error("expected snapshot response");
    }
    expect(snapshot.serialized).toContain("keep me");
    expect(snapshot.cols).toBe(80);
    expect(snapshot.rows).toBe(24);
    expect(snapshot.sequence).toBe(3);
  });
});
