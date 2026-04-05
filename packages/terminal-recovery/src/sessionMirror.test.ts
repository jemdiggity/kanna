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
});
