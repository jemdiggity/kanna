import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SnapshotStore } from "./snapshotStore";

describe("SnapshotStore", () => {
  let rootDir: string | null = null;

  afterEach(async () => {
    if (rootDir) {
      await rm(rootDir, { force: true, recursive: true });
      rootDir = null;
    }
  });

  it("round-trips the latest snapshot with atomic replace semantics", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "kanna-terminal-recovery-"));
    const store = new SnapshotStore(rootDir);

    await store.write({
      sessionId: "task-1",
      serialized: "cached",
      cols: 80,
      rows: 24,
      savedAt: 1,
      sequence: 7,
    });

    await expect(store.read("task-1")).resolves.toMatchObject({
      sessionId: "task-1",
      sequence: 7,
      serialized: "cached",
    });
    await expect(Bun.file(join(rootDir, "task-1.json.tmp")).exists()).resolves.toBe(false);
  });

  it("returns null for missing or unreadable snapshots", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "kanna-terminal-recovery-"));
    const store = new SnapshotStore(rootDir);

    await expect(store.read("missing-session")).resolves.toBeNull();

    await writeFile(join(rootDir, "broken.json"), "{not-json", "utf8");

    await expect(store.read("broken")).resolves.toBeNull();
  });

  it("returns null for parseable but invalid snapshot payloads", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "kanna-terminal-recovery-"));
    const store = new SnapshotStore(rootDir);

    await writeFile(
      join(rootDir, "invalid.json"),
      JSON.stringify({
        sessionId: "invalid",
        serialized: 42,
        cols: "80",
        rows: 24,
        savedAt: 1,
        sequence: 7,
      }),
      "utf8",
    );

    await expect(store.read("invalid")).resolves.toBeNull();
  });
});
