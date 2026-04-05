import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RecoverySnapshot } from "./protocol";

function isRecoverySnapshot(value: unknown): value is RecoverySnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sessionId === "string" &&
    typeof candidate.serialized === "string" &&
    typeof candidate.cols === "number" &&
    Number.isFinite(candidate.cols) &&
    typeof candidate.rows === "number" &&
    Number.isFinite(candidate.rows) &&
    typeof candidate.savedAt === "number" &&
    Number.isFinite(candidate.savedAt) &&
    typeof candidate.sequence === "number" &&
    Number.isFinite(candidate.sequence)
  );
}

export class SnapshotStore {
  constructor(private readonly root: string) {}

  private filePath(sessionId: string): string {
    return join(this.root, `${sessionId}.json`);
  }

  async write(snapshot: RecoverySnapshot): Promise<void> {
    const filePath = this.filePath(snapshot.sessionId);
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(tempPath, JSON.stringify(snapshot), "utf8");
    await rename(tempPath, filePath);
  }

  async read(sessionId: string): Promise<RecoverySnapshot | null> {
    try {
      const contents = await readFile(this.filePath(sessionId), "utf8");
      const parsed: unknown = JSON.parse(contents);
      return isRecoverySnapshot(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async remove(sessionId: string): Promise<void> {
    await rm(this.filePath(sessionId), { force: true });
  }
}
