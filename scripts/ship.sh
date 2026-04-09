#!/bin/bash
set -euo pipefail

STEP=""
cleanup() {
    if [[ -n "$STEP" ]]; then
        echo "Error: failed during: $STEP" >&2
    fi
    # Reset version files if we modified them but didn't finish
    if [[ "${VERSION_FILES_DIRTY:-false}" = true ]]; then
        echo "    Resetting version files..." >&2
        git -C "$ROOT" checkout -- VERSION apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/Cargo.toml 2>/dev/null || true
        # Cargo.lock may not have changed yet
        git -C "$ROOT" checkout -- apps/desktop/src-tauri/Cargo.lock 2>/dev/null || true
    fi
}
trap cleanup ERR

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT/.build"

read_current_version() {
    tr -d '[:space:]' < "$ROOT/VERSION"
}

read_tauri_version() {
    sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$ROOT/apps/desktop/src-tauri/tauri.conf.json" | head -1
}

read_cargo_version() {
    sed -n '1,/^version = /s/^version = "\([^"]*\)"/\1/p' "$ROOT/apps/desktop/src-tauri/Cargo.toml" | head -1
}

read_release_url() {
    gh release view "v$VERSION" --json url --jq '.url'
}

github_release_exists() {
    gh release view "v$VERSION" >/dev/null 2>&1
}

installer_arch_suffix() {
    case "$1" in
        arm64) echo "arm64" ;;
        x86_64) echo "x86_64" ;;
        *) echo "unknown architecture label: $1" >&2; exit 1 ;;
    esac
}

bazel_target_for_label() {
    local label="$1"
    if [[ "$DRY_RUN" = true ]]; then
        echo "//:kanna_signed_dmg_release_${label}"
    else
        echo "//:kanna_notarized_dmg_release_${label}"
    fi
}

bazel_output_for_label() {
    local label="$1"
    if [[ "$DRY_RUN" = true ]]; then
        echo "Kanna-${label}-signed.dmg"
    else
        echo "Kanna-${label}-notarized.dmg"
    fi
}

release_asset_name() {
    local label="$1"
    local suffix
    suffix="$(installer_arch_suffix "$label")"
    if [[ "$DRY_RUN" = true ]]; then
        echo "Kanna_${VERSION}_${suffix}-signed.dmg"
    else
        echo "Kanna_${VERSION}_${suffix}.dmg"
    fi
}

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Build, sign, notarize, and release a new version of Kanna with Bazel.

Options:
  --major    Bump major version (X.0.0)
  --minor    Bump minor version (0.X.0)
  --patch    Bump patch version (0.0.X) [default]
  --arm64    Build only arm64 (Apple Silicon)
  --x86_64   Build only x86_64 (Intel)
               (default: build both architectures)
  --release  Tag, push, and create GitHub release after building
  --dry-run  Build and sign but skip notarization and release
  --help     Show this help message

Prerequisites:
  - Clean git working directory (for --release)
  - bazel installed
  - Developer ID Application certificate installed
  - APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID env vars or APPLE_KEYCHAIN_PROFILE (for notarization)
  - gh CLI authenticated (for --release)

Examples:
  ./scripts/ship.sh                   # Build both architectures, sign, and notarize
  ./scripts/ship.sh --arm64           # Build arm64 only
  ./scripts/ship.sh --x86_64          # Build x86_64 only
  ./scripts/ship.sh --release         # Also tag, push, and create GitHub release
  ./scripts/ship.sh --minor --release # Minor version release
  ./scripts/ship.sh --dry-run         # Build and sign only (skip notarization)
EOF
    exit 0
}

# Parse arguments
DRY_RUN=false
RELEASE=false
BUMP="patch"
BUILD_ARM64=false
BUILD_X86_64=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --help|-h) usage ;;
        --major) BUMP="major"; shift ;;
        --minor) BUMP="minor"; shift ;;
        --patch) BUMP="patch"; shift ;;
        --arm64) BUILD_ARM64=true; shift ;;
        --x86_64) BUILD_X86_64=true; shift ;;
        --release) RELEASE=true; shift ;;
        --dry-run) DRY_RUN=true; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# Default: build both architectures
if [[ "$BUILD_ARM64" = false && "$BUILD_X86_64" = false ]]; then
    BUILD_ARM64=true
    BUILD_X86_64=true
fi

# Build arch arrays based on flags
ARCHS=()
ARCH_LABELS=()
if [[ "$BUILD_ARM64" = true ]]; then
    ARCHS+=(aarch64-apple-darwin)
    ARCH_LABELS+=(arm64)
fi
if [[ "$BUILD_X86_64" = true ]]; then
    ARCHS+=(x86_64-apple-darwin)
    ARCH_LABELS+=(x86_64)
fi

# --- Validate prerequisites ---

STEP="validating prerequisites"

# Clean git state (skip in dry-run — no tag/release happens)
if [[ "$DRY_RUN" = false ]]; then
    if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
        echo "Error: Working directory is not clean. Commit or stash changes first."
        exit 1
    fi

    # Must be up to date with origin/main (releases always target main)
    git -C "$ROOT" fetch --quiet origin main
    if ! git -C "$ROOT" merge-base --is-ancestor origin/main HEAD; then
        echo "Error: Your branch is behind origin/main. Merge or rebase first."
        exit 1
    fi
fi

# Required tools
for TOOL in bazel security codesign hdiutil xcrun; do
    if ! command -v "$TOOL" >/dev/null 2>&1; then
        echo "Error: Missing required tool: $TOOL"
        exit 1
    fi
done

# Developer ID certificate
DEVELOPER_ID=$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | awk -F'"' '{print $2}' || true)
if [[ -z "$DEVELOPER_ID" ]]; then
    echo "Error: No Developer ID Application certificate found."
    echo "Install your certificate or run 'security find-identity -v -p codesigning' to check."
    exit 1
else
    echo "    Signing identity: $DEVELOPER_ID"
    export APPLE_SIGNING_IDENTITY="$DEVELOPER_ID"
fi

# Notarization credentials (skip check in dry-run mode)
if [[ "$DRY_RUN" = false ]]; then
    MISSING_VARS=()
    if [[ -z "${APPLE_KEYCHAIN_PROFILE:-}" ]]; then
        [[ -z "${APPLE_ID:-}" ]] && MISSING_VARS+=("APPLE_ID")
        [[ -z "${APPLE_PASSWORD:-}" ]] && MISSING_VARS+=("APPLE_PASSWORD")
        [[ -z "${APPLE_TEAM_ID:-}" ]] && MISSING_VARS+=("APPLE_TEAM_ID")
    fi
    if [[ -z "${APPLE_KEYCHAIN_PROFILE:-}" && ${#MISSING_VARS[@]} -gt 0 ]]; then
        echo "Error: Missing notarization env vars: ${MISSING_VARS[*]}"
        echo "Set APPLE_ID, APPLE_PASSWORD (app-specific password), and APPLE_TEAM_ID,"
        echo "or set APPLE_KEYCHAIN_PROFILE."
        echo "Or use --dry-run to skip notarization."
        exit 1
    fi
fi

# gh CLI (only needed for --release)
if [[ "$RELEASE" = true ]]; then
    if ! command -v gh >/dev/null 2>&1; then
        echo "Error: gh CLI is required for --release."
        exit 1
    fi
    if ! gh auth status >/dev/null 2>&1; then
        echo "Error: gh CLI is not authenticated. Run 'gh auth login' first."
        exit 1
    fi
fi

echo "    Prerequisites OK"

# --- Bump version ---

STEP="bumping version"

# Fetch tags from origin so we don't miss versions pushed by other machines
git -C "$ROOT" fetch --quiet origin --tags

LAST_TAG=$(git -C "$ROOT" tag -l 'v*' --sort=-v:refname | head -1)
if [[ -z "$LAST_TAG" ]]; then
    LAST_VERSION="0.0.0"
else
    LAST_VERSION="${LAST_TAG#v}"
fi

IFS='.' read -r MAJOR MINOR PATCH <<< "$LAST_VERSION"

# Don't bump if the tag exists locally but was never pushed
if [[ -n "$LAST_TAG" ]] && ! git -C "$ROOT" ls-remote --tags origin "refs/tags/$LAST_TAG" | grep -q "$LAST_TAG"; then
    echo "    Tag $LAST_TAG exists locally but was never pushed — re-releasing $LAST_VERSION"
else
    case $BUMP in
        major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
        minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
        patch) PATCH=$((PATCH + 1)) ;;
    esac
fi

VERSION="$MAJOR.$MINOR.$PATCH"

echo "==> Shipping Kanna v$LAST_VERSION → v$VERSION"

CURRENT_VERSION=$(read_current_version)
CURRENT_TAURI_VERSION=$(read_tauri_version)
CURRENT_CARGO_VERSION=$(read_cargo_version)
VERSION_ALREADY_SYNCED=false
if [[ "$CURRENT_VERSION" = "$VERSION" && "$CURRENT_TAURI_VERSION" = "$VERSION" && "$CURRENT_CARGO_VERSION" = "$VERSION" ]]; then
    VERSION_ALREADY_SYNCED=true
fi

REMOTE_TAG_EXISTS=false
RELEASE_EXISTS=false

if [[ "$RELEASE" = true && "$VERSION_ALREADY_SYNCED" = true ]]; then
    LOCAL_TAG_EXISTS=false

    if git -C "$ROOT" tag -l "v$VERSION" | grep -q "v$VERSION"; then
        LOCAL_TAG_EXISTS=true
    fi
    if git -C "$ROOT" ls-remote --tags origin "refs/tags/v$VERSION" | grep -q "v$VERSION"; then
        REMOTE_TAG_EXISTS=true
    fi
    if github_release_exists; then
        RELEASE_EXISTS=true
    fi

    if [[ "$REMOTE_TAG_EXISTS" = true || "$RELEASE_EXISTS" = true ]]; then
        echo "==> Continuing release retry for Kanna v$VERSION"
        echo "    Local tag: $LOCAL_TAG_EXISTS"
        echo "    Remote tag: $REMOTE_TAG_EXISTS"
        echo "    GitHub release: $RELEASE_EXISTS"
        if [[ "$RELEASE_EXISTS" = true ]]; then
            echo "    $(read_release_url)"
        fi
    fi

    echo "    Version files already match v$VERSION; continuing as a release retry"
fi

# --- Sync version files ---

STEP="syncing version files"
VERSION_FILES_DIRTY=true

# Write VERSION file
echo "$VERSION" > "$ROOT/VERSION"

# Update tauri.conf.json (semver only)
TAURI_CONF="$ROOT/apps/desktop/src-tauri/tauri.conf.json"
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$TAURI_CONF"

# Update Cargo.toml [package] version (first version = line only)
CARGO_TOML="$ROOT/apps/desktop/src-tauri/Cargo.toml"
sed -i '' "1,/^version = /s/^version = \"[^\"]*\"/version = \"$VERSION\"/" "$CARGO_TOML"

echo "    Version files updated to $VERSION"

# --- Build artifacts with Bazel ---

DMG_PATHS=()
RELEASE_DIR="$BUILD_DIR/release"
mkdir -p "$RELEASE_DIR"

STEP="building release artifacts"
TARGETS=()
for LABEL in "${ARCH_LABELS[@]}"; do
    TARGETS+=("$(bazel_target_for_label "$LABEL")")
done

BAZEL_ARGS=(-c opt)
if [[ "$DRY_RUN" = false ]]; then
    BAZEL_ARGS=(--config=notarize "${BAZEL_ARGS[@]}")
fi

echo "    Building via Bazel: ${TARGETS[*]}"
(
    cd "$ROOT"
    bazel build "${BAZEL_ARGS[@]}" "${TARGETS[@]}"
)

BAZEL_BIN="$(cd "$ROOT" && bazel info bazel-bin)"

for LABEL in "${ARCH_LABELS[@]}"; do
    STEP="collecting artifact ($LABEL)"
    DMG_SOURCE="$BAZEL_BIN/release/$(bazel_output_for_label "$LABEL")"
    if [[ ! -f "$DMG_SOURCE" ]]; then
        echo "Error: Expected Bazel output not found: $DMG_SOURCE"
        exit 1
    fi

    DMG_NAME="$(release_asset_name "$LABEL")"
    DMG_DEST="$RELEASE_DIR/$DMG_NAME"
    cp "$DMG_SOURCE" "$DMG_DEST"
    DMG_PATHS+=("$DMG_DEST")

    echo "    Built: $DMG_NAME"
done

# Version files were intentionally modified — don't reset on success
VERSION_FILES_DIRTY=false

# --- Release ---

if [[ "$RELEASE" = true ]]; then
    if git -C "$ROOT" ls-remote --tags origin "refs/tags/v$VERSION" | grep -q "v$VERSION"; then
        REMOTE_TAG_EXISTS=true
    fi
    if github_release_exists; then
        RELEASE_EXISTS=true
    fi

    if [[ "$REMOTE_TAG_EXISTS" = false ]]; then
        STEP="committing version bump"
        echo "    Committing version bump..."
        git -C "$ROOT" add -f VERSION apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock
        if git -C "$ROOT" diff --cached --quiet; then
            echo "    No version file changes to commit; reusing existing HEAD for v$VERSION"
        else
            git -C "$ROOT" commit -m "release: v$VERSION"
        fi

        STEP="tagging and pushing"
        echo "    Tagging v$VERSION..."
        if ! git -C "$ROOT" tag -l "v$VERSION" | grep -q "v$VERSION"; then
            git -C "$ROOT" tag "v$VERSION"
        fi

        # Fast-forward main to include the version bump, then push main + tag.
        # This works because the worktree branch started from main with no diverging commits.
        CURRENT_BRANCH=$(git -C "$ROOT" symbolic-ref --short HEAD)
        if [[ "$CURRENT_BRANCH" != "main" ]]; then
            echo "    Fast-forwarding main to include release commit..."
            git -C "$ROOT" fetch origin main --quiet
            RELEASE_COMMIT=$(git -C "$ROOT" rev-parse HEAD)
            # Verify main is an ancestor (worktree didn't diverge)
            if ! git -C "$ROOT" merge-base --is-ancestor origin/main "$RELEASE_COMMIT"; then
                echo "Error: main has diverged from this branch. Merge main first."
                exit 1
            fi
            git -C "$ROOT" push origin "$RELEASE_COMMIT:refs/heads/main" --tags
        else
            git -C "$ROOT" push origin main --tags
        fi
    else
        echo "    Reusing existing remote tag v$VERSION"
    fi

    if [[ "$RELEASE_EXISTS" = true ]]; then
        STEP="uploading GitHub release assets"
        echo "    Updating GitHub release assets..."
        gh release upload "v$VERSION" "${DMG_PATHS[@]}" --clobber
    else
        STEP="creating GitHub release"
        echo "    Creating GitHub release..."
        gh release create "v$VERSION" "${DMG_PATHS[@]}" \
            --title "Kanna v$VERSION" \
            --generate-notes
    fi

    echo "==> Shipped Kanna v$VERSION"
    echo "    $(read_release_url)"
else
    echo "==> Built Kanna v$VERSION"
    for DMG in "${DMG_PATHS[@]}"; do
        echo "    DMG: $DMG"
    done
    echo "    Run with --release to tag and publish to GitHub"
fi
