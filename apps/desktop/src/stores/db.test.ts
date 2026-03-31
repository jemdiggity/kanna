import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "@kanna/db";

interface PipelineItemRow {
  stage: string;
  tags: string;
  closed_at: string | null;
}

function createMigrationDb(initialRows: PipelineItemRow[]): DbHandle & {
  pipelineItems: PipelineItemRow[];
} {
  const pipelineItems = initialRows.map((row) => ({ ...row }));

  return {
    pipelineItems,
    async execute(query: string): Promise<{ rowsAffected: number }> {
      const sql = query.replace(/\s+/g, " ").trim();

      if (sql === `UPDATE pipeline_item SET stage = 'in_progress' WHERE stage = 'queued'`) {
        for (const item of pipelineItems) {
          if (item.stage === "queued") item.stage = "in_progress";
        }
      } else if (sql === `UPDATE pipeline_item SET stage = 'done' WHERE stage IN ('needs_review', 'merged', 'closed')`) {
        for (const item of pipelineItems) {
          if (["needs_review", "merged", "closed"].includes(item.stage)) item.stage = "done";
        }
      } else if (sql === `UPDATE pipeline_item SET stage = 'in progress' WHERE tags LIKE '%"in progress"%' AND closed_at IS NULL AND stage IN ('in_progress', 'legacy')`) {
        for (const item of pipelineItems) {
          if (item.closed_at === null && item.tags.includes(`"in progress"`) && ["in_progress", "legacy"].includes(item.stage)) item.stage = "in progress";
        }
      } else if (sql === `UPDATE pipeline_item SET stage = 'pr' WHERE tags LIKE '%"pr"%' AND closed_at IS NULL AND stage IN ('in_progress', 'legacy')`) {
        for (const item of pipelineItems) {
          if (item.closed_at === null && item.tags.includes(`"pr"`) && ["in_progress", "legacy"].includes(item.stage)) item.stage = "pr";
        }
      } else if (sql === `UPDATE pipeline_item SET stage = 'merge' WHERE tags LIKE '%"merge"%' AND closed_at IS NULL AND stage IN ('in_progress', 'legacy')`) {
        for (const item of pipelineItems) {
          if (item.closed_at === null && item.tags.includes(`"merge"`) && ["in_progress", "legacy"].includes(item.stage)) item.stage = "merge";
        }
      } else if (sql === `UPDATE pipeline_item SET stage = 'in progress' WHERE stage = 'in_progress'`) {
        for (const item of pipelineItems) {
          if (item.stage === "in_progress") item.stage = "in progress";
        }
      } else if (sql === `UPDATE pipeline_item SET stage = 'in progress' WHERE stage = 'legacy'`) {
        for (const item of pipelineItems) {
          if (item.stage === "legacy") item.stage = "in progress";
        }
      }

      return { rowsAffected: 1 };
    },
    async select<T>(): Promise<T[]> {
      return [];
    },
  };
}

describe("runMigrations stage migration", () => {
  let runMigrations: typeof import("./db")["runMigrations"];
  let db: ReturnType<typeof createMigrationDb>;

  beforeAll(async () => {
    Object.assign(globalThis, { window: {} });
    ({ runMigrations } = await import("./db"));
  });

  beforeEach(() => {
    db = createMigrationDb([]);
  });

  it("does not overwrite a canonical pr stage from stale legacy tags", async () => {
    db = createMigrationDb([
      { stage: "pr", tags: `["in progress"]`, closed_at: null },
    ]);

    await runMigrations(db);

    expect(db.pipelineItems[0]?.stage).toBe("pr");
  });

  it("still migrates genuinely legacy rows from tags", async () => {
    db = createMigrationDb([
      { stage: "in_progress", tags: `["pr"]`, closed_at: null },
      { stage: "legacy", tags: `["merge"]`, closed_at: null },
    ]);

    await runMigrations(db);

    expect(db.pipelineItems[0]?.stage).toBe("pr");
    expect(db.pipelineItems[1]?.stage).toBe("merge");
  });
});
