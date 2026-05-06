import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("QA pipeline assets", () => {
  it("keeps the commit agent focused on committing work instead of task-session mechanics", () => {
    const commitAgent = readRepoFile(".kanna/agents/commit/AGENT.md");

    expect(commitAgent).toContain("Your job is to commit the relevant changes before PR creation");
    expect(commitAgent).not.toContain("same Kanna task session");
  });

  it("instructs the QA agent to keep changes in its own worktree", () => {
    const reviewAgent = readRepoFile(".kanna/agents/review/AGENT.md");
    const qaPipeline = readRepoFile(".kanna/pipelines/qa.json");

    expect(reviewAgent).toContain("You do not need to inspect the source task worktree");
    expect(reviewAgent).toContain("Make any fixes only in your current worktree");
    expect(qaPipeline).toContain("$BASE_REF");
    expect(qaPipeline).not.toContain("$SOURCE_WORKTREE");
  });
});
