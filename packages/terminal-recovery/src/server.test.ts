import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RecoveryResponse } from "./protocol";
import { SnapshotStore } from "./snapshotStore";
import { RecoveryServer } from "./server";

globalThis.window ??= globalThis;

function waitForLine(stream: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString("utf8");
      const newlineIndex = text.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }
      stream.off("data", onData);
      resolve(text.slice(0, newlineIndex));
    };

    stream.on("data", onData);
  });
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

    const running = server.start();

    input.write('{"type":"StartSession","sessionId":"task-1","cols":80,"rows":24}\n');
    input.write('{"type":"WriteOutput","sessionId":"task-1","data":[104,101,108,108,111],"sequence":5}\n');
    input.write('{"type":"GetSnapshot","sessionId":"task-1"}\n');

    expect(JSON.parse(await waitForLine(output)) as RecoveryResponse).toEqual({ type: "Ok" });
    expect(JSON.parse(await waitForLine(output)) as RecoveryResponse).toEqual({ type: "Ok" });

    const snapshot = JSON.parse(await waitForLine(output)) as RecoveryResponse;
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

    const running = server.start();

    input.write('{"type":"StartSession","sessionId":"task-2","cols":80,"rows":24}\n');
    input.write('{"type":"WriteOutput","sessionId":"task-2","data":[98,121,101],"sequence":9}\n');
    input.write('{"type":"FlushAndShutdown"}\n');

    expect(JSON.parse(await waitForLine(output)) as RecoveryResponse).toEqual({ type: "Ok" });
    expect(JSON.parse(await waitForLine(output)) as RecoveryResponse).toEqual({ type: "Ok" });
    expect(JSON.parse(await waitForLine(output)) as RecoveryResponse).toEqual({ type: "Ok" });

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

    const running = server.start();

    input.write('{"type":"StartSession","sessionId":"task-3","cols":80,"rows":24}\n');
    input.write('{"type":"WriteOutput","sessionId":"task-3","data":[100,101,98,111,117,110,99,101],"sequence":4}\n');

    expect(JSON.parse(await waitForLine(output)) as RecoveryResponse).toEqual({ type: "Ok" });
    expect(JSON.parse(await waitForLine(output)) as RecoveryResponse).toEqual({ type: "Ok" });

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
});
