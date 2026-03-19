import { describe, it, expect, beforeEach } from "vitest";
import {
  listRepos,
  getRepo,
  insertRepo,
  deleteRepo,
  listPipelineItems,
  insertPipelineItem,
  updatePipelineItemStage,
  updatePipelineItemPR,
  getSetting,
  setSetting,
  type DbHandle,
} from "./queries.js";
import type { Repo, PipelineItem, Setting } from "./schema.js";

// ---------------------------------------------------------------------------
// In-memory DbHandle for testing
// ---------------------------------------------------------------------------

function createMockDb(): DbHandle & {
  tables: {
    repo: Repo[];
    pipeline_item: PipelineItem[];
    settings: Setting[];
  };
} {
  const tables = {
    repo: [] as Repo[],
    pipeline_item: [] as PipelineItem[],
    settings: [] as Setting[],
  };

  return {
    tables,
    async execute(query: string, bindValues?: unknown[]) {
      const q = query.trim().toUpperCase();

      if (q.startsWith("INSERT INTO REPO")) {
        const [id, path, name, default_branch] = bindValues as string[];
        tables.repo.push({
          id,
          path,
          name,
          default_branch,
          created_at: new Date().toISOString(),
          last_opened_at: new Date().toISOString(),
        });
      } else if (q.startsWith("DELETE FROM REPO")) {
        const [id] = bindValues as string[];
        tables.repo = tables.repo.filter((r) => r.id !== id);
      } else if (q.startsWith("INSERT INTO PIPELINE_ITEM")) {
        const [id, repo_id, issue_number, issue_title, prompt, stage, pr_number, pr_url, branch, agent_type] =
          bindValues as unknown[];
        tables.pipeline_item.push({
          id: id as string,
          repo_id: repo_id as string,
          issue_number: (issue_number as number | null),
          issue_title: (issue_title as string | null),
          prompt: (prompt as string | null),
          stage: stage as string,
          pr_number: (pr_number as number | null),
          pr_url: (pr_url as string | null),
          branch: (branch as string | null),
          agent_type: (agent_type as string | null),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      } else if (q.startsWith("UPDATE PIPELINE_ITEM SET STAGE")) {
        const [newStage, id] = bindValues as string[];
        const item = tables.pipeline_item.find((p) => p.id === id);
        if (item) {
          item.stage = newStage;
          item.updated_at = new Date().toISOString();
        }
      } else if (q.startsWith("UPDATE PIPELINE_ITEM SET PR_NUMBER")) {
        const [prNumber, prUrl, id] = bindValues as unknown[];
        const item = tables.pipeline_item.find((p) => p.id === id);
        if (item) {
          item.pr_number = prNumber as number;
          item.pr_url = prUrl as string;
          item.updated_at = new Date().toISOString();
        }
      } else if (q.startsWith("INSERT INTO SETTINGS")) {
        const [key, value] = bindValues as string[];
        const existing = tables.settings.find((s) => s.key === key);
        if (existing) {
          existing.value = value;
        } else {
          tables.settings.push({ key, value });
        }
      }

      return { rowsAffected: 1 };
    },
    async select<T>(query: string, bindValues?: unknown[]): Promise<T[]> {
      const q = query.trim().toUpperCase();

      if (q.startsWith("SELECT * FROM REPO WHERE ID")) {
        const [id] = bindValues as string[];
        return tables.repo.filter((r) => r.id === id) as unknown as T[];
      } else if (q.startsWith("SELECT * FROM REPO")) {
        return [...tables.repo].sort(
          (a, b) =>
            new Date(b.last_opened_at).getTime() -
            new Date(a.last_opened_at).getTime()
        ) as unknown as T[];
      } else if (q.startsWith("SELECT * FROM PIPELINE_ITEM WHERE REPO_ID")) {
        const [repoId] = bindValues as string[];
        return tables.pipeline_item.filter(
          (p) => p.repo_id === repoId
        ) as unknown as T[];
      } else if (q.startsWith("SELECT * FROM SETTINGS WHERE KEY")) {
        const [key] = bindValues as string[];
        return tables.settings.filter(
          (s) => s.key === key
        ) as unknown as T[];
      }

      return [] as T[];
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("repo queries", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("listRepos returns empty array initially", async () => {
    expect(await listRepos(db)).toEqual([]);
  });

  it("insertRepo and listRepos", async () => {
    await insertRepo(db, {
      id: "r1",
      path: "/home/user/project",
      name: "project",
      default_branch: "main",
    });
    const repos = await listRepos(db);
    expect(repos).toHaveLength(1);
    expect(repos[0].id).toBe("r1");
    expect(repos[0].name).toBe("project");
  });

  it("getRepo returns the correct repo", async () => {
    await insertRepo(db, {
      id: "r1",
      path: "/path",
      name: "foo",
      default_branch: "main",
    });
    const repo = await getRepo(db, "r1");
    expect(repo).not.toBeNull();
    expect(repo!.id).toBe("r1");
  });

  it("getRepo returns null for unknown id", async () => {
    const repo = await getRepo(db, "unknown");
    expect(repo).toBeNull();
  });

  it("deleteRepo removes the repo", async () => {
    await insertRepo(db, {
      id: "r1",
      path: "/path",
      name: "foo",
      default_branch: "main",
    });
    await deleteRepo(db, "r1");
    expect(await listRepos(db)).toHaveLength(0);
  });
});

describe("pipeline_item queries", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("listPipelineItems returns empty array initially", async () => {
    expect(await listPipelineItems(db, "r1")).toEqual([]);
  });

  it("insertPipelineItem and listPipelineItems", async () => {
    await insertPipelineItem(db, {
      id: "pi1",
      repo_id: "r1",
      issue_number: 42,
      issue_title: "Fix bug",
      prompt: null,
      stage: "queued",
      pr_number: null,
      pr_url: null,
      branch: null,
      agent_type: null,
    });
    const items = await listPipelineItems(db, "r1");
    expect(items).toHaveLength(1);
    expect(items[0].stage).toBe("queued");
  });

  it("updatePipelineItemStage updates the stage", async () => {
    await insertPipelineItem(db, {
      id: "pi1",
      repo_id: "r1",
      issue_number: null,
      issue_title: null,
      prompt: "do it",
      stage: "queued",
      pr_number: null,
      pr_url: null,
      branch: null,
      agent_type: null,
    });
    await updatePipelineItemStage(db, "pi1", "in_progress");
    const item = db.tables.pipeline_item.find((p) => p.id === "pi1");
    expect(item?.stage).toBe("in_progress");
  });

  it("updatePipelineItemPR sets pr_number and pr_url", async () => {
    await insertPipelineItem(db, {
      id: "pi1",
      repo_id: "r1",
      issue_number: null,
      issue_title: null,
      prompt: null,
      stage: "in_progress",
      pr_number: null,
      pr_url: null,
      branch: "feature/x",
      agent_type: null,
    });
    await updatePipelineItemPR(db, "pi1", 99, "https://github.com/o/r/pull/99");
    const item = db.tables.pipeline_item.find((p) => p.id === "pi1");
    expect(item?.pr_number).toBe(99);
    expect(item?.pr_url).toBe("https://github.com/o/r/pull/99");
  });
});

describe("settings queries", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("getSetting returns null for unknown key", async () => {
    expect(await getSetting(db, "unknown")).toBeNull();
  });

  it("setSetting and getSetting round-trip", async () => {
    await setSetting(db, "suspendAfterMinutes", "10");
    expect(await getSetting(db, "suspendAfterMinutes")).toBe("10");
  });

  it("setSetting overwrites an existing value", async () => {
    await setSetting(db, "ideCommand", "cursor");
    await setSetting(db, "ideCommand", "code");
    expect(await getSetting(db, "ideCommand")).toBe("code");
  });
});
