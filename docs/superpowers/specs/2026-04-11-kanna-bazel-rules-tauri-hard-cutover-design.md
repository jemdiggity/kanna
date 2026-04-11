# Kanna Bazel `rules_tauri` Hard Cutover Design

## Goal

Replace Kanna's current desktop Bazel build with a hermetic, deterministic graph that follows the upstream `rules_tauri` `examples/tauri_with_vite` architecture.

The immediate milestone is narrow:

- produce an unsigned macOS `.app` for `apps/desktop` from Bazel-managed inputs
- remove host-machine dependencies from the Bazel build path
- align the frontend, Rust, and Tauri bundle seams with the upstream example

This design does not try to preserve existing Bazel target names or the current custom release graph. Those can be rebuilt afterward on top of the cleaned-up app bundle path.

## Problem

The current Bazel integration is not hermetic even though it uses Bazel:

- `tools/bazel/extensions.bzl` imports host `bun`, `node`, `zig`, and `~/.cargo`
- `tools/bazel/defs.bzl` shells out through host `bun` and `node`
- `tools/bazel/build_frontend_dist.py` reconstructs a temporary workspace and runs `bun x vue-tsc` and `bun x vite`
- the root build graph contains custom packaging rules layered on top of this host-backed frontend path

That means successful builds depend on machine-local binaries, machine-local package state, and machine-local Rust setup. The result is not deterministic in the sense intended by the upstream `rules_tauri` example.

## Constraints

- Follow the upstream `rules_tauri` example shape rather than preserving the current Kanna-specific Bazel wrappers.
- Keep using Bazel for Rust compilation and `rules_tauri` app assembly.
- Treat target renames and Bazel graph breakage as acceptable during the cutover.
- Preserve the desktop application's runtime behavior; the build-system reset must not change app functionality.
- Keep the first success boundary at the unsigned `.app`, which matches `rules_tauri`'s stated scope.

## Approaches Considered

### 1. Incremental retrofit

Replace host-backed internals while preserving the current top-level target structure and helper macros.

Pros:

- less visible churn
- smaller initial diff in root `BUILD.bazel`

Cons:

- keeps custom wrappers that already encode the wrong architecture
- makes it harder to verify real alignment with the upstream example
- risks leaving hidden host dependencies in place

### 2. Hybrid cutover

Adopt the upstream example's frontend and Tauri build shape while keeping Kanna's custom release and packaging layer in place.

Pros:

- fixes the main hermeticity problem
- preserves some current release entry points

Cons:

- still carries custom graph shape during the most fragile part of the migration
- mixes cleanup with compatibility work

### 3. Hard reset to the upstream example shape

Rebuild the desktop Bazel graph almost from scratch around the upstream `examples/tauri_with_vite` structure, then reattach release packaging later.

Pros:

- clearest architectural reset
- easiest to reason about during review
- strongest guarantee that host-backed helpers are actually gone

Cons:

- highest short-term churn
- temporarily breaks existing Bazel target names and release entry points

## Decision

Use approach 3.

Kanna will replace its current desktop Bazel build path with a graph modeled directly on the upstream `rules_tauri` example:

- Bazel-managed JS dependencies for the frontend
- a Bazel-owned Vite `dist` target in `apps/desktop`
- a rebuilt `apps/desktop/src-tauri` Rust target path that consumes Bazel-produced frontend assets and Tauri metadata
- `tauri_bundle_inputs` and `tauri_macos_app` as the app assembly boundary

The current host-backed helper layer under `tools/bazel/` is treated as disposable unless a piece is still needed strictly for post-`.app` release work.

## Target Architecture

### Frontend

`apps/desktop/BUILD.bazel` will match the example structurally:

- Bazel links JS packages through the Bazel JS rules ecosystem
- a `srcs` filegroup captures frontend inputs excluding generated outputs
- a Bazel-run Vite binary produces `dist`

The build must not call host `bun` or host `node` discovered from `PATH`.

`vue-tsc` checking is not part of the first cutover unless it can be expressed through the same hermetic JS toolchain path. The primary milestone is deterministic frontend asset production for Tauri embedding.

### Rust and Tauri codegen

`apps/desktop/src-tauri/BUILD.bazel` will be rewritten to follow the upstream example's flow:

- `cargo_srcs`, `icons`, `capabilities`, and `tauri_build_data` filegroups define the Rust-side inputs
- `cargo_build_script` becomes the seam where Bazel hands controlled inputs to Tauri compile-time behavior
- the Rust library and binary consume that build script output

Where Kanna currently depends on local sidecar copies or custom environment injection, the build graph should be rebuilt around Bazel-produced outputs and example-style data dependencies.

If Kanna needs Bazel-owned embedded frontend assets the same way the upstream example does, that seam should be adopted explicitly rather than simulated through ad hoc `TAURI_CONFIG` overrides.

### App assembly

The first complete Bazel outcome is:

- arch-specific desktop binary target
- arch-specific `tauri_bundle_inputs`
- arch-specific unsigned `.app` target via `tauri_macos_app`

Root aliases may be reintroduced later, but the desktop package should be directly buildable at its own package boundary first.

### Release packaging after cutover

Code signing, DMG creation, notarization, and `ship.sh` integration are postponed until after the unsigned `.app` path is green.

Any existing custom rules for those steps should be evaluated only after the app assembly path is rebuilt. They are downstream concerns and should not shape the core app build architecture.

## Files Expected To Change

Likely delete or replace:

- `tools/bazel/extensions.bzl`
- large parts of `tools/bazel/defs.bzl`
- `tools/bazel/build_frontend_dist.py`
- current Bazel frontend wiring in the root `BUILD.bazel`
- `apps/desktop/BUILD.bazel`
- `apps/desktop/src-tauri/BUILD.bazel`

Likely add or rework:

- Bazel JS dependency declarations needed to mirror the upstream example
- desktop-specific platform transition helpers only if still required for per-arch binaries
- a simplified root `BUILD.bazel` that wraps rebuilt desktop targets instead of implementing the frontend path itself

## Verification

The cutover is complete when all of the following are true:

1. The desktop frontend `dist` is produced by Bazel-managed JS tooling rather than host-discovered `bun` or `node`.
2. `bazel build` can produce an unsigned Kanna macOS `.app` from the rebuilt desktop graph.
3. The action graph for that path no longer depends on host `~/.cargo`, host `bun`, or host `node` repository shims.
4. The resulting app bundle contains the expected Kanna metadata, icons, resources, and sidecars for the selected target triple.

## Risks

### Tauri build-script integration

Kanna's `build.rs` and sidecar/resource layout are more complex than the upstream example. The cutover may expose additional upstream Tauri seams that the current workaround-based graph was masking.

### JS dependency migration

The repo currently uses pnpm at the workspace level. The Bazel JS dependency path must respect that source of truth while still matching the example's hermetic build pattern.

### Temporary release breakage

Because the cutover intentionally does not preserve the current root target graph, release and signing targets may be broken until the unsigned `.app` path is restored and wrapped again.

## Non-Goals

- preserving existing Bazel target names
- preserving the current release packaging graph during the cutover
- solving notarization or signing as part of the first milestone
- changing application behavior unrelated to the build system
