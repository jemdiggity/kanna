# Rules Tauri Release Design

## Goal

Define a standalone `rules_tauri` Bazel repository whose v1 scope is narrow and exact:

- accept already-built frontend assets, Rust binaries, sidecars, and Tauri metadata,
- assemble a deterministic macOS `.app` bundle for one target triple,
- stop at the unsigned `.app` boundary.

Everything after `.app` creation, including code signing, DMG creation, notarization, stapling, and release upload, is intentionally outside `rules_tauri`.

## Why This Exists

Kanna's development workflow is already fast enough with Bun, Vite, and Tauri CLI. The release path is the problem:

- dry-run and release should not trigger different compilation work,
- release builds should reuse the exact same compiled artifacts,
- the release graph should be deterministic and Bazel-owned,
- Tauri CLI should not remain the release orchestrator.

The right first-class Bazel boundary is not "replace Vite" or "replace Bun for dev." The right boundary is "replace Tauri's release-build assembly path with explicit Bazel rules."

## Scope

### In scope

- standalone `rules_tauri` repository
- Bzlmod-first module layout
- macOS release assembly only
- separate `arm64` and `x86_64` outputs
- deterministic bundle input normalization
- deterministic unsigned `.app` assembly
- Tauri-specific interpretation of config/resources/sidecars

### Out of scope

- `tauri dev`
- Bun/Vite development workflow
- universal binaries or universal `.app` bundles
- DMG creation
- code signing
- notarization or stapling
- GitHub release upload
- Windows or Linux packaging

## Non-Goals

- `rules_tauri` is not a general JS bundler ruleset.
- `rules_tauri` is not responsible for running Vite. It accepts `frontend_dist` as an input.
- `rules_tauri` is not responsible for compiling Rust. It accepts `main_binary` and `sidecars` as inputs.
- `rules_tauri` is not a drop-in replacement for the entire Tauri CLI.

## Boundary

The design boundary is:

1. other Bazel rules produce frontend assets, Rust binaries, icons, and resources
2. `rules_tauri` turns those inputs into an unsigned `.app`
3. non-Tauri macOS release rules handle signing, DMG, notarization, and publishing

This keeps `rules_tauri` narrowly Tauri-specific instead of allowing Apple packaging concerns to leak into it.

## Upstream Tauri Contract To Preserve

The v1 rules should be grounded in the current upstream Tauri implementation rather than a greenfield reinterpretation of what a Tauri app "probably" means.

The relevant upstream implementation lives primarily in:

- `crates/tauri-bundler/src/bundle/macos/app.rs`
- `crates/tauri-bundler/src/bundle/macos/icon.rs`
- `crates/tauri-bundler/src/bundle/settings.rs`
- `crates/tauri-build/src/lib.rs`
- `crates/tauri-codegen/src/context.rs`
- `crates/tauri-utils/src/config.rs`
- `crates/tauri-utils/src/resources.rs`

### Compile-time asset model

Upstream Tauri treats `build.frontendDist` as the release asset source and `build.devUrl` as the development source of truth.

- In dev mode with `devUrl`, Tauri does not embed built frontend assets.
- In release mode with `frontendDist`, Tauri embeds or packages files from the configured directory or file list.
- `frontendDist` is validated relative to the config parent directory, and a missing path is a hard failure.

For `rules_tauri`, this means:

- `frontend_dist` is the correct rule input name and should remain bundler-agnostic.
- the rule should assume the caller already produced release-ready assets.
- dev-server concerns must stay out of the API.

### Resource path normalization

Upstream Tauri has explicit resource path mapping behavior.

- plain resource lists preserve directory structure under the bundle resource directory
- mapped resources allow custom destination prefixes
- glob handling differs between list and map modes
- absolute roots and parent-directory traversals are normalized into synthetic path segments such as `_root_` and `_up_`

For `rules_tauri`, this means:

- resource path mapping must be deterministic and compatible with the current Tauri layout contract
- the manifest format should preserve both source and normalized target paths
- callers should not have to guess how relative and absolute resource paths are rewritten

### External binary / sidecar staging

Upstream Tauri expects configured external binaries to exist with a target-triple suffix such as:

- `my-sidecar-x86_64-apple-darwin`
- `my-sidecar-aarch64-apple-darwin`

At build/bundle time, Tauri strips the target-triple suffix when staging those binaries into the final output.

For `rules_tauri`, this means:

- the public rule should accept already-built sidecar artifacts
- target-triple compatibility must be validated explicitly
- final staged names inside the app bundle should not retain the target suffix unless the runtime actually expects it

### macOS bundle assembly behavior

Upstream macOS bundling currently performs the following steps:

- remove any existing `.app` output directory
- create `Contents`, `Contents/Resources`, and `Contents/MacOS`
- generate or copy icon artifacts (`.icns`, optionally `Assets.car`)
- generate `Info.plist`
- copy frameworks
- copy resources
- copy external binaries / sidecars
- copy declared app binaries
- copy custom `macOS.files` entries into `Contents`
- only after that, perform signing and notarization

For `rules_tauri`, this means:

- the unsigned `.app` output is a natural, upstream-aligned boundary
- the v1 implementation should reproduce the pre-signing assembly steps only
- signing, DMG creation, notarization, and stapling should remain out of scope

### `Info.plist` generation and merge semantics

Upstream Tauri synthesizes a default `Info.plist` and then overlays user-provided plist values.

Important generated keys include:

- `CFBundleDisplayName`
- `CFBundleExecutable`
- `CFBundleIdentifier`
- `CFBundleName`
- `CFBundleShortVersionString`
- `CFBundleVersion`
- `LSMinimumSystemVersion`
- icon-related keys
- file association keys
- deep link protocol keys

User-provided plist data is merged last and wins on key collisions.

For `rules_tauri`, this means:

- plist generation should be deterministic and data-driven
- plist fragments or custom plist data must be applied after generated defaults
- `version` and macOS bundle-version data should be independent inputs, not inferred from mutated source files

### macOS custom files

Upstream `bundle.macos.files` copies user-declared files and directories into `Contents`, and absolute destination paths are normalized by stripping the leading slash before staging.

For `rules_tauri`, this means:

- the rule should support app-bundle-relative file injection
- destination normalization must be explicit and deterministic

### Framework handling

Upstream Tauri supports bundling `.framework` directories, `.dylib` files, and named frameworks resolved from standard macOS framework locations.

For `rules_tauri`, this means:

- framework handling is part of the `.app` assembly contract, not a post-processing concern
- framework copying belongs in `tauri_bundle_inputs` / `tauri_macos_app`, even if signing does not

## Implications For V1 Rule Design

The upstream behavior suggests a sharper v1 than the initial design alone:

- `tauri_bundle_inputs` should normalize resources, sidecars, frameworks, icons, plist inputs, and custom `Contents` files into a manifest-backed staging tree
- `tauri_macos_app` should assemble the unsigned `.app` from that normalized tree without signing
- `rules_tauri` should not attempt to emulate `tauri dev`, `beforeBuildCommand`, or runtime asset embedding behavior beyond consuming `frontend_dist`
- release-specific concerns after `.app` creation should remain outside the repository

## Repository Layout

The standalone repository should look like this:

```text
rules_tauri/
  .bazelversion
  AGENTS.md
  LICENSE
  MODULE.bazel
  README.md
  WORKSPACE
  docs/
    design.md
    rules.md
    testing.md
  examples/
    minimal_macos/
      BUILD.bazel
      MODULE.bazel
      src/
    tauri_with_vite/
      BUILD.bazel
      MODULE.bazel
      src/
  private/
    bundle_inputs.bzl
    macos_app.bzl
    plist.bzl
    manifest.bzl
    paths.bzl
  tauri/
    defs.bzl
    providers.bzl
  test/
    e2e/
    unit/
  tools/
    make_manifest.py
    make_plist.py
```

### Repository conventions

- Public API lives only in `//tauri:defs.bzl` and `//tauri:providers.bzl`.
- Implementation details live under `//private`.
- Examples are part of the repo contract and must remain green.
- The repository is designed for Bazel Central Registry publication from the start.

## Public API

V1 exposes exactly two public rules:

- `tauri_bundle_inputs`
- `tauri_macos_app`

The consumer-facing load path is:

```starlark
load("@rules_tauri//tauri:defs.bzl", "tauri_bundle_inputs", "tauri_macos_app")
```

No other `.bzl` files are public API.

## Rule: `tauri_bundle_inputs`

### Purpose

Normalize all Tauri-specific packaging inputs into a deterministic bundle input tree and manifest for a single target triple.

This is the most important rule in the repository because it defines the stable handoff between "build artifacts" and "Tauri app assembly."

### Inputs

- `frontend_dist`
  - label for a directory containing already-built web assets
- `main_binary`
  - label for the already-built application executable for one target triple
- `sidecars`
  - list of already-built sidecar binaries for the same target triple
- `resources`
  - optional extra bundled resources
- `icons`
  - optional icon files used in the app bundle
- `tauri_config`
  - the app's `tauri.conf.json` or a generated equivalent
- `capabilities`
  - optional capability / permissions files consumed by the packaged app
- `entitlements`
  - optional macOS entitlements plist copied into the bundle metadata output set
- `info_plist_fragments`
  - optional plist fragments merged into the generated `Info.plist`
- `bundle_id`
  - canonical bundle identifier
- `product_name`
  - app display name and bundle executable name
- `version`
  - release version string passed as rule data, not by mutating checked-in files
- `target_triple`
  - one of `aarch64-apple-darwin` or `x86_64-apple-darwin`

### Outputs

- `bundle_inputs_dir`
  - deterministic directory tree containing the normalized bundle payload
- `bundle_manifest.json`
  - manifest of every staged file, destination path, and metadata
- generated `Info.plist`
  - resolved plist after merging config and fragments

### Provider

The rule returns `TauriBundleInfo` with:

- `bundle_inputs_dir`
- `bundle_manifest`
- `main_binary`
- `sidecars`
- `bundle_id`
- `product_name`
- `version`
- `target_triple`
- `info_plist`
- `entitlements`

### Notes

- `tauri_bundle_inputs` does not compile anything.
- `tauri_bundle_inputs` does not sign anything.
- `tauri_bundle_inputs` must reject cross-triple mismatches between `main_binary`, `sidecars`, and `target_triple`.
- `tauri_bundle_inputs` must not rely on absolute paths from the source repository because those break Bazel sandboxing.

## Rule: `tauri_macos_app`

### Purpose

Assemble an unsigned macOS `.app` bundle from `TauriBundleInfo`.

### Inputs

- `bundle`
  - target providing `TauriBundleInfo`

### Outputs

- unsigned `.app` directory tree
- app manifest describing the final bundle layout

### Provider

The rule returns `MacosAppBundleInfo` with:

- `app_bundle`
- `bundle_id`
- `product_name`
- `version`
- `target_triple`
- `info_plist`
- `manifest`

### Notes

- `tauri_macos_app` must not sign the app.
- `tauri_macos_app` must not create a DMG.
- `tauri_macos_app` must produce a stable layout regardless of whether the caller later chooses a dry-run or a release flow.

## Bundle Layout Contract

The app assembly layer should produce a standard macOS bundle with the Tauri payload in deterministic locations.

Illustrative layout:

```text
Kanna.app/
  Contents/
    Info.plist
    MacOS/
      Kanna
    Resources/
      frontend/
      icons/
      resources/
      tauri/
      sidecars/
```

The exact destination paths should match what the packaged runtime expects, not whatever is easiest for the rule implementation.

## Example Target Graph

For Kanna, the intended graph is:

- `//release:web_dist`
- `//release:kanna_binary_arm64`
- `//release:kanna_binary_x86_64`
- `//release:sidecars_arm64`
- `//release:sidecars_x86_64`
- `//release:bundle_inputs_arm64`
- `//release:bundle_inputs_x86_64`
- `//release:app_arm64`
- `//release:app_x86_64`

Release rules outside `rules_tauri` then consume `app_arm64` and `app_x86_64` independently:

- `//release:signed_app_arm64`
- `//release:signed_app_x86_64`
- `//release:dmg_arm64`
- `//release:dmg_x86_64`
- `//release:notarized_dmg_arm64`
- `//release:notarized_dmg_x86_64`

## AGENTS.md

The standalone repository should include an `AGENTS.md` with concise rules for contributors and coding agents.

Proposed contents:

```md
# AGENTS.md

## Scope

`rules_tauri` owns Tauri-specific release assembly only. It stops at an unsigned macOS `.app`.

Do not expand the scope to code signing, DMG creation, notarization, or dev workflow support unless the change is explicitly intended to broaden the public contract.

## Public API

Public API lives only in:

- `//tauri:defs.bzl`
- `//tauri:providers.bzl`

Everything under `//private` is implementation detail and may be refactored freely.

## Stability

- Preserve Bzlmod compatibility.
- Preserve Bazel Central Registry publishability.
- Prefer additive API changes over breaking ones.

## Testing

- Keep `examples/` green.
- Add or update tests for bundle layout changes.
- Verify rule outputs are deterministic.
```

## Testing Strategy

### Unit tests

- manifest generation
- plist merging
- path normalization
- sidecar staging
- bundle layout generation

### End-to-end tests

- minimal app assembles into an unsigned `.app`
- both `arm64` and `x86_64` examples produce expected outputs
- output manifests are stable across repeated builds

## Release Integration

`rules_tauri` deliberately produces inputs for a later macOS release layer.

That later layer may use:

- `rules_apple`
- `apple_support`
- custom macOS release rules

but those concerns are separate from `rules_tauri` itself.

## Why Vite Is Not In The API

Vite is commonly used with Tauri, but it is not part of Tauri's packaging contract. In this design:

- Vite can be used upstream to create `frontend_dist`,
- another bundler can be used instead,
- or a repository can provide static assets directly.

`rules_tauri` should remain agnostic.

## Open Questions

- Which exact subset of `tauri.conf.json` fields should be interpreted by v1 rules versus passed through as opaque data?
- Should `capabilities` remain raw file inputs, or should the rule expose a typed helper for them later?
- Should icon processing stay in `rules_tauri`, or should callers always supply pre-normalized icon files?

These questions do not block v1 because the core contract is already clear: assemble deterministic unsigned `.app` bundles from prebuilt inputs.
