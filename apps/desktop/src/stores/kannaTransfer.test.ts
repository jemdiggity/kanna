import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { DbHandle, PipelineItem, Repo } from "@kanna/db";
import {
  buildOutgoingTransferPayload,
  chooseRepoAcquisitionMode,
  parseIncomingTransferRequest,
  parseOutgoingTransferPreflightResult,
} from "../utils/taskTransfer";
import type { SessionRecoveryState } from "../composables/sessionRecoveryState";

const invokeMock = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>();
const loadSessionRecoveryStateMock = vi.fn<(sessionId: string) => Promise<SessionRecoveryState | null>>();

vi.mock("../invoke", () => ({
  invoke: invokeMock,
}));

vi.mock("../composables/sessionRecoveryState", () => ({
  loadSessionRecoveryState: loadSessionRecoveryStateMock,
}));

vi.mock("../tauri-mock", () => ({
  isTauri: false,
}));

vi.mock("../listen", () => ({
  listen: vi.fn(async () => () => undefined),
}));

vi.mock("../composables/useToast", () => ({
  useToast: () => ({
    toasts: { value: [] },
    dismiss: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  }),
}));

function buildRepo(): Repo {
  return {
    id: "repo-1",
    path: "/tmp/repo-1",
    name: "repo-1",
    default_branch: "main",
    hidden: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    last_opened_at: "2026-01-01T00:00:00.000Z",
  };
}

function buildItem(repoId = "repo-1"): PipelineItem {
  return {
    id: "task-source",
    repo_id: repoId,
    issue_number: null,
    issue_title: null,
    prompt: "Fix handoff",
    pipeline: "default",
    stage: "in progress",
    stage_result: null,
    tags: "[]",
    pr_number: null,
    pr_url: null,
    branch: "task-task-source",
    closed_at: null,
    agent_type: "pty",
    agent_provider: "claude",
    activity: "idle",
    activity_changed_at: null,
    unread_at: null,
    port_offset: null,
    display_name: null,
    port_env: null,
    pinned: 0,
    pin_order: null,
    base_ref: "main",
    agent_session_id: null,
    previous_stage: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function buildIncomingTransferPayload() {
  return {
    target_peer_id: "peer-target",
    task: {
      source_peer_id: "peer-source",
      source_task_id: "task-source",
      resume_session_id: null,
      prompt: "Fix handoff",
      stage: "in progress",
      branch: "task-source",
      pipeline: "default",
      display_name: "Transferred task",
      base_ref: "main",
      agent_type: "sdk",
      agent_provider: "claude" as const,
    },
    repo: {
      mode: "reuse-local" as const,
      remote_url: "git@github.com:jemdiggity/kanna.git",
      path: "/tmp/repo-1",
      name: "repo-1",
      default_branch: "main",
      bundle: null,
    },
    recovery: null,
  };
}

function createTransferDb(initial: {
  repos?: Repo[];
  items?: PipelineItem[];
  transfers?: Array<Record<string, unknown>>;
}) {
  const tables = {
    repo: [...(initial.repos ?? [])],
    pipeline_item: [...(initial.items ?? [])],
    task_transfer: [...(initial.transfers ?? [])],
    task_transfer_provenance: [] as Array<Record<string, unknown>>,
  };

  const db = {
    tables,
    execute: vi.fn(async (sql: string, params?: unknown[]) => {
      const q = sql.trim().toUpperCase();

      if (q.startsWith("INSERT INTO REPO")) {
        const [id, path, name, defaultBranch] = params as [string, string, string, string];
        tables.repo.push({
          id,
          path,
          name,
          default_branch: defaultBranch,
          hidden: 0,
          created_at: new Date().toISOString(),
          last_opened_at: new Date().toISOString(),
        });
        return { rowsAffected: 1 };
      }

      if (q.startsWith("INSERT INTO PIPELINE_ITEM")) {
        const [
          id,
          repoId,
          issueNumber,
          issueTitle,
          prompt,
          pipeline,
          stage,
          tagsJson,
          prNumber,
          prUrl,
          branch,
          agentType,
          agentProvider,
          portOffset,
          portEnv,
          activity,
          displayName,
          baseRef,
        ] = params as unknown[];
        tables.pipeline_item.push({
          id: id as string,
          repo_id: repoId as string,
          issue_number: issueNumber as number | null,
          issue_title: issueTitle as string | null,
          prompt: prompt as string | null,
          pipeline: pipeline as string,
          stage: stage as string,
          stage_result: null,
          tags: tagsJson as string,
          pr_number: prNumber as number | null,
          pr_url: prUrl as string | null,
          branch: branch as string | null,
          closed_at: null,
          agent_type: agentType as string | null,
          agent_provider: agentProvider as PipelineItem["agent_provider"],
          activity: activity as PipelineItem["activity"],
          activity_changed_at: new Date().toISOString(),
          unread_at: null,
          port_offset: portOffset as number | null,
          display_name: displayName as string | null,
          port_env: portEnv as string | null,
          pinned: 0,
          pin_order: null,
          base_ref: baseRef as string | null,
          agent_session_id: null,
          previous_stage: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        return { rowsAffected: 1 };
      }

      if (q.startsWith("UPDATE PIPELINE_ITEM SET PORT_OFFSET")) {
        const [portOffset, portEnv, id] = params as [number | null, string | null, string];
        const row = tables.pipeline_item.find((item) => item.id === id);
        if (row) {
          row.port_offset = portOffset;
          row.port_env = portEnv;
        }
        return { rowsAffected: row ? 1 : 0 };
      }

      if (q.startsWith("UPDATE PIPELINE_ITEM SET ACTIVITY")) {
        const [activity, id] = params as [PipelineItem["activity"], string];
        const row = tables.pipeline_item.find((item) => item.id === id);
        if (row) {
          row.activity = activity;
        }
        return { rowsAffected: row ? 1 : 0 };
      }

      if (q.startsWith("UPDATE PIPELINE_ITEM SET")) {
        const id = params?.[params.length - 1] as string | undefined;
        const row = tables.pipeline_item.find((item) => item.id === id);
        if (!row) {
          return { rowsAffected: 0 };
        }

      if (q.startsWith("UPDATE PIPELINE_ITEM SET STAGE = ?")) {
          const [stage] = params as [string, string];
          row.stage = stage;
        }

        if (q.startsWith("UPDATE PIPELINE_ITEM SET AGENT_SESSION_ID = ?")) {
          const [agentSessionId] = params as [string, string];
          row.agent_session_id = agentSessionId;
        }

        if (q.includes("STAGE = 'DONE'")) {
          row.previous_stage = row.stage;
          row.stage = "done";
          row.closed_at = new Date().toISOString();
        }

        return { rowsAffected: 1 };
      }

      if (q.startsWith("INSERT INTO TASK_TRANSFER_PROVENANCE")) {
        const [pipelineItemId, sourcePeerId, sourceTaskId, sourceMachineTaskLabel] =
          params as [string, string, string, string | null];
        tables.task_transfer_provenance.push({
          pipeline_item_id: pipelineItemId,
          source_peer_id: sourcePeerId,
          source_task_id: sourceTaskId,
          source_machine_task_label: sourceMachineTaskLabel,
        });
        return { rowsAffected: 1 };
      }

      if (q.startsWith("UPDATE TASK_TRANSFER SET STATUS = 'COMPLETED'")) {
        const [localTaskId, transferId] = params as [string, string];
        const row = tables.task_transfer.find((transfer) => transfer.id === transferId);
        if (row) {
          row.status = "completed";
          row.local_task_id = localTaskId;
          row.completed_at = new Date().toISOString();
          row.error = null;
        }
        return { rowsAffected: row ? 1 : 0 };
      }

      if (q.startsWith("UPDATE TASK_TRANSFER SET STATUS = 'REJECTED'")) {
        const [error, transferId] = params as [string, string];
        const row = tables.task_transfer.find((transfer) => transfer.id === transferId);
        if (row) {
          row.status = "rejected";
          row.completed_at = new Date().toISOString();
          row.error = error;
        }
        return { rowsAffected: row ? 1 : 0 };
      }

      if (q.startsWith("INSERT INTO TASK_TRANSFER")) {
        const [
          id,
          direction,
          status,
          sourcePeerId,
          targetPeerId,
          sourceTaskId,
          localTaskId,
          error,
          payloadJson,
        ] = params as [
          string,
          string,
          string,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
        ];
        tables.task_transfer.push({
          id,
          direction,
          status,
          source_peer_id: sourcePeerId,
          target_peer_id: targetPeerId,
          source_task_id: sourceTaskId,
          local_task_id: localTaskId,
          started_at: new Date().toISOString(),
          completed_at: null,
          error,
          payload_json: payloadJson,
        });
        return { rowsAffected: 1 };
      }

      return { rowsAffected: 0 };
    }),
    select: vi.fn(async (sql: string, params?: unknown[]) => {
      const q = sql.trim().toUpperCase();

      if (q.includes("FROM REPO WHERE PATH = ?")) {
        const [path] = params as [string];
        return tables.repo.filter((repo) => repo.path === path);
      }

      if (q.includes("FROM REPO")) {
        return tables.repo;
      }

      if (q.includes("FROM PIPELINE_ITEM")) {
        return tables.pipeline_item;
      }

      if (q.includes("FROM TASK_TRANSFER WHERE ID = ?")) {
        const [transferId] = params as [string];
        return tables.task_transfer.filter((transfer) => transfer.id === transferId);
      }

      if (q.includes("FROM TASK_TRANSFER_PROVENANCE")) {
        return tables.task_transfer_provenance;
      }

      if (q.includes("FROM TASK_PORT")) {
        return [];
      }

      if (q.includes("FROM SETTINGS")) {
        return [];
      }

      return [];
    }),
  } as unknown as DbHandle & typeof db;

  return db;
}

describe("chooseRepoAcquisitionMode", () => {
  it("returns reuse-local when the target already has the repository", () => {
    expect(
      chooseRepoAcquisitionMode({
        remoteUrl: "git@github.com:jemdiggity/kanna.git",
        targetHasRepo: true,
        bundle: null,
      }),
    ).toBe("reuse-local");
  });

  it("prefers clone-remote when a remote URL exists and target has no repo", () => {
    expect(
      chooseRepoAcquisitionMode({
        remoteUrl: "git@github.com:jemdiggity/kanna.git",
        targetHasRepo: false,
        bundle: null,
      }),
    ).toBe("clone-remote");
  });

  it("falls back to bundle-repo when no remote URL exists", () => {
    expect(
      chooseRepoAcquisitionMode({
        remoteUrl: null,
        targetHasRepo: false,
        bundle: {
          artifactId: "artifact-1",
          filename: "transfer-1.bundle",
          refName: "refs/heads/task-source",
        },
      }),
    ).toBe("bundle-repo");
  });
});

describe("buildOutgoingTransferPayload", () => {
  it("preserves source provenance and does not allocate destination ids", () => {
    const payload = buildOutgoingTransferPayload({
      sourcePeerId: "peer-alpha",
      sourceTaskId: "task-source",
      targetPeerId: "peer-target",
      item: buildItem(),
      repoRemoteUrl: "git@github.com:jemdiggity/kanna.git",
      recovery: {
        serialized: "prompt> ",
        cols: 80,
        rows: 24,
        cursorRow: 0,
        cursorCol: 8,
        cursorVisible: true,
        savedAt: 0,
        sequence: 1,
      },
      targetHasRepo: false,
      bundle: null,
    });

    expect(payload.task.source_peer_id).toBe("peer-alpha");
    expect(payload.task.source_task_id).toBe("task-source");
    expect(payload.task.local_task_id).toBeUndefined();
    expect(payload.repo.mode).toBe("clone-remote");
    expect(payload.repo.bundle).toBeNull();
  });

  it("builds bundle-repo payloads with staged bundle metadata", () => {
    const payload = buildOutgoingTransferPayload({
      sourcePeerId: "peer-alpha",
      sourceTaskId: "task-source",
      targetPeerId: "peer-target",
      item: buildItem(),
      repoPath: "/tmp/repo-1",
      repoName: "repo-1",
      repoDefaultBranch: "main",
      repoRemoteUrl: null,
      recovery: null,
      targetHasRepo: false,
      bundle: {
        artifactId: "artifact-1",
        filename: "transfer-1.bundle",
        refName: "refs/heads/task-source",
      },
    });

    expect(payload.repo).toMatchObject({
      mode: "bundle-repo",
      remote_url: null,
      path: "/tmp/repo-1",
      name: "repo-1",
      default_branch: "main",
      bundle: {
        artifact_id: "artifact-1",
        filename: "transfer-1.bundle",
        ref_name: "refs/heads/task-source",
      },
    });
  });
});

describe("parseOutgoingTransferPreflightResult", () => {
  it("requires transferId in the preflight response", () => {
    expect(() =>
      parseOutgoingTransferPreflightResult({
        sourcePeerId: "peer-source",
        targetHasRepo: false,
      }),
    ).toThrow("transferId");
  });

  it("accepts the browser mock preflight payload", async () => {
    const { mockInvoke } = await vi.importActual<typeof import("../tauri-mock")>("../tauri-mock");

    expect(
      parseOutgoingTransferPreflightResult(
        mockInvoke("prepare_outgoing_transfer", {
          payload: {
            phase: "preflight",
          },
        }),
      ),
    ).toMatchObject({
      transferId: "mock-transfer-1",
      sourcePeerId: "mock-local-peer",
      targetHasRepo: false,
    });
  });
});

describe("parseIncomingTransferRequest", () => {
  it("requires the incoming transfer payload", () => {
    expect(() =>
      parseIncomingTransferRequest({
        type: "incoming_transfer_request",
        transfer_id: "transfer-1",
        source_peer_id: "peer-source",
        source_task_id: "task-source",
        source_name: "Primary",
      }),
    ).toThrow("payload");
  });
});

describe("pushTaskToPeer", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    loadSessionRecoveryStateMock.mockReset();
  });

  it("stays safe when transfer preflight fails", async () => {
    setActivePinia(createPinia());
    const { useKannaStore } = await import("./kanna");
    const store = useKannaStore();

    store.repos = [buildRepo()];
    store.items = [buildItem()];

    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "prepare_outgoing_transfer") {
        throw new Error("kanna-task-transfer sidecar integration is not implemented yet");
      }
      return null;
    });

    await expect(store.pushTaskToPeer("task-source", "peer-target")).rejects.toThrow(
      "not implemented",
    );

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("prepare_outgoing_transfer", {
      payload: {
        phase: "preflight",
        sourceTaskId: "task-source",
        targetPeerId: "peer-target",
      },
    });
    expect(loadSessionRecoveryStateMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith("git_remote_url", expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith("kill_session", expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith("signal_session", expect.anything());
  });

  it("uses preflight sourcePeerId and targetHasRepo to build the final payload", async () => {
    setActivePinia(createPinia());
    const { useKannaStore } = await import("./kanna");
    const store = useKannaStore();
    const fakeDb = createTransferDb({});

    await store.init(fakeDb);
    store.repos = [buildRepo()];
    store.items = [buildItem()];

    loadSessionRecoveryStateMock.mockResolvedValue({
      serialized: "prompt> ",
      cols: 80,
      rows: 24,
      cursorRow: 0,
      cursorCol: 8,
      cursorVisible: true,
      savedAt: 123,
      sequence: 4,
    });

    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "prepare_outgoing_transfer") {
        const payload = args?.payload as Record<string, unknown> | undefined;
        if (payload?.phase === "preflight") {
          return {
            transferId: "transfer-123",
            sourcePeerId: "peer-real-source",
            targetHasRepo: true,
          };
        }
        return { ok: true };
      }
      if (cmd === "git_remote_url") {
        return "git@github.com:jemdiggity/kanna.git";
      }
      return null;
    });

    await expect(store.pushTaskToPeer("task-source", "peer-target")).resolves.toBeUndefined();

    const prepareCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "prepare_outgoing_transfer");
    expect(prepareCalls).toHaveLength(2);
    expect(prepareCalls[0]?.[1]).toEqual({
      payload: {
        phase: "preflight",
        sourceTaskId: "task-source",
        targetPeerId: "peer-target",
      },
    });
    expect(prepareCalls[1]?.[1]).toMatchObject({
      payload: {
        phase: "commit",
        transferId: "transfer-123",
        payload: {
          target_peer_id: "peer-target",
          task: {
            source_peer_id: "peer-real-source",
            source_task_id: "task-source",
            resume_session_id: null,
          },
          repo: {
            mode: "reuse-local",
          },
        },
      },
    });
    expect(invokeMock).not.toHaveBeenCalledWith("git_remote_url", expect.anything());
  });

  it("records an outgoing transfer row after commit starts", async () => {
    setActivePinia(createPinia());
    const { useKannaStore } = await import("./kanna");
    const store = useKannaStore();
    const fakeDb = createTransferDb({});

    await store.init(fakeDb);
    store.repos = [buildRepo()];
    store.items = [buildItem()];

    loadSessionRecoveryStateMock.mockResolvedValue(null);

    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "prepare_outgoing_transfer") {
        return {
          transferId: "transfer-123",
          sourcePeerId: "peer-real-source",
          targetHasRepo: false,
        };
      }
      return null;
    });

    await expect(store.pushTaskToPeer("task-source", "peer-target")).resolves.toBeUndefined();

    expect(fakeDb.tables.task_transfer[0]).toMatchObject({
      id: "transfer-123",
      direction: "outgoing",
      status: "pending",
      source_peer_id: "peer-real-source",
      target_peer_id: "peer-target",
      source_task_id: "task-source",
      local_task_id: "task-source",
      payload_json: expect.any(String),
    });
  });

  it("includes the source resume session id in the outgoing payload", async () => {
    setActivePinia(createPinia());
    const { useKannaStore } = await import("./kanna");
    const store = useKannaStore();
    const fakeDb = createTransferDb({});

    await store.init(fakeDb);
    store.repos = [buildRepo()];
    store.items = [buildItem()];
    store.items[0]!.agent_provider = "codex";
    store.items[0]!.agent_session_id = "019d9a8c-9f39-7240-818f-88367a7c31df";

    loadSessionRecoveryStateMock.mockResolvedValue(null);

    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "prepare_outgoing_transfer") {
        const payload = args?.payload as Record<string, unknown> | undefined;
        if (payload?.phase === "preflight") {
          return {
            transferId: "transfer-123",
            sourcePeerId: "peer-real-source",
            targetHasRepo: true,
          };
        }
        return { ok: true };
      }
      return null;
    });

    await expect(store.pushTaskToPeer("task-source", "peer-target")).resolves.toBeUndefined();

    const prepareCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "prepare_outgoing_transfer");
    expect(prepareCalls[1]?.[1]).toMatchObject({
      payload: {
        phase: "commit",
        transferId: "transfer-123",
        payload: {
          task: {
            resume_session_id: "019d9a8c-9f39-7240-818f-88367a7c31df",
          },
        },
      },
    });
  });

  it("stages a git bundle before committing bundle-repo transfers", async () => {
    setActivePinia(createPinia());
    const { useKannaStore } = await import("./kanna");
    const store = useKannaStore();
    const fakeDb = createTransferDb({});

    await store.init(fakeDb);
    store.repos = [buildRepo()];
    store.items = [buildItem()];

    loadSessionRecoveryStateMock.mockResolvedValue(null);

    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "prepare_outgoing_transfer") {
        const payload = args?.payload as Record<string, unknown> | undefined;
        if (payload?.phase === "preflight") {
          return {
            transferId: "transfer-123",
            sourcePeerId: "peer-real-source",
            targetHasRepo: false,
          };
        }
        return { ok: true };
      }
      if (cmd === "git_remote_url") {
        return null;
      }
      if (cmd === "run_script") {
        return "";
      }
      if (cmd === "stage_transfer_artifact") {
        return {
          transferId: "transfer-123",
          artifactId: "artifact-123",
        };
      }
      return null;
    });

    await expect(store.pushTaskToPeer("task-source", "peer-target")).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledWith("run_script", {
      script: expect.stringContaining("git bundle create"),
      cwd: "/tmp/repo-1",
      env: expect.objectContaining({
        KANNA_WORKTREE: "1",
      }),
    });
    expect(invokeMock).toHaveBeenCalledWith("stage_transfer_artifact", {
      transferId: "transfer-123",
      artifactId: expect.any(String),
      path: expect.stringContaining(".bundle"),
    });

    const prepareCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "prepare_outgoing_transfer");
    expect(prepareCalls[1]?.[1]).toEqual({
      payload: {
        phase: "commit",
        transferId: "transfer-123",
        payload: expect.objectContaining({
          repo: expect.objectContaining({
            mode: "bundle-repo",
            bundle: {
              artifact_id: expect.any(String),
              filename: expect.stringContaining(".bundle"),
              ref_name: "refs/heads/task-task-source",
            },
          }),
        }),
      },
    });
  });
});

describe("recordIncomingTransfer", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    loadSessionRecoveryStateMock.mockReset();
  });

  it("records a pending incoming transfer from the transfer-request event", async () => {
    setActivePinia(createPinia());
    const { useKannaStore } = await import("./kanna");
    const store = useKannaStore();
    const insertedTransfers: Array<Record<string, unknown>> = [];
    const fakeDb = {
      execute: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("INSERT INTO task_transfer")) {
          insertedTransfers.push({
            id: params?.[0],
            direction: params?.[1],
            status: params?.[2],
            source_peer_id: params?.[3],
            target_peer_id: params?.[4],
            source_task_id: params?.[5],
            local_task_id: params?.[6],
            error: params?.[7],
            payload_json: params?.[8],
          });
        }
        return { rowsAffected: 1 };
      }),
      select: vi.fn(async (sql: string) => {
        if (sql.includes("FROM task_transfer")) {
          return insertedTransfers;
        }
        return [];
      }),
    } as unknown as DbHandle;

    await store.init(fakeDb);

    const request = parseIncomingTransferRequest({
      type: "incoming_transfer_request",
      transfer_id: "transfer-1",
      source_peer_id: "peer-source",
      source_task_id: "task-source",
      source_name: "Primary",
      payload: {
        task: {
          source_task_id: "task-source",
          source_peer_id: "peer-source",
          prompt: "Fix handoff",
          stage: "in progress",
          branch: "task-source",
          pipeline: "default",
          display_name: null,
          base_ref: "main",
          agent_type: "sdk",
          agent_provider: "claude",
        },
        repo: {
          mode: "reuse-local",
          remote_url: "git@github.com:jemdiggity/kanna.git",
          path: "/tmp/repo-1",
          name: "repo-1",
          default_branch: "main",
        },
        recovery: null,
        target_peer_id: "peer-target",
      },
    });

    await store.recordIncomingTransfer(request);

    const rows = await fakeDb.select<Record<string, unknown>>(
      "SELECT id, direction, status, source_peer_id, source_task_id FROM task_transfer",
    );
    expect(rows[0]).toMatchObject({
      id: "transfer-1",
      direction: "incoming",
      status: "pending",
      source_peer_id: "peer-source",
      source_task_id: "task-source",
      payload_json: expect.any(String),
    });
  });

  it("ignores duplicate transfer ids so later windows still proceed", async () => {
    setActivePinia(createPinia());
    const { useKannaStore } = await import("./kanna");
    const store = useKannaStore();
    const insertedTransfers = new Set<string>();
    const fakeDb = {
      execute: vi.fn(async (_sql: string, params?: unknown[]) => {
        const transferId = typeof params?.[0] === "string" ? params[0] : "";
        if (insertedTransfers.has(transferId)) {
          throw new Error("UNIQUE constraint failed: task_transfer.id");
        }
        insertedTransfers.add(transferId);
        return { rowsAffected: 1 };
      }),
      select: vi.fn(async () => []),
    } as unknown as DbHandle;

    await store.init(fakeDb);

    const request = parseIncomingTransferRequest({
      type: "incoming_transfer_request",
      transfer_id: "transfer-1",
      source_peer_id: "peer-source",
      source_task_id: "task-source",
      source_name: "Primary",
      payload: {
        task: {
          source_task_id: "task-source",
          source_peer_id: "peer-source",
          prompt: "Fix handoff",
          stage: "in progress",
          branch: "task-source",
          pipeline: "default",
          display_name: null,
          base_ref: "main",
          agent_type: "sdk",
          agent_provider: "claude",
        },
        repo: {
          mode: "reuse-local",
          remote_url: "git@github.com:jemdiggity/kanna.git",
          path: "/tmp/repo-1",
          name: "repo-1",
          default_branch: "main",
        },
        recovery: null,
        target_peer_id: "peer-target",
      },
    });

    await expect(store.recordIncomingTransfer(request)).resolves.toBeUndefined();
    await expect(store.recordIncomingTransfer(request)).resolves.toBeUndefined();
  });
});

describe("incoming transfer approval", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    loadSessionRecoveryStateMock.mockReset();
  });

  it("approves a pending incoming transfer into a new local task and provenance row", async () => {
    setActivePinia(createPinia());
    const { useKannaStore } = await import("./kanna");
    const store = useKannaStore();
    const payload = buildIncomingTransferPayload();
    const fakeDb = createTransferDb({
      transfers: [{
        id: "transfer-1",
        direction: "incoming",
        status: "pending",
        source_peer_id: "peer-source",
        target_peer_id: null,
        source_task_id: "task-source",
        local_task_id: null,
        started_at: new Date().toISOString(),
        completed_at: null,
        error: null,
        payload_json: JSON.stringify(payload),
      }],
    });

    await store.init(fakeDb);

    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "file_exists") {
        return (args?.path as string) === "/tmp/repo-1";
      }
      if (cmd === "which_binary") {
        return args?.name === "claude" ? "/usr/bin/claude" : null;
      }
      if (cmd === "git_worktree_add" || cmd === "create_agent_session") {
        return null;
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const localTaskId = await store.approveIncomingTransfer("transfer-1");

    expect(typeof localTaskId).toBe("string");
    expect(fakeDb.tables.repo).toHaveLength(1);
    expect(fakeDb.tables.repo[0]?.path).toBe("/tmp/repo-1");
    expect(fakeDb.tables.pipeline_item[0]).toMatchObject({
      id: localTaskId,
      repo_id: fakeDb.tables.repo[0]?.id,
      prompt: "Fix handoff",
      branch: localTaskId ? `task-${localTaskId}` : undefined,
      stage: "in progress",
      display_name: "Transferred task",
    });
    expect(fakeDb.tables.task_transfer[0]).toMatchObject({
      id: "transfer-1",
      status: "completed",
      local_task_id: localTaskId,
      error: null,
    });
    expect(fakeDb.tables.task_transfer_provenance[0]).toMatchObject({
      pipeline_item_id: localTaskId,
      source_peer_id: "peer-source",
      source_task_id: "task-source",
      source_machine_task_label: "task-source",
    });
  });

  it("clones the repo remotely before importing a clone-remote transfer", async () => {
    setActivePinia(createPinia());
    const { useKannaStore } = await import("./kanna");
    const store = useKannaStore();
    const payload = buildIncomingTransferPayload();
    payload.repo = {
      mode: "clone-remote",
      remote_url: "git@github.com:jemdiggity/kanna.git",
      path: null,
      name: "repo-1",
      default_branch: "main",
      bundle: null,
    };
    const fakeDb = createTransferDb({
      transfers: [{
        id: "transfer-1",
        direction: "incoming",
        status: "pending",
        source_peer_id: "peer-source",
        target_peer_id: null,
        source_task_id: "task-source",
        local_task_id: null,
        started_at: new Date().toISOString(),
        completed_at: null,
        error: null,
        payload_json: JSON.stringify(payload),
      }],
    });

    await store.init(fakeDb);

    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_app_data_dir") return "/tmp/kanna-mock-data";
      if (cmd === "file_exists") return false;
      if (
        cmd === "ensure_directory" ||
        cmd === "git_clone" ||
        cmd === "git_worktree_add" ||
        cmd === "create_agent_session"
      ) {
        return null;
      }
      if (cmd === "which_binary") {
        return "/usr/bin/claude";
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const localTaskId = await store.approveIncomingTransfer("transfer-1");

    expect(invokeMock).toHaveBeenCalledWith("git_clone", {
      url: "git@github.com:jemdiggity/kanna.git",
      destination: expect.stringContaining("/repo-1"),
    });
    expect(typeof localTaskId).toBe("string");
  });

  it("materializes the repo from a fetched bundle before importing a bundle-repo transfer", async () => {
    setActivePinia(createPinia());
    const { useKannaStore } = await import("./kanna");
    const store = useKannaStore();
    const payload = buildIncomingTransferPayload();
    payload.repo = {
      mode: "bundle-repo",
      remote_url: null,
      path: null,
      name: "repo-1",
      default_branch: "main",
      bundle: {
        artifact_id: "artifact-1",
        filename: "transfer-1.bundle",
        ref_name: "refs/heads/task-source",
      },
    };
    const fakeDb = createTransferDb({
      transfers: [{
        id: "transfer-1",
        direction: "incoming",
        status: "pending",
        source_peer_id: "peer-source",
        target_peer_id: null,
        source_task_id: "task-source",
        local_task_id: null,
        started_at: new Date().toISOString(),
        completed_at: null,
        error: null,
        payload_json: JSON.stringify(payload),
      }],
    });

    await store.init(fakeDb);

    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_app_data_dir") return "/tmp/kanna-mock-data";
      if (cmd === "file_exists") return false;
      if (cmd === "fetch_transfer_artifact") {
        return { path: "/tmp/fetched/transfer-1.bundle" };
      }
      if (
        cmd === "ensure_directory" ||
        cmd === "git_init" ||
        cmd === "git_worktree_add" ||
        cmd === "create_agent_session"
      ) {
        return null;
      }
      if (cmd === "run_script") {
        return "";
      }
      if (cmd === "which_binary") {
        return "/usr/bin/claude";
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const localTaskId = await store.approveIncomingTransfer("transfer-1");

    expect(invokeMock).toHaveBeenCalledWith("fetch_transfer_artifact", {
      transferId: "transfer-1",
      artifactId: "artifact-1",
    });
    expect(invokeMock).toHaveBeenCalledWith("git_init", {
      path: expect.stringContaining("/repo-1"),
    });
    expect(invokeMock).toHaveBeenCalledWith("run_script", {
      script: expect.stringContaining("git fetch"),
      cwd: expect.stringContaining("/repo-1"),
      env: expect.objectContaining({
        KANNA_WORKTREE: "1",
      }),
    });
    expect(typeof localTaskId).toBe("string");
  });

  it("restores codex resume state when importing a transferred codex task", async () => {
    setActivePinia(createPinia());
    const { useKannaStore } = await import("./kanna");
    const store = useKannaStore();
    const payload = buildIncomingTransferPayload();
    payload.task.agent_provider = "codex";
    payload.task.agent_type = "pty";
    payload.task.resume_session_id = "019d9a8c-9f39-7240-818f-88367a7c31df";
    payload.recovery = {
      serialized: "prompt> ",
      cols: 80,
      rows: 24,
      cursorRow: 0,
      cursorCol: 8,
      cursorVisible: true,
      savedAt: 123,
      sequence: 4,
    };
    const fakeDb = createTransferDb({
      transfers: [{
        id: "transfer-1",
        direction: "incoming",
        status: "pending",
        source_peer_id: "peer-source",
        target_peer_id: null,
        source_task_id: "task-source",
        local_task_id: null,
        started_at: new Date().toISOString(),
        completed_at: null,
        error: null,
        payload_json: JSON.stringify(payload),
      }],
    });

    await store.init(fakeDb);

    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "file_exists") {
        return (args?.path as string) === "/tmp/repo-1";
      }
      if (cmd === "read_text_file") {
        return "";
      }
      if (cmd === "read_builtin_resource") {
        throw new Error("missing builtin resource");
      }
      if (cmd === "git_default_branch") {
        return "main";
      }
      if (cmd === "which_binary") {
        return args?.name === "codex" ? "/usr/bin/codex" : null;
      }
      if (cmd === "get_app_data_dir") {
        return "/tmp/kanna-mock-data";
      }
      if (cmd === "get_pipeline_socket_path") {
        return "/tmp/kanna.sock";
      }
      if (
        cmd === "git_worktree_add" ||
        cmd === "seed_session_recovery_state" ||
        cmd === "acknowledge_incoming_transfer_commit"
      ) {
        return null;
      }
      if (cmd === "spawn_session") {
        return null;
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const localTaskId = await store.approveIncomingTransfer("transfer-1");

    expect(fakeDb.tables.pipeline_item[0]).toMatchObject({
      id: localTaskId,
      agent_session_id: "019d9a8c-9f39-7240-818f-88367a7c31df",
    });
    expect(invokeMock).toHaveBeenCalledWith("seed_session_recovery_state", {
      sessionId: localTaskId,
      serialized: "prompt> ",
      cols: 80,
      rows: 24,
      cursorRow: 0,
      cursorCol: 8,
      cursorVisible: true,
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "spawn_session",
      expect.objectContaining({
        sessionId: localTaskId,
        agentProvider: "codex",
        args: expect.arrayContaining([
          expect.stringContaining("codex resume '019d9a8c-9f39-7240-818f-88367a7c31df'"),
        ]),
      }),
    );
  });

  it("rejects a pending incoming transfer locally", async () => {
    setActivePinia(createPinia());
    const { useKannaStore } = await import("./kanna");
    const store = useKannaStore();
    const fakeDb = createTransferDb({
      transfers: [{
        id: "transfer-1",
        direction: "incoming",
        status: "pending",
        source_peer_id: "peer-source",
        target_peer_id: null,
        source_task_id: "task-source",
        local_task_id: null,
        started_at: new Date().toISOString(),
        completed_at: null,
        error: null,
        payload_json: JSON.stringify(buildIncomingTransferPayload()),
      }],
    });

    await store.init(fakeDb);
    await store.rejectIncomingTransfer("transfer-1");

    expect(fakeDb.tables.task_transfer[0]).toMatchObject({
      id: "transfer-1",
      status: "rejected",
      error: "Rejected locally",
    });
  });
});

describe("outgoing transfer commit acknowledgment", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    loadSessionRecoveryStateMock.mockReset();
  });

  it("marks the outgoing transfer completed and closes the source task", async () => {
    setActivePinia(createPinia());
    const { useKannaStore } = await import("./kanna");
    const store = useKannaStore();
    const repo = buildRepo();
    const sourceItem = buildItem(repo.id);
    const fakeDb = createTransferDb({
      repos: [repo],
      items: [sourceItem],
      transfers: [{
        id: "transfer-1",
        direction: "outgoing",
        status: "pending",
        source_peer_id: "peer-source",
        target_peer_id: "peer-target",
        source_task_id: "task-source",
        local_task_id: "task-source",
        started_at: new Date().toISOString(),
        completed_at: null,
        error: null,
        payload_json: JSON.stringify(buildIncomingTransferPayload()),
      }],
    });

    await store.init(fakeDb);
    store.repos = [repo];
    store.items = [sourceItem];

    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "kill_session" || cmd === "signal_session") return null;
      if (cmd === "list_dir") return [];
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    await store.handleOutgoingTransferCommitted({
      transferId: "transfer-1",
      sourceTaskId: "task-source",
      destinationLocalTaskId: "task-imported",
    });

    expect(fakeDb.tables.task_transfer[0]).toMatchObject({
      id: "transfer-1",
      status: "completed",
      local_task_id: "task-source",
      error: null,
    });
    expect(fakeDb.tables.pipeline_item[0]).toMatchObject({
      id: "task-source",
      stage: "done",
    });
    expect(fakeDb.tables.pipeline_item[0]?.closed_at).not.toBeNull();
  });

  it("enters teardown on commit acknowledgment and sanitizes instance-scoped env", async () => {
    setActivePinia(createPinia());
    const { useKannaStore } = await import("./kanna");
    const store = useKannaStore();
    const repo = buildRepo();
    const sourceItem = buildItem(repo.id);
    const fakeDb = createTransferDb({
      repos: [repo],
      items: [sourceItem],
      transfers: [{
        id: "transfer-2",
        direction: "outgoing",
        status: "pending",
        source_peer_id: "peer-source",
        target_peer_id: "peer-target",
        source_task_id: "task-source",
        local_task_id: "task-source",
        started_at: new Date().toISOString(),
        completed_at: null,
        error: null,
        payload_json: JSON.stringify(buildIncomingTransferPayload()),
      }],
    });

    await store.init(fakeDb);
    store.repos = [repo];
    store.items = [sourceItem];

    let teardownSpawnArgs: Record<string, unknown> | null = null;

    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "kill_session" || cmd === "signal_session") return null;
      if (cmd === "list_dir") return [];
      if (cmd === "spawn_session") {
        teardownSpawnArgs = args as Record<string, unknown>;
        return null;
      }
      if (cmd === "attach_session") return null;
      if (cmd === "read_text_file") {
        const path = args?.path as string | undefined;
        if (path === `${repo.path}/.kanna-worktrees/${sourceItem.branch}/.kanna/config.json`) {
          return JSON.stringify({
            teardown: ["./scripts/dev.sh stop -k"],
          });
        }
        return "";
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    await store.handleOutgoingTransferCommitted({
      transferId: "transfer-2",
      sourceTaskId: "task-source",
      destinationLocalTaskId: "task-imported",
    });

    expect(fakeDb.tables.task_transfer[0]).toMatchObject({
      id: "transfer-2",
      status: "completed",
      local_task_id: "task-source",
      error: null,
    });
    expect(teardownSpawnArgs).toMatchObject({
      sessionId: "td-task-source",
      cwd: `${repo.path}/.kanna-worktrees/${sourceItem.branch}`,
      executable: "/bin/zsh",
      args: expect.arrayContaining(["--login", "-i", "-c"]),
      env: expect.objectContaining({
        KANNA_WORKTREE: "1",
        KANNA_TMUX_SESSION: "",
        KANNA_DB_NAME: "",
        KANNA_DB_PATH: "",
        KANNA_DAEMON_DIR: "",
        KANNA_WEBDRIVER_PORT: "",
        KANNA_E2E_TARGET_WEBDRIVER_PORT: "",
      }),
    });
    expect(fakeDb.tables.pipeline_item[0]).toMatchObject({
      id: "task-source",
      stage: "teardown",
    });
    expect(fakeDb.tables.pipeline_item[0]?.closed_at).toBeNull();
  });
});
