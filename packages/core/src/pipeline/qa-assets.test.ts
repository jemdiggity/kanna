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

  it("instructs the QA agent to request revision instead of changing the review branch", () => {
    const reviewAgent = readRepoFile(".kanna/agents/review/AGENT.md");
    const qaPipeline = readRepoFile(".kanna/pipelines/qa.json");

    expect(reviewAgent).toContain("You do not need to inspect the source task worktree");
    expect(reviewAgent).toContain("Do not make code, test, documentation, or configuration changes in the review worktree.");
    expect(reviewAgent).toContain("If the branch requires changes, request a revision back to the `in progress` stage.");
    expect(reviewAgent).toContain('--target-stage "in progress"');
    expect(reviewAgent).not.toContain("Make any fixes only in your current worktree");
    expect(qaPipeline).toContain("$BASE_REF");
    expect(qaPipeline).not.toContain("$SOURCE_WORKTREE");
  });

  it("keeps the PR agent agnostic to the development branch name", () => {
    const prAgent = readRepoFile(".kanna/agents/pr/AGENT.md");

    expect(prAgent).toContain("$BASE_REF");
    expect(prAgent).not.toContain("latest main");
    expect(prAgent).not.toContain("origin/main");
  });

  it("keeps the ship agent on the canonical kd workflow", () => {
    const shipAgent = readRepoFile(".kanna/tasks/ship/agent.md");

    expect(shipAgent).toContain("kd-mcp");
    expect(shipAgent).toContain("dev_up");
    expect(shipAgent).toContain("build_desktop");
    expect(shipAgent).toContain("build_sidecars");
    expect(shipAgent).toContain("release_ship");
    expect(shipAgent).toContain("./kd dev up");
    expect(shipAgent).toContain("./kd build desktop");
    expect(shipAgent).toContain("./kd build sidecars");
    expect(shipAgent).toContain("./kd release ship");
    expect(shipAgent).not.toMatch(/\bpnpm\s+(?:run|exec)\s+(?:dev|build|tauri|test:e2e)/);
    expect(shipAgent).not.toMatch(/\bcargo\s+tauri\b/);
    expect(shipAgent).not.toMatch(/\b(?:pnpm\s+exec\s+)?tauri\s+(?:dev|build)\b/);
  });
});
