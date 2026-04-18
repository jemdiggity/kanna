# Transfer Auto-Send And Repo Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove destination-side transfer approval, decouple pairing from pushing tasks, and reuse existing destination repos by repo identity instead of always creating a new repo.

**Architecture:** Keep pairing as an explicit independent action in the app UI, but make transfer commit auto-import on the destination once peers are already trusted. Stop using runtime preflight to decide repo reuse; instead always send repo identity and let the destination app reuse an already-imported repo by remote URL or exact path before falling back to clone or bundle materialization.

**Tech Stack:** Vue 3, Pinia, Vitest, Tauri commands, Rust transfer runtime

---

### Task 1: Replace Approval-Gated Incoming Transfers With Auto-Import

**Files:**
- Modify: `apps/desktop/src/App.vue`
- Modify: `apps/desktop/src/App.test.ts`
- Test: `apps/desktop/src/App.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test asserting that a `transfer-request` event auto-imports immediately and does not render the approval modal:

```ts
it("auto-imports incoming transfers on receipt without showing the approval modal", async () => {
  dbSelectMock.mockResolvedValue([]);
  const wrapper = await mountApp(SidebarWithRepoStub);

  await flushPromises();
  const handler = listenHandlers.get("transfer-request");
  expect(handler).toBeTypeOf("function");

  await handler?.(buildIncomingTransferEvent());
  await flushPromises();

  expect(store.recordIncomingTransfer).toHaveBeenCalledWith(
    expect.objectContaining({ transferId: "transfer-1" }),
  );
  expect(store.approveIncomingTransfer).toHaveBeenCalledWith("transfer-1");
  expect(wrapper.text()).not.toContain("peer-source");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && pnpm exec vitest run src/App.test.ts -t "auto-imports incoming transfers on receipt without showing the approval modal"`
Expected: FAIL because the current event handler persists the transfer and opens the approval modal instead of approving immediately.

- [ ] **Step 3: Write minimal implementation**

Update the `transfer-request` listener in `apps/desktop/src/App.vue` so it records the transfer and immediately calls `store.approveIncomingTransfer(request.transferId)`. Remove the mount-time DB sync and the `IncomingTransferModal` render path that keep approval state in the UI:

```ts
const unlistenTransferRequest = await listen("transfer-request", async (event: unknown) => {
  try {
    const payload = (event as { payload?: unknown })?.payload ?? event;
    const request = parseIncomingTransferRequest(payload);
    await store.recordIncomingTransfer(request);
    await store.approveIncomingTransfer(request.transferId);
  } catch (e: unknown) {
    console.error("[App] failed to import incoming transfer:", e);
    toast.error(e instanceof Error ? e.message : String(e));
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && pnpm exec vitest run src/App.test.ts -t "auto-imports incoming transfers on receipt without showing the approval modal"`
Expected: PASS

### Task 2: Make Pairing Independent From Push-To-Machine

**Files:**
- Modify: `apps/desktop/src/App.vue`
- Modify: `apps/desktop/src/components/PeerPickerModal.vue`
- Modify: `apps/desktop/src/App.test.ts`
- Modify: `apps/desktop/src/components/__tests__/PeerPickerModal.test.ts`
- Test: `apps/desktop/src/App.test.ts`
- Test: `apps/desktop/src/components/__tests__/PeerPickerModal.test.ts`

- [ ] **Step 1: Write the failing tests**

Add an app-level test that `Pair Machine` appears in the command palette independently of the push command, and a peer-picker test that the modal no longer renders a pair button:

```ts
it("adds Pair Machine to command palette commands independently of task transfer", async () => {
  const wrapper = await mountAppWithOverrides(SidebarWithRepoStub, {
    CommandPaletteModal: CommandPaletteModalStub,
  });
  await flushPromises();
  // open palette and assert Pair Machine label is present
});
```

```ts
it("does not render a pair action inside the push-to-machine picker", () => {
  const wrapper = mount(PeerPickerModal, { props: { peers: [/* trusted peer */] } });
  expect(wrapper.text()).not.toContain("Pair Machine");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && pnpm exec vitest run src/App.test.ts src/components/__tests__/PeerPickerModal.test.ts`
Expected: FAIL because pairing is still emitted from `PeerPickerModal` and there is no independent pairing command.

- [ ] **Step 3: Write minimal implementation**

Add a dynamic command in `apps/desktop/src/App.vue` that opens the machine picker in pairing mode, remove the `pair-peer` emit from `PeerPickerModal`, and filter the push picker to trusted peers only:

```ts
cmds.push({
  id: "pair-machine",
  label: t("taskTransfer.pairPeer"),
  execute: () => openPeerPicker(null, "pair"),
});
```

```vue
<PeerPickerModal
  :peers="pairingMode ? transferPeers.filter((peer) => !peer.trusted) : transferPeers.filter((peer) => peer.trusted)"
  @select="pairingMode ? handlePairPeer : handlePeerSelected"
/>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && pnpm exec vitest run src/App.test.ts src/components/__tests__/PeerPickerModal.test.ts`
Expected: PASS

### Task 3: Reuse Existing Destination Repos By Identity

**Files:**
- Modify: `apps/desktop/src/stores/kanna.ts`
- Modify: `apps/desktop/src/utils/taskTransfer.ts`
- Modify: `apps/desktop/src/stores/kannaTransfer.test.ts`
- Test: `apps/desktop/src/stores/kannaTransfer.test.ts`

- [ ] **Step 1: Write the failing tests**

Add store tests covering:

```ts
it("reuses an imported repo with the same remote URL before cloning a clone-remote transfer", async () => {
  // preload fakeDb.tables.repo with an existing repo path and remote URL match
  // approveIncomingTransfer should return that repo instead of calling git_clone
});
```

```ts
it("sends clone-remote payloads when a remote URL exists regardless of preflight targetHasRepo", async () => {
  // prepare_outgoing_transfer preflight returns targetHasRepo false
  // payload should still carry clone-remote identity rather than a new local-only path assumption
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/kannaTransfer.test.ts -t "reuses an imported repo with the same remote URL before cloning a clone-remote transfer|sends clone-remote payloads when a remote URL exists regardless of preflight targetHasRepo"`
Expected: FAIL because destination import always allocates a new repo path for `clone-remote` and outgoing payload selection still depends on `targetHasRepo`.

- [ ] **Step 3: Write minimal implementation**

In `apps/desktop/src/stores/kanna.ts`, add a repo-identity lookup before clone/create:

```ts
async function findIncomingTransferRepoMatch(payload: OutgoingTransferPayload): Promise<Repo | null> {
  const repos = await _db.select<Repo>("SELECT * FROM repo WHERE hidden = 0");
  if (payload.repo.remote_url) {
    for (const repo of repos) {
      const remoteUrl = await invoke<string | null>("git_remote_url", { repoPath: repo.path }).catch(() => null);
      if (normalizeRemoteUrl(remoteUrl) === normalizeRemoteUrl(payload.repo.remote_url)) {
        return repo;
      }
    }
  }
  if (payload.repo.path) {
    return repos.find((repo) => repo.path === payload.repo.path) ?? null;
  }
  return null;
}
```

Use that in `ensureIncomingTransferRepo()` before `git_clone`, `git_init`, or `allocateTransferredRepoPath()`. In `apps/desktop/src/utils/taskTransfer.ts`, stop selecting `reuse-local` from `targetHasRepo`; choose `clone-remote` whenever a remote exists and reserve `reuse-local` for explicit same-path transfers only.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/kannaTransfer.test.ts -t "reuses an imported repo with the same remote URL before cloning a clone-remote transfer|sends clone-remote payloads when a remote URL exists regardless of preflight targetHasRepo"`
Expected: PASS

### Task 4: Remove The Dead Approval Path And Verify The Slice

**Files:**
- Modify: `apps/desktop/src/App.vue`
- Modify: `apps/desktop/src/App.test.ts`
- Modify: `apps/desktop/src/stores/kanna.ts`
- Modify: `apps/desktop/src/stores/kannaTransfer.test.ts`
- Modify: `apps/desktop/src/components/PeerPickerModal.vue`

- [ ] **Step 1: Run focused desktop tests**

Run: `cd apps/desktop && pnpm exec vitest run src/App.test.ts src/components/__tests__/PeerPickerModal.test.ts src/stores/kannaTransfer.test.ts`
Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `cd apps/desktop && pnpm exec vue-tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Run Rust transfer regressions**

Run: `cd crates/task-transfer && cargo test --test protocol --test runtime`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/App.vue apps/desktop/src/App.test.ts apps/desktop/src/components/PeerPickerModal.vue apps/desktop/src/components/__tests__/PeerPickerModal.test.ts apps/desktop/src/stores/kanna.ts apps/desktop/src/stores/kannaTransfer.test.ts apps/desktop/src/utils/taskTransfer.ts docs/superpowers/plans/2026-04-18-transfer-autosend-repo-reuse.md
git commit -m "Auto-import paired machine transfers"
```
