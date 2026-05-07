import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertNotProductionDb, resetSqliteDb } from "../src/runtime/db";
import type { CommandRunner } from "../src/runtime/process";

describe("dev database safety", () => {
  it("refuses production database names and paths", () => {
    expect(() => assertNotProductionDb({ dbName: "kanna-v2.db", dbPath: "/tmp/dev.db" })).toThrow(
      "production database"
    );
    expect(() => assertNotProductionDb({ dbName: "dev.db", dbPath: "/Users/test/Library/Application Support/build.kanna/kanna-v2.db" })).toThrow(
      "production database"
    );
  });

  it("deletes sqlite sidecars and recreates an openable dev database before startup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kandev-db-"));
    const dbPath = join(dir, "dev.db");
    writeFileSync(dbPath, "old");
    writeFileSync(`${dbPath}-wal`, "wal");
    writeFileSync(`${dbPath}-shm`, "shm");
    const calls: string[] = [];
    const runner: CommandRunner = {
      async run(command, args) {
        calls.push(`${command} ${args.join(" ")}`);
        writeFileSync(dbPath, "");
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    };

    await resetSqliteDb(runner, { dbName: "dev.db", dbPath });

    expect(existsSync(dbPath)).toBe(true);
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    expect(existsSync(`${dbPath}-shm`)).toBe(false);
    expect(calls).toEqual([`sqlite3 ${dbPath} PRAGMA user_version;`]);
  });
});
