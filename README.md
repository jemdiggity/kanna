# Kanna

Keyboard-centric macOS app for running Claude CLI in worktrees.
Upgrade from tmux.

## Features

- Run multiple agent tasks in parallel, each in an isolated git worktree
- Real-time terminal with full Claude TUI
- Built-in diff viewer (branch, last commit, or working changes)
- One-click PR creation and merge
- PTY daemon survives app restarts
- Multi-repo support

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/jemdiggity/kanna/main/scripts/install.sh | sh
```

Requires [Claude CLI](https://docs.anthropic.com/en/docs/claude-code).

## Bazel Build

Unsigned desktop app:

```sh
bazel build //:kanna_app_arm64
```

Optional release-shaped unsigned app:

```sh
bazel build //:kanna_app_release_arm64
```

Optional x86_64 release app:

```sh
bazel build //:kanna_app_release_x86_64
```

This path now follows the `rules_tauri` Tauri + Vite + Vue example shape:

- Bazel builds the frontend dist at `//apps/desktop:dist`
- Bazel builds the Rust/Tauri binary at `//apps/desktop/src-tauri:kanna_desktop`
- `rules_tauri` assembles the unsigned macOS `.app`

Release packaging remains available on top of that app graph:

```sh
bazel build -c opt //:release_apps
bazel build -c opt //:release_signed_dmgs
bazel build --config=notarize -c opt //:release
```

Release outputs land in `bazel-bin/release/`:

- `Kanna-arm64-notarized.dmg`
- `Kanna-x86_64-notarized.dmg`

Local cache reuse across worktrees is enabled via a shared Bazel disk cache in `~/.bazelrc`.

For notarization, export either:

- `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID`
- or `APPLE_KEYCHAIN_PROFILE`

Then run the `--config=notarize` build from that shell so Bazel forwards the credentials into the notarization actions.

The release script now uses the Bazel graph too:

```sh
./scripts/ship.sh --dry-run
./scripts/ship.sh --release
```

GitHub Actions now validates the unsigned Bazel release apps on macOS and also analyzes the signed DMG graph on every PR and `main` push via [.github/workflows/release-bazel.yml](.github/workflows/release-bazel.yml).

## License

[MIT](LICENSE)
