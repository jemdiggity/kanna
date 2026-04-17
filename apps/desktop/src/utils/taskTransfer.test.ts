import { describe, expect, it } from "vitest";
import type { OutgoingTransferPayload } from "./taskTransfer";
import { resolveIncomingTransferBaseBranch } from "./taskTransfer";

function buildPayload(overrides: Partial<OutgoingTransferPayload> = {}): OutgoingTransferPayload {
  const {
    task: taskOverrides,
    repo: repoOverrides,
    ...topLevelOverrides
  } = overrides;

  return {
    target_peer_id: "peer-target",
    task: {
      source_peer_id: "peer-source",
      source_task_id: "task-source",
      prompt: "Fix handoff",
      stage: "in progress",
      branch: "task-source",
      pipeline: "default",
      display_name: null,
      base_ref: "origin/main",
      agent_type: "pty",
      agent_provider: "claude",
      ...taskOverrides,
    },
    repo: {
      mode: "clone-remote",
      remote_url: "git@github.com:jemdiggity/kanna.git",
      path: null,
      name: "repo-1",
      default_branch: "main",
      bundle: null,
      ...repoOverrides,
    },
    recovery: null,
    ...topLevelOverrides,
  };
}

describe("resolveIncomingTransferBaseBranch", () => {
  it("uses the transferred base_ref for clone-remote imports", () => {
    const payload = buildPayload({
      repo: { mode: "clone-remote" },
    });

    expect(resolveIncomingTransferBaseBranch(payload)).toBe("origin/main");
  });

  it("uses the transferred base_ref for reuse-local imports", () => {
    const payload = buildPayload({
      repo: {
        mode: "reuse-local",
        path: "/tmp/repo-1",
      },
    });

    expect(resolveIncomingTransferBaseBranch(payload)).toBe("origin/main");
  });

  it("prefers the transferred task branch for bundle-backed imports", () => {
    const payload = buildPayload({
      repo: {
        mode: "bundle-repo",
        remote_url: null,
        bundle: {
          artifact_id: "artifact-1",
          filename: "transfer.bundle",
          ref_name: "refs/heads/task-source",
        },
      },
    });

    expect(resolveIncomingTransferBaseBranch(payload)).toBe("task-source");
  });

  it("falls back to base_ref when a bundle-backed import has no task branch", () => {
    const payload = buildPayload({
      task: {
        branch: null,
      },
      repo: {
        mode: "bundle-repo",
        remote_url: null,
        bundle: {
          artifact_id: "artifact-1",
          filename: "transfer.bundle",
          ref_name: "refs/heads/main",
        },
      },
    });

    expect(resolveIncomingTransferBaseBranch(payload)).toBe("origin/main");
  });
});
