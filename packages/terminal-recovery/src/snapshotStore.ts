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
      return await this.require(sessionId);
    } catch {
      return null;
    }
  }

  async require(sessionId: string): Promise<RecoverySnapshot> {
    try {
      const contents = await readFile(this.filePath(sessionId), "utf8");
      const parsed: unknown = JSON.parse(contents);
      if (!isRecoverySnapshot(parsed)) {
        throw new Error(`Invalid persisted snapshot for resumed session: ${sessionId}`);
      }
      return parsed;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        throw new Error(`Missing persisted snapshot for resumed session: ${sessionId}`);
      }

      if (error instanceof Error && error.message.startsWith("Invalid persisted snapshot")) {
        throw error;
      }

      throw new Error(`Invalid persisted snapshot for resumed session: ${sessionId}`);
    }
  }

  async remove(sessionId: string): Promise<void> {
    await rm(this.filePath(sessionId), { force: true });
  }
}
