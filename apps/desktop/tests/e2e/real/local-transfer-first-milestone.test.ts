import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupFixtureRepos, createFixtureRepo } from "../helpers/fixture-repo";
import { cleanupWorktrees, importTestRepo, resetDatabase } from "../helpers/reset";
import { pauseForSlowMode } from "../helpers/slowMode";
import { createPrimaryAndSecondaryClients } from "../helpers/twoInstance";
import { callVueMethod, getVueState, queryDb, tauriInvoke } from "../helpers/vue";

interface TransferPeer {
  peer_id?: string;
  peerId?: string;
  display_name?: string;
  displayName?: string;
}

interface PipelineRow {
  id: string;
}

interface TransferRow {
  id: string;
  direction: string;
  status: string;
  source_task_id: string;
}

interface VueCallError {
  __error: string;
}

let testRepoPath = "";

function isVueCallError(value: unknown): value is VueCallError {
  return Boolean(
    value &&
    typeof value === "object" &&
    "__error" in value &&
    typeof (value as VueCallError).__error === "string",
  );
}

function readPeerId(peer: TransferPeer): string | null {
  if (typeof peer.peer_id === "string" && peer.peer_id.length > 0) return peer.peer_id;
  if (typeof peer.peerId === "string" && peer.peerId.length > 0) return peer.peerId;
  return null;
}

function readPeerDisplayName(peer: TransferPeer): string | null {
  if (typeof peer.display_name === "string" && peer.display_name.length > 0) return peer.display_name;
  if (typeof peer.displayName === "string" && peer.displayName.length > 0) return peer.displayName;
  return null;
}

async function waitForPeer(
  peerId: string,
  timeoutMs = 20_000,
): Promise<TransferPeer[]> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const raw = await tauriInvoke(primary, "list_transfer_peers");
    if (Array.isArray(raw)) {
      const peers = raw as TransferPeer[];
      if (peers.some((peer) => readPeerId(peer) === peerId)) {
        return peers;
      }
    }
    await sleep(250);
  }

  throw new Error(`timed out waiting for peer ${peerId}`);
}

async function waitForIncomingTransferVisible(timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const visible = await getVueState(secondary, "showIncomingTransfer");
    if (visible === true) {
      return;
    }
    await sleep(250);
  }

  throw new Error("timed out waiting for incoming transfer modal");
}

async function deleteSessionIfRunning(client: { deleteSession(): Promise<void> }): Promise<void> {
  await client.deleteSession().catch(() => undefined);
}

const { primary, secondary } = createPrimaryAndSecondaryClients();

describe("local transfer first milestone", () => {
  let repoId = "";

  beforeAll(async () => {
    await primary.createSession();
    await secondary.createSession();
    await resetDatabase(primary);
    await resetDatabase(secondary);
    testRepoPath = await createFixtureRepo("local-transfer-source");
    repoId = await importTestRepo(primary, testRepoPath, "local-transfer-source");
    await pauseForSlowMode("repo imported into primary");
  });

  afterAll(async () => {
    await cleanupWorktrees(primary, testRepoPath).catch(() => undefined);
    await cleanupFixtureRepos(testRepoPath ? [testRepoPath] : []).catch(() => undefined);
    await deleteSessionIfRunning(primary);
    await deleteSessionIfRunning(secondary);
  });

  it("lists the secondary peer and persists an incoming transfer on the secondary instance", async () => {
    const peers = await waitForPeer("peer-secondary");
    expect(peers.some((peer) => readPeerId(peer) === "peer-secondary")).toBe(true);
    expect(peers.some((peer) => readPeerDisplayName(peer) === "Secondary")).toBe(true);
    await pauseForSlowMode("secondary peer discovered");

    const createResult = await callVueMethod(primary, "store.createItem", repoId, testRepoPath, "Say OK", "sdk");
    if (isVueCallError(createResult)) {
      throw new Error(createResult.__error);
    }

    const rows = (await queryDb(
      primary,
      "SELECT id FROM pipeline_item WHERE prompt = ? ORDER BY created_at DESC LIMIT 1",
      ["Say OK"],
    )) as PipelineRow[];
    const taskId = rows[0]?.id;
    expect(taskId).toBeTruthy();
    await pauseForSlowMode("task created on primary");

    const pushResult = await callVueMethod(primary, "store.pushTaskToPeer", taskId, "peer-secondary");
    if (isVueCallError(pushResult)) {
      throw new Error(pushResult.__error);
    }
    await pauseForSlowMode("task pushed to secondary");

    await waitForIncomingTransferVisible();
    expect(await getVueState(secondary, "incomingTransferSourceName")).toBe("Primary");
    await secondary.waitForText(".modal-card", "Primary");
    await pauseForSlowMode("incoming transfer modal visible on secondary");

    const transferRows = (await queryDb(
      secondary,
      "SELECT id, direction, status, source_task_id FROM task_transfer ORDER BY started_at DESC LIMIT 1",
    )) as TransferRow[];

    expect(transferRows[0]).toMatchObject({
      direction: "incoming",
      status: "pending",
      source_task_id: taskId,
    });
    expect(typeof transferRows[0]?.id).toBe("string");
    expect(transferRows[0]?.id.length).toBeGreaterThan(0);
  });
});
