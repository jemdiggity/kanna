# Transfer Phase 3 Repo Acquisition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the destination import transferred tasks when the repo is not already local by supporting `clone-remote` and a source-provided git bundle fallback.

**Architecture:** Extend the transfer payload with bundle metadata, add transfer-sidecar artifact staging/fetch support for git bundles, and teach the desktop store to acquire repos via local reuse, remote clone, or bundle import before committing the incoming transfer. Keep the existing import-commit acknowledgment boundary unchanged so repo acquisition failures never close the source task.

**Tech Stack:** Vue 3, Pinia, Vitest, Tauri v2 commands, Rust transfer sidecar/runtime, SQLite helpers, git CLI/libgit2-backed Tauri git commands, real two-instance E2E

---

### Task 1: Extend Transfer Payload And Repo Mode Tests

**Files:**
- Modify: `apps/desktop/src/utils/taskTransfer.ts`
- Modify: `apps/desktop/src/stores/kannaTransfer.test.ts`
- Test: `apps/desktop/src/stores/kannaTransfer.test.ts`

- [ ] **Step 1: Write the failing payload tests**

Add tests for explicit bundle metadata and outgoing mode selection:

```ts
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
    bundle: {
      artifact_id: "artifact-1",
      filename: "transfer-1.bundle",
      ref_name: "refs/heads/task-source",
    },
  });
});

it("prefers clone-remote when a remote URL exists and no bundle is provided", () => {
  const payload = buildOutgoingTransferPayload({
    sourcePeerId: "peer-alpha",
    sourceTaskId: "task-source",
    targetPeerId: "peer-target",
    item: buildItem(),
    repoPath: "/tmp/repo-1",
    repoName: "repo-1",
    repoDefaultBranch: "main",
    repoRemoteUrl: "git@github.com:jemdiggity/kanna.git",
    recovery: null,
    targetHasRepo: false,
    bundle: null,
  });

  expect(payload.repo.mode).toBe("clone-remote");
  expect(payload.repo.bundle).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/kannaTransfer.test.ts`
Expected: FAIL because `BuildOutgoingTransferPayloadInput` and `OutgoingTransferPayload.repo` do not support `bundle`, and `buildOutgoingTransferPayload()` cannot emit `bundle-repo`.

- [ ] **Step 3: Write the minimal implementation**

Update the payload types and builder:

```ts
export interface OutgoingTransferPayload {
  // ...
  repo: {
    mode: RepoAcquisitionMode;
    remote_url: string | null;
    path: string | null;
    name: string | null;
    default_branch: string | null;
    bundle: {
      artifact_id: string;
      filename: string;
      ref_name: string | null;
    } | null;
  };
}

export interface BuildOutgoingTransferPayloadInput {
  // ...
  bundle: {
    artifactId: string;
    filename: string;
    refName: string | null;
  } | null;
}

export function chooseRepoAcquisitionMode(input: {
  remoteUrl: string | null;
  targetHasRepo: boolean;
  bundle: BuildOutgoingTransferPayloadInput["bundle"];
}): RepoAcquisitionMode {
  if (input.targetHasRepo) return "reuse-local";
  if (normalizeRemoteUrl(input.remoteUrl)) return "clone-remote";
  if (input.bundle) return "bundle-repo";
  return "bundle-repo";
}
```

and:

```ts
repo: {
  mode: chooseRepoAcquisitionMode({
    remoteUrl,
    targetHasRepo: input.targetHasRepo,
    bundle: input.bundle,
  }),
  remote_url: remoteUrl,
  path: input.repoPath ?? null,
  name: input.repoName ?? null,
  default_branch: input.repoDefaultBranch ?? null,
  bundle: input.bundle
    ? {
        artifact_id: input.bundle.artifactId,
        filename: input.bundle.filename,
        ref_name: input.bundle.refName,
      }
    : null,
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/kannaTransfer.test.ts`
Expected: PASS for the new bundle-payload assertions.

### Task 2: Add Sidecar Artifact Staging And Fetch Protocol

**Files:**
- Modify: `crates/task-transfer/src/protocol.rs`
- Modify: `crates/task-transfer/src/runtime.rs`
- Modify: `crates/task-transfer/src/main.rs`
- Modify: `crates/task-transfer/tests/protocol.rs`
- Modify: `crates/task-transfer/tests/runtime.rs`
- Modify: `apps/desktop/src-tauri/src/transfer_sidecar.rs`
- Modify: `apps/desktop/src-tauri/src/commands/transfer.rs`

- [ ] **Step 1: Write the failing Rust protocol/runtime tests**

Add protocol round-trips for transfer artifacts:

```rust
assert_roundtrip(ControlRequest::StageTransferArtifact {
    request_id: "req-1".into(),
    transfer_id: "transfer-1".into(),
    artifact_id: "artifact-1".into(),
    path: "/tmp/transfer-1.bundle".into(),
});

assert_roundtrip(ControlRequest::FetchTransferArtifact {
    request_id: "req-2".into(),
    transfer_id: "transfer-1".into(),
    artifact_id: "artifact-1".into(),
});
```

Add runtime behavior coverage:

```rust
runtime
    .stage_transfer_artifact("transfer-1", "artifact-1", bundle_path.clone())
    .await?;

let fetched = runtime
    .fetch_transfer_artifact("transfer-1", "artifact-1")
    .await?;

assert_eq!(fetched.path, bundle_path);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p kanna-task-transfer --test protocol --test runtime`
Expected: FAIL because artifact staging/fetch requests and runtime storage do not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Add protocol messages:

```rust
ControlRequest::StageTransferArtifact {
    request_id: String,
    transfer_id: String,
    artifact_id: String,
    path: String,
}

ControlRequest::FetchTransferArtifact {
    request_id: String,
    transfer_id: String,
    artifact_id: String,
}

ControlResponse::StageTransferArtifact {
    request_id: String,
    transfer_id: String,
    artifact_id: String,
}

ControlResponse::FetchTransferArtifact {
    request_id: String,
    transfer_id: String,
    artifact_id: String,
    path: String,
}
```

Store them in runtime:

```rust
struct TransferArtifact {
    path: PathBuf,
    created_at: Instant,
}

type TransferArtifacts = Arc<Mutex<HashMap<String, HashMap<String, TransferArtifact>>>>;
```

and expose:

```rust
pub async fn stage_transfer_artifact(
    &self,
    transfer_id: &str,
    artifact_id: &str,
    path: PathBuf,
) -> Result<(), RuntimeError> { ... }

pub async fn fetch_transfer_artifact(
    &self,
    transfer_id: &str,
    artifact_id: &str,
) -> Result<PathBuf, RuntimeError> { ... }
```

Wire the Tauri client:

```rust
pub async fn stage_transfer_artifact(
    &mut self,
    transfer_id: String,
    artifact_id: String,
    path: String,
) -> Result<Value, String> { ... }

pub async fn fetch_transfer_artifact(
    &mut self,
    transfer_id: String,
    artifact_id: String,
) -> Result<Value, String> { ... }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p kanna-task-transfer --test protocol --test runtime`
Expected: PASS.

### Task 3: Add Tauri Transfer Commands For Bundle Artifact Stage And Fetch

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/transfer.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Test: existing command/client tests if present, otherwise covered via desktop/store tests

- [ ] **Step 1: Write the failing desktop-side tests**

Add a store-facing test that expects bundle staging to call the new commands:

```ts
expect(invokeMock).toHaveBeenCalledWith("stage_transfer_artifact", {
  transferId: "transfer-1",
  artifactId: "artifact-1",
  path: "/tmp/transfer-1.bundle",
});
```

and destination fetch:

```ts
expect(invokeMock).toHaveBeenCalledWith("fetch_transfer_artifact", {
  transferId: "transfer-1",
  artifactId: "artifact-1",
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/kannaTransfer.test.ts`
Expected: FAIL because the store cannot call nonexistent Tauri commands.

- [ ] **Step 3: Write the minimal implementation**

Add commands:

```rust
#[tauri::command]
pub async fn stage_transfer_artifact(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::TransferSidecarState>,
    transfer_id: String,
    artifact_id: String,
    path: String,
) -> Result<Value, String> { ... }

#[tauri::command]
pub async fn fetch_transfer_artifact(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::TransferSidecarState>,
    transfer_id: String,
    artifact_id: String,
) -> Result<Value, String> { ... }
```

Register them in `invoke_handler!` and `commands/mod.rs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/kannaTransfer.test.ts`
Expected: PASS for the new command expectations.

### Task 4: Implement Source Bundle Preparation In The Desktop Store

**Files:**
- Modify: `apps/desktop/src/stores/kanna.ts`
- Modify: `apps/desktop/src/stores/kannaTransfer.test.ts`
- Modify: `apps/desktop/src/utils/taskTransfer.ts`
- Test: `apps/desktop/src/stores/kannaTransfer.test.ts`

- [ ] **Step 1: Write the failing source bundle-preparation tests**

Add a source-side test for no-remote repos:

```ts
it("stages a git bundle before committing bundle-repo transfers", async () => {
  await store.pushTaskToPeer("task-source", "peer-target");

  expect(invokeMock).toHaveBeenCalledWith("run_script", {
    script: expect.stringContaining("git bundle create"),
    cwd: "/tmp/repo-1",
    env: expect.objectContaining({ KANNA_WORKTREE: "1" }),
  });

  expect(invokeMock).toHaveBeenCalledWith("stage_transfer_artifact", {
    transferId: "transfer-123",
    artifactId: expect.any(String),
    path: expect.stringContaining(".bundle"),
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/kannaTransfer.test.ts`
Expected: FAIL because `pushTaskToPeer()` never creates or stages bundles.

- [ ] **Step 3: Write the minimal implementation**

Add helpers in `kanna.ts`:

```ts
function buildTransferBundlePath(transferId: string): string {
  return `/tmp/kanna-transfer-${transferId}.bundle`;
}

function buildTransferBundleArtifactId(transferId: string): string {
  return `${transferId}-repo-bundle`;
}
```

Then in `pushTaskToPeer()`:

```ts
let bundle: BuildOutgoingTransferPayloadInput["bundle"] = null;
if (!preflight.targetHasRepo && !repoRemoteUrl) {
  const bundlePath = buildTransferBundlePath(preflight.transferId);
  const artifactId = buildTransferBundleArtifactId(preflight.transferId);
  const refName = item.branch ? `refs/heads/${item.branch}` : item.base_ref ? `refs/heads/${item.base_ref}` : null;
  const refs = [refName, repo.default_branch ? `refs/heads/${repo.default_branch}` : null]
    .filter((value): value is string => Boolean(value));

  await invoke("run_script", {
    script: `git bundle create '${bundlePath.replace(/'/g, "'\\''")}' ${refs.join(" ")}`,
    cwd: repo.path,
    env: applyWorktreeProcessIsolation({ KANNA_WORKTREE: "1" }),
  });

  await invoke("stage_transfer_artifact", {
    transferId: preflight.transferId,
    artifactId,
    path: bundlePath,
  });

  bundle = {
    artifactId,
    filename: `${preflight.transferId}.bundle`,
    refName,
  };
}
```

and pass `bundle` into `buildOutgoingTransferPayload(...)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/kannaTransfer.test.ts`
Expected: PASS.

### Task 5: Implement Destination Repo Acquisition For Clone And Bundle Paths

**Files:**
- Modify: `apps/desktop/src/stores/kanna.ts`
- Modify: `apps/desktop/src/stores/kannaTransfer.test.ts`
- Test: `apps/desktop/src/stores/kannaTransfer.test.ts`

- [ ] **Step 1: Write the failing destination acquisition tests**

Add clone-remote coverage:

```ts
it("clones the repo remotely before importing a clone-remote transfer", async () => {
  const localTaskId = await store.approveIncomingTransfer("transfer-1");

  expect(invokeMock).toHaveBeenCalledWith("git_clone", {
    url: "git@github.com:jemdiggity/kanna.git",
    path: expect.stringContaining("/repo-1"),
  });
  expect(localTaskId).toEqual(expect.any(String));
});
```

Add bundle-repo coverage:

```ts
it("materializes the repo from a staged bundle before importing a bundle-repo transfer", async () => {
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
    env: expect.objectContaining({ KANNA_WORKTREE: "1" }),
  });
  expect(localTaskId).toEqual(expect.any(String));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/kannaTransfer.test.ts`
Expected: FAIL because `approveIncomingTransfer()` still requires a local repo path to exist before proceeding.

- [ ] **Step 3: Write the minimal implementation**

Add a repo acquisition helper:

```ts
async function ensureIncomingTransferRepo(payload: OutgoingTransferPayload): Promise<{
  repoId: string;
  repoPath: string;
}> {
  if (payload.repo.mode === "reuse-local") { ... }

  if (payload.repo.mode === "clone-remote") {
    const repoPath = await allocateTransferredRepoPath(payload.repo.name ?? "repo");
    await invoke("git_clone", {
      url: payload.repo.remote_url,
      path: repoPath,
    });
    const repoId = await importRepo(repoPath, payload.repo.name ?? "repo", payload.repo.default_branch ?? "main");
    return { repoId, repoPath };
  }

  if (payload.repo.mode === "bundle-repo") {
    const fetched = await invoke<{ path: string }>("fetch_transfer_artifact", {
      transferId: transferId,
      artifactId: payload.repo.bundle?.artifact_id,
    });
    const repoPath = await allocateTransferredRepoPath(payload.repo.name ?? "repo");
    await invoke("git_init", { path: repoPath });
    await invoke("run_script", {
      script: `git fetch '${fetched.path.replace(/'/g, "'\\''")}' '+refs/*:refs/*' && git checkout '${(payload.repo.bundle?.ref_name ?? payload.task.branch ?? payload.task.base_ref ?? "HEAD").replace(/'/g, "'\\''")}'`,
      cwd: repoPath,
      env: applyWorktreeProcessIsolation({ KANNA_WORKTREE: "1" }),
    });
    const repoId = await importRepo(repoPath, payload.repo.name ?? "repo", payload.repo.default_branch ?? "main");
    return { repoId, repoPath };
  }

  throw new Error(`unsupported repo acquisition mode: ${payload.repo.mode satisfies never}`);
}
```

Then replace the current `repoPath` existence gate in `approveIncomingTransfer()` with `ensureIncomingTransferRepo(payload)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/kannaTransfer.test.ts`
Expected: PASS.

### Task 6: Cover Real Two-Instance Clone And Bundle Acquisition Flows

**Files:**
- Modify: `apps/desktop/tests/e2e/real/local-transfer-accept-import.test.ts`
- Create: `apps/desktop/tests/e2e/real/local-transfer-clone-remote.test.ts`
- Create: `apps/desktop/tests/e2e/real/local-transfer-bundle-repo.test.ts`
- Modify: `apps/desktop/tests/e2e/helpers/fixture-repo.ts`
- Modify: `apps/desktop/tests/e2e/run.ts`

- [ ] **Step 1: Write the failing real E2E assertions**

Clone-remote test assertions:

```ts
expect(importedRepoRows[0]).toMatchObject({
  path: expect.stringContaining("local-transfer-clone-remote"),
});
expect(importedTaskRows[0]).toMatchObject({
  stage: "in progress",
});
```

Bundle-repo test assertions:

```ts
expect(importedRepoRows[0]).toMatchObject({
  name: "local-transfer-bundle-repo",
});
expect(await queryPrimarySourceTask(taskId)).toMatchObject({
  stage: "teardown",
});
```

Failure assertions:

```ts
expect(await queryPrimarySourceTask(taskId)).toMatchObject({
  stage: "in progress",
  closed_at: null,
});
```

- [ ] **Step 2: Run the clone-remote E2E to verify it fails**

Run: `cd apps/desktop && pnpm exec vitest run --config ./tests/e2e/vitest.config.ts tests/e2e/real/local-transfer-clone-remote.test.ts`
Expected: FAIL because the destination cannot clone during transfer approval yet.

- [ ] **Step 3: Run the bundle-repo E2E to verify it fails**

Run: `cd apps/desktop && pnpm exec vitest run --config ./tests/e2e/vitest.config.ts tests/e2e/real/local-transfer-bundle-repo.test.ts`
Expected: FAIL because the source does not stage bundle artifacts and the destination cannot import them yet.

- [ ] **Step 4: Implement E2E fixtures and assertions**

Use fixture helpers to control repo remotes:

```ts
await createFixtureRepo("local-transfer-clone-remote", {
  remoteMode: "preserve",
});

await createFixtureRepo("local-transfer-bundle-repo", {
  remoteMode: "remove-origin",
});
```

Add `needsSecondaryInstance()` support for the new transfer suites in `run.ts`.

- [ ] **Step 5: Re-run both E2E files**

Run:

```bash
cd apps/desktop
pnpm exec vitest run --config ./tests/e2e/vitest.config.ts tests/e2e/real/local-transfer-clone-remote.test.ts
pnpm exec vitest run --config ./tests/e2e/vitest.config.ts tests/e2e/real/local-transfer-bundle-repo.test.ts
```

Expected: PASS.

### Task 7: Final Verification

**Files:**
- Verify only

- [ ] **Step 1: Run desktop typecheck**

Run: `cd apps/desktop && pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 2: Run targeted desktop tests**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/kannaTransfer.test.ts src/App.test.ts`
Expected: PASS

- [ ] **Step 3: Run DB tests**

Run: `cd packages/db && pnpm exec vitest run src/queries.test.ts`
Expected: PASS

- [ ] **Step 4: Run task-transfer Rust tests**

Run: `cargo test -p kanna-task-transfer --test protocol --test runtime`
Expected: PASS

- [ ] **Step 5: Run formatter and clippy**

Run:

```bash
cargo fmt --all
cargo clippy -p kanna-task-transfer -p kanna-daemon -p kanna-desktop --tests -- -D warnings
```

Expected: PASS

- [ ] **Step 6: Run real two-instance transfer acquisition tests**

Run:

```bash
cd apps/desktop
pnpm exec vitest run --config ./tests/e2e/vitest.config.ts tests/e2e/real/local-transfer-clone-remote.test.ts
pnpm exec vitest run --config ./tests/e2e/vitest.config.ts tests/e2e/real/local-transfer-bundle-repo.test.ts
pnpm exec vitest run --config ./tests/e2e/vitest.config.ts tests/e2e/real/local-transfer-source-handoff-failure.test.ts
```

Expected: PASS
