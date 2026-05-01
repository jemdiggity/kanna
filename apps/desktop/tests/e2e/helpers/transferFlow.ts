import { setTimeout as sleep } from "node:timers/promises";
import { buildGlobalKeydownScript } from "./keyboard";
import { pauseForSlowMode } from "./slowMode";
import { tauriInvoke } from "./vue";
import type { WebDriverClient } from "./webdriver";

interface TransferPeer {
  peer_id?: string;
  peerId?: string;
  trusted?: boolean;
}

function readPeerId(peer: TransferPeer): string | null {
  if (typeof peer.peer_id === "string" && peer.peer_id.length > 0) return peer.peer_id;
  if (typeof peer.peerId === "string" && peer.peerId.length > 0) return peer.peerId;
  return null;
}

async function runCommandPaletteAction(
  client: WebDriverClient,
  commandLabel: string,
): Promise<void> {
  await client.executeSync(buildGlobalKeydownScript({
    key: "P",
    meta: true,
    shift: true,
  }));
  const input = await client.waitForElement(".palette-input", 5_000);
  await client.sendKeys(input, commandLabel);
  const command = await client.waitForText(".command-item", commandLabel, 5_000);
  await client.click(command);
}

async function isTransferPeerTrusted(
  client: WebDriverClient,
  peerId: string,
): Promise<boolean> {
  const raw = await tauriInvoke(client, "list_transfer_peers");
  if (!Array.isArray(raw)) return false;
  const match = raw.find((peer) => readPeerId(peer as TransferPeer) === peerId) as TransferPeer | undefined;
  return match?.trusted === true;
}

async function selectPeerAndConfirm(
  client: WebDriverClient,
  peerName: string,
): Promise<void> {
  const peer = await client.waitForText(".peer-row", peerName, 10_000);
  await client.click(peer);
  const confirm = await client.waitForElement(".modal-card .btn-primary", 2_000);
  await client.click(confirm);
  await client.waitForNoElement(".modal-card", 10_000);
}

export async function waitForTransferPeerTrusted(
  client: WebDriverClient,
  peerId: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const raw = await tauriInvoke(client, "list_transfer_peers");
    if (Array.isArray(raw)) {
      const match = raw.find((peer) => readPeerId(peer as TransferPeer) === peerId) as TransferPeer | undefined;
      if (match?.trusted === true) {
        return;
      }
    }
    await sleep(250);
  }

  throw new Error(`timed out waiting for trusted transfer peer ${peerId}`);
}

export async function pairWithPeerThroughUi(
  client: WebDriverClient,
  peerName: string,
  peerId: string,
): Promise<void> {
  if (await isTransferPeerTrusted(client, peerId)) {
    return;
  }
  await runCommandPaletteAction(client, "Pair Machine");
  await selectPeerAndConfirm(client, peerName);
  await waitForTransferPeerTrusted(client, peerId);
  await pauseForSlowMode(`paired with ${peerId}`);
}

export async function pushSelectedTaskToPeerThroughUi(
  client: WebDriverClient,
  peerName: string,
): Promise<void> {
  await runCommandPaletteAction(client, "Push to Machine");
  await selectPeerAndConfirm(client, peerName);
  await pauseForSlowMode(`pushed selected task to ${peerName}`);
}
