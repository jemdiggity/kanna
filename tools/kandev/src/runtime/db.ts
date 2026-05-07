import { mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { CommandRunner } from "./process";

export interface DevDbTarget {
  dbName: string;
  dbPath: string;
}

const productionDbName = "kanna-v2.db";

export function assertNotProductionDb(target: DevDbTarget): void {
  if (target.dbName === productionDbName || basename(target.dbPath) === productionDbName) {
    throw new Error(
      "REFUSED: kandev will not start, reset, or seed against the production database (kanna-v2.db). Run from a worktree or set KANNA_DB_NAME to a non-production name."
    );
  }
}

export function deleteSqliteDb(dbPath: string): void {
  mkdirSync(dirname(dbPath), { recursive: true });
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
}

export async function resetSqliteDb(runner: CommandRunner, target: DevDbTarget): Promise<void> {
  assertNotProductionDb(target);
  deleteSqliteDb(target.dbPath);
  const result = await runner.run("sqlite3", [target.dbPath, "PRAGMA user_version;"]);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to initialize ${target.dbPath}: ${result.stderr}`);
  }
}

export async function seedSqliteDb(runner: CommandRunner, repoRoot: string, dbPath: string): Promise<void> {
  const seedPath = join(repoRoot, "apps", "desktop", "tests", "e2e", "seed.sql");
  const result = await runner.run("sqlite3", [dbPath, `.read ${seedPath}`]);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to seed ${dbPath}: ${result.stderr}`);
  }
}
