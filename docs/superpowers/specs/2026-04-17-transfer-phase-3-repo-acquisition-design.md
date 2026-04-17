# Transfer Phase 3 Repo Acquisition Design

## Goal

Extend LAN task transfer beyond same-machine local repo reuse by letting the destination acquire the source repo in two additional ways:

- clone from the source-provided remote URL when possible,
- fall back to a source-provided git bundle when no usable remote path exists.

This phase keeps the existing ownership-handoff invariant:

- the source stays authoritative until the destination commits the import successfully.

## Scope

This design covers:

- destination-side repo acquisition for `clone-remote`,
- git bundle fallback for `bundle-repo`,
- transfer payload changes needed to support repo acquisition,
- source-side bundle preparation,
- destination-side repo materialization from a bundle,
- success and failure handling before import commit,
- unit and real two-instance E2E coverage for both acquisition modes.

This design does not cover:

- Bonjour discovery,
- pairing or trust UX,
- encrypted transport redesign,
- provider resume ownership cutover,
- partial bundle sync or incremental repo replication,
- large-repo optimization beyond the basic git bundle flow.

## Current State

The branch already supports:

- outgoing transfer preflight and commit,
- destination-side persistence of full incoming payloads,
- destination approval and local import for `reuse-local`,
- destination provenance recording,
- source-side ownership handoff after successful destination import.

The current repo acquisition boundary is still phase-1 local-only:

- the payload includes `repo.mode`, `repo.remote_url`, `repo.path`, `repo.name`, and `repo.default_branch`,
- the destination requires `repo.path` to exist locally,
- `clone-remote` and `bundle-repo` are represented in the payload shape but are not implemented,
- approval fails immediately if the local path does not exist.

## Problem

The current implementation only works when both Kanna instances can see the same repo path. That is acceptable for local two-instance testing, but it does not satisfy the actual LAN transfer requirement:

- destination machines may not have the source repo locally,
- some repos have valid remotes and should be cloned directly,
- some repos are local-only or have unusable remotes and need a source-sent fallback.

Without repo acquisition, the transfer protocol stops at the wrong boundary. It can move task metadata, but not the repository state required to reconstruct a worktree.

## Approaches Considered

### 1. Remote clone only

Implement `clone-remote` and leave `bundle-repo` as a future phase.

Pros:

- smallest implementation,
- low transport complexity,
- no new staged artifact handling.

Cons:

- still fails for local-only repos,
- does not complete the planned fallback behavior,
- creates a second incomplete repo-acquisition milestone almost immediately.

### 2. Remote clone plus git bundle fallback

Implement `clone-remote` for the normal path and `bundle-repo` using a source-generated git bundle as the fallback path.

Pros:

- matches the LAN transfer design intent,
- stays aligned with Kanna’s git/worktree model,
- avoids inventing a filesystem snapshot format,
- gives the destination a complete repo acquisition story.

Cons:

- adds staged transfer artifact handling,
- requires more integration work between the desktop store and transfer sidecar.

### 3. Raw repo snapshot fallback

Send a file or archive snapshot of the repo/worktree contents instead of a git-native bundle.

Pros:

- works without depending on git-native bundle semantics.

Cons:

- duplicates git responsibilities poorly,
- risks incorrect branch/ref reconstruction,
- higher complexity and weaker architectural fit.

## Recommendation

Use **remote clone plus git bundle fallback**.

`clone-remote` should be the default when the destination can acquire the repo directly from the source-provided remote URL. When that is not possible, the source should provide a git-native bundle that the destination can materialize into a local repo before continuing through the existing task import flow.

This keeps repo acquisition consistent with the rest of Kanna:

- repos stay git repos,
- task import still builds a fresh local task/worktree/session on top of a local repo,
- failure remains fail-safe because no import commit means no source closure.

## Core Decisions

### Repo acquisition remains part of destination import

The source still sends task metadata, provenance, and repo acquisition hints. The destination remains responsible for deciding how to acquire the repo locally and for creating the final local repo/task/worktree state.

This keeps ownership boundaries clear:

- source prepares what is needed for transfer,
- destination decides whether it can reuse, clone, or restore a repo,
- source does not attempt to dictate the destination repo layout directly.

### Use a transfer-scoped staged artifact for bundle fallback

The source should generate a git bundle file during outgoing commit preparation and register it with the transfer sidecar as a transfer-scoped staged artifact. The transfer payload then references the artifact metadata rather than inlining bundle bytes into JSON.

This avoids:

- bloating the transfer control payload,
- coupling bundle transport to desktop-store DB persistence,
- inventing a second ad hoc binary transport path outside the sidecar.

### Keep the destination import commit boundary unchanged

Repo acquisition must succeed before the destination marks the transfer completed or emits the source acknowledgment.

Ordered rule:

1. acquire or restore the repo,
2. create/import the local task,
3. mark the transfer committed,
4. acknowledge the source.

If repo acquisition fails, no commit acknowledgment is emitted.

### Prefer deterministic repo acquisition order

Destination repo resolution order should be:

1. `reuse-local`
2. `clone-remote`
3. `bundle-repo`

Within those modes:

- `reuse-local` uses an existing imported repo record when the path already exists locally,
- `clone-remote` clones when the remote URL is present and the destination does not already have the repo,
- `bundle-repo` materializes a local repo from the source-sent bundle.

The destination should not silently downgrade `clone-remote` to `bundle-repo` unless the payload explicitly includes the bundle fallback metadata. The source decides whether fallback material is available.

## Payload Design

### Repo payload shape

The current repo payload should grow to include explicit fallback bundle metadata:

```ts
repo: {
  mode: "reuse-local" | "clone-remote" | "bundle-repo";
  remote_url: string | null;
  path: string | null;
  name: string | null;
  default_branch: string | null;
  bundle?: {
    artifact_id: string;
    filename: string;
    ref_name: string | null;
  } | null;
}
```

Rules:

- `reuse-local` requires `path`,
- `clone-remote` requires `remote_url`,
- `bundle-repo` requires `bundle.artifact_id`,
- `bundle.ref_name` is optional but preferred so the destination can check out the intended starting ref cleanly.

### Mode selection

Outgoing payload mode selection should become:

1. if preflight says destination already has the repo, use `reuse-local`,
2. else if the source has a usable remote URL, use `clone-remote`,
3. else generate a bundle and use `bundle-repo`.

The source should not choose `bundle-repo` when a usable remote URL exists unless the remote URL cannot be resolved for the task repo or the source explicitly fails to read it.

## Source-Side Export Flow

### Clone-remote path

For `clone-remote`, the source only needs to include:

- `remote_url`,
- `default_branch`,
- the task branch or base ref needed for destination task reconstruction.

No bundle artifact is staged in this path.

### Bundle-repo path

For `bundle-repo`, the source should:

1. resolve the source repo root,
2. determine the refs needed for destination reconstruction,
3. create a git bundle file in a transfer-scoped temp location,
4. register that file with the transfer sidecar under a transfer artifact id,
5. include the artifact metadata in the outgoing payload,
6. keep the artifact alive until the transfer completes or is canceled.

### Bundle contents

The minimum bundle content should include:

- the task branch ref when present,
- the repo default branch ref when available,
- any base ref required for worktree creation if it differs from the task branch.

This phase does not need to optimize for minimal history slicing. A correct bundle is more important than an aggressively minimal bundle.

## Destination-Side Import Flow

### Reuse-local

Existing behavior remains:

1. verify the provided path exists locally,
2. import or reuse the repo record,
3. proceed to local task creation.

### Clone-remote

For `clone-remote`, the destination should:

1. derive a local clone destination under Kanna-managed repos or an equivalent imported-repo location,
2. clone the repo using `git_clone`,
3. resolve the imported repo record,
4. proceed to task creation using the transferred task branch/base ref metadata.

If clone fails:

- leave the incoming transfer pending,
- surface an approval/import failure to the user,
- emit no source acknowledgment.

### Bundle-repo

For `bundle-repo`, the destination should:

1. request the staged bundle artifact from the transfer sidecar,
2. materialize it to a temp file,
3. create or initialize a destination repo directory,
4. import the bundle into that repo,
5. resolve the resulting repo record,
6. proceed to task creation.

The destination repo should become a normal local git repo after import, not a transient unpacked transfer artifact.

## Local Repo Materialization Rules

### Destination repo path

For cloned or bundled repos, the destination should create a normal local repo path derived from the transferred repo name. The exact parent directory can follow Kanna’s existing import conventions, but it must not collide silently with an existing repo path.

Collision rule:

- if the preferred path already exists, allocate a deterministic suffixed path.

### Task creation

After repo acquisition, destination task creation should stay on the existing bootstrap path:

- import the repo record,
- call `createItem(...)`,
- use the transferred branch/base ref for worktree start point,
- create a fresh local task/worktree/session identity,
- then mark the incoming transfer completed.

## Sidecar And Tauri Boundary

### New transfer-sidecar responsibilities

The transfer sidecar should gain artifact staging support for bundle fallback:

- register outgoing transfer artifacts,
- expose a control path for artifact fetch by transfer id and artifact id,
- clean up artifacts when the transfer completes, fails, or expires.

### Desktop/Tauri responsibilities

The desktop/Tauri layer should own:

- deciding whether a bundle is needed,
- asking git to create it,
- telling the sidecar where the staged file lives,
- asking the sidecar to fetch the bundle on the destination,
- calling git commands to materialize the destination repo from the fetched bundle.

This keeps transport in the sidecar and git/repo orchestration in the desktop layer.

## Failure Handling

### Remote clone failure

If the destination cannot clone the repo:

- the incoming transfer stays pending,
- the destination does not create a local task,
- the source remains open,
- the user can retry or reject later.

### Bundle export failure

If the source cannot create or stage the bundle:

- outgoing commit preparation fails locally,
- no final payload commit is sent,
- the source task stays local and open.

### Bundle import failure

If the destination receives the payload but cannot materialize the bundle:

- no local task is created,
- the incoming transfer remains pending,
- no commit acknowledgment is sent to the source.

### Artifact cleanup

Staged bundle artifacts should be removed when:

- the transfer is committed successfully,
- the transfer is rejected,
- the transfer is canceled,
- the artifact expires.

Cleanup failure should be logged but must not retroactively invalidate a completed transfer.

## Testing

### Unit tests

Add coverage for:

- outgoing payload mode selection across `reuse-local`, `clone-remote`, and `bundle-repo`,
- persistence and parsing of bundle metadata in the payload,
- destination approval path for `clone-remote`,
- destination approval path for `bundle-repo`,
- error handling when clone or bundle import fails.

### Runtime/sidecar tests

Add task-transfer coverage for:

- transfer artifact registration and fetch,
- artifact cleanup behavior,
- bundle-related control messages and sidecar events if added.

### Real E2E

Add or extend real two-instance E2E for:

1. `clone-remote`
   - source pushes a task from a repo with a usable remote,
   - destination clones and imports,
   - source closes after success.

2. `bundle-repo`
   - source pushes a task from a repo without a usable remote,
   - source stages a bundle,
   - destination materializes the repo from the bundle and imports,
   - source closes after success.

3. acquisition failure
   - force clone or bundle import failure,
   - destination does not commit import,
   - source remains open.

## Out Of Scope

This phase explicitly does not include:

- pairing and trust UX,
- encrypted transport redesign,
- provider resume handoff,
- background repo deduplication across imported clones,
- large bundle optimization,
- partial branch filtering or shallow-history transfer tuning.
