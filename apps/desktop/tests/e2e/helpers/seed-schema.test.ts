import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("E2E seed schema", () => {
  it("defines repo sort_order for standalone seeded databases", async () => {
    const seedSql = await readFile(resolve("tests/e2e/seed.sql"), "utf8");

    expect(seedSql).toMatch(/CREATE TABLE IF NOT EXISTS repo \([\s\S]*sort_order INTEGER NOT NULL DEFAULT 0/);
    expect(seedSql).toMatch(/INSERT INTO repo \(id, path, name, default_branch, hidden, sort_order,/);
  });
});
