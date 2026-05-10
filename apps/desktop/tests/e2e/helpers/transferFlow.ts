import { setTimeout as sleep } from "node:timers/promises";
import { createHash } from "node:crypto";
import { buildGlobalKeydownScript } from "./keyboard";
import { pauseForSlowMode } from "./slowMode";
import { tauriInvoke } from "./vue";
import type { WebDriverClient } from "./webdriver";

interface TransferPeer {
  peer_id?: string;
  peerId?: string;
  public_key?: string;
  publicKey?: string;
  trusted?: boolean;
}

interface PairingPromptOptions {
  promptClient: WebDriverClient;
  promptPeerId: string;
}

function readPeerId(peer: TransferPeer): string | null {
  if (typeof peer.peer_id === "string" && peer.peer_id.length > 0) return peer.peer_id;
  if (typeof peer.peerId === "string" && peer.peerId.length > 0) return peer.peerId;
  return null;
}

function readPeerPublicKey(peer: TransferPeer): string | null {
  if (typeof peer.public_key === "string" && peer.public_key.length > 0) return peer.public_key;
  if (typeof peer.publicKey === "string" && peer.publicKey.length > 0) return peer.publicKey;
  return null;
}

function computePairingCode(leftPeer: TransferPeer, rightPeer: TransferPeer): string {
  const leftPeerId = readPeerId(leftPeer);
  const rightPeerId = readPeerId(rightPeer);
  const leftPublicKey = readPeerPublicKey(leftPeer);
  const rightPublicKey = readPeerPublicKey(rightPeer);
  if (!leftPeerId || !rightPeerId || !leftPublicKey || !rightPublicKey) {
    throw new Error("cannot compute pairing code without both peer ids and public keys");
  }

  const participants = [
    `${leftPeerId}:${leftPublicKey}`,
    `${rightPeerId}:${rightPublicKey}`,
  ].sort();
  const digest = createHash("sha256")
    .update(participants[0])
    .update("|")
    .update(participants[1])
    .digest();
  const value = digest.readUInt32BE(0) % 1_000_000;
  return value.toString().padStart(6, "0");
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

async function findTransferPeer(
  client: WebDriverClient,
  peerId: string,
  timeoutMs = 20_000,
): Promise<TransferPeer> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const raw = await tauriInvoke(client, "list_transfer_peers");
    if (Array.isArray(raw)) {
      const match = raw.find((peer) => readPeerId(peer as TransferPeer) === peerId) as TransferPeer | undefined;
      if (match) return match;
    }
    await sleep(250);
  }

  throw new Error(`timed out waiting for transfer peer ${peerId}`);
}

async function installPairingPromptStub(
  client: WebDriverClient,
  code: string,
): Promise<void> {
  await client.executeSync(
    `window.__KANNA_E2E_PAIRING_PROMPT__ = { called: false, message: null, returnedCode: ${JSON.stringify(code)} };
     window.prompt = (message) => {
       window.__KANNA_E2E_PAIRING_PROMPT__.called = true;
       window.__KANNA_E2E_PAIRING_PROMPT__.message = message;
       return window.__KANNA_E2E_PAIRING_PROMPT__.returnedCode;
     };`,
  );
}

async function selectPeerAndConfirm(
  client: WebDriverClient,
  peerName: string,
): Promise<void> {
  const peer = await client.waitForText(".peer-row", peerName, 10_000);
  await client.click(peer);
  const confirm = await client.waitForElement(".modal-card .btn-primary:not(:disabled)", 5_000);
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
  promptOptions?: PairingPromptOptions,
): Promise<void> {
  if (await isTransferPeerTrusted(client, peerId)) {
    return;
  }
  if (promptOptions) {
    const targetPeer = await findTransferPeer(client, peerId);
    const promptSidePeer = await findTransferPeer(promptOptions.promptClient, promptOptions.promptPeerId);
    await installPairingPromptStub(promptOptions.promptClient, computePairingCode(targetPeer, promptSidePeer));
  }
  await runCommandPaletteAction(client, "Pair Machine");
  await selectPeerAndConfirm(client, peerName);
  await waitForTransferPeerTrusted(client, peerId);
  if (promptOptions) {
    await waitForTransferPeerTrusted(promptOptions.promptClient, promptOptions.promptPeerId);
  }
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
