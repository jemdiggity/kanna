import { afterEach, describe, expect, it, spyOn } from "bun:test";

globalThis.window ??= globalThis;

const { SessionMirror } = await import("./sessionMirror");

describe("SessionMirror", () => {
  afterEach(() => {
    spyOn(Date, "now").mockRestore();
  });

  it("serializes headless xterm state after writes", async () => {
    const dateSpy = spyOn(Date, "now").mockReturnValue(1_701_000_000_000);
    const mirror = new SessionMirror({ sessionId: "task-1", cols: 80, rows: 24 });

    await mirror.write(new Uint8Array(Buffer.from("\u001b[2Jhello\r\nworld")), 7);

    const snapshot = mirror.snapshot();

    expect(snapshot).toMatchObject({
      sessionId: "task-1",
      cols: 80,
      rows: 24,
      savedAt: 1_701_000_000_000,
      sequence: 7,
    });
    expect(snapshot.serialized).toContain("hello");
    expect(snapshot.serialized).toContain("world");

    dateSpy.mockRestore();
  });

  it("tracks the latest geometry and sequence across resizes", async () => {
    const mirror = new SessionMirror({ sessionId: "task-2", cols: 80, rows: 24 });

    mirror.resize(100, 30);
    await mirror.write(new Uint8Array(Buffer.from("resized")), 11);

    const snapshot = mirror.snapshot();

    expect(snapshot.cols).toBe(100);
    expect(snapshot.rows).toBe(30);
    expect(snapshot.sequence).toBe(11);
  });

  it("preserves split multibyte utf-8 sequences across writes", async () => {
    const mirror = new SessionMirror({ sessionId: "task-3", cols: 80, rows: 24 });
    const bytes = new Uint8Array(Buffer.from("あ"));

    await mirror.write(bytes.slice(0, 1), 1);
    await mirror.write(bytes.slice(1), 2);

    const snapshot = mirror.snapshot();

    expect(snapshot.serialized).toContain("あ");
    expect(snapshot.serialized).not.toContain("�");
    expect(snapshot.sequence).toBe(2);
  });

  it("restores a serialized snapshot into a fresh mirror", async () => {
    const original = new SessionMirror({ sessionId: "task-4", cols: 80, rows: 24 });
    await original.write(new Uint8Array(Buffer.from("\u001b[2Jhello\r\nworld")), 4);
    const snapshot = original.snapshot();

    const restored = new SessionMirror({ sessionId: "task-4", cols: 80, rows: 24 });
    await restored.restore(snapshot);

    const restoredSnapshot = restored.snapshot();
    expect(restoredSnapshot.serialized).toContain("hello");
    expect(restoredSnapshot.serialized).toContain("world");
    expect(restoredSnapshot.sequence).toBe(4);
  });
});
