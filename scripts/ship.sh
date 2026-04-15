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
HOME_BAZELRC="${HOME}/.bazelrc"

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

read_release_metadata_json() {
    gh release view "v$VERSION" --json body,publishedAt
}

installer_arch_suffix() {
    case "$1" in
        arm64) echo "arm64" ;;
        x86_64) echo "x86_64" ;;
        *) echo "unknown architecture label: $1" >&2; exit 1 ;;
    esac
}

updater_asset_name() {
    local label="$1"
    local suffix
    suffix="$(installer_arch_suffix "$label")"
    echo "Kanna_${VERSION}_${suffix}.app.tar.gz"
}

updater_signature_name() {
    local label="$1"
    local suffix
    suffix="$(installer_arch_suffix "$label")"
    echo "Kanna_${VERSION}_${suffix}.app.tar.gz.sig"
}

updater_platform_key() {
    case "$1" in
        arm64) echo "darwin-aarch64" ;;
        x86_64) echo "darwin-x86_64" ;;
        *) echo "unknown updater platform for $1" >&2; exit 1 ;;
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

signed_app_target_for_label() {
    local label="$1"
    case "$label" in
        arm64) echo "//:kanna_signed_app_release_arm64" ;;
        x86_64) echo "//:kanna_signed_app_release_x86_64" ;;
        *) echo "unknown app target for $label" >&2; exit 1 ;;
    esac
}

resolve_bazel_output() {
    local target="$1"
    local output
    output="$(
        cd "$ROOT" &&
        bazel cquery "${BAZEL_ARGS[@]}" "$target" --output=files | tail -1
    )"
    if [[ -z "$output" ]]; then
        echo "Error: Bazel did not report an output file for $target" >&2
        exit 1
    fi
    echo "$ROOT/$output"
}

release_asset_name() {
    local label="$1"
    local suffix
    suffix="$(installer_arch_suffix "$label")"
    echo "Kanna_${VERSION}_${suffix}.dmg"
}

release_repo_slug() {
    local remote_url
    remote_url="$(git -C "$ROOT" remote get-url origin)"
    case "$remote_url" in
        git@github.com:*)
            remote_url="${remote_url#git@github.com:}"
            ;;
        ssh://git@github.com/*)
            remote_url="${remote_url#ssh://git@github.com/}"
            ;;
        https://github.com/*)
            remote_url="${remote_url#https://github.com/}"
            ;;
        *)
            echo "Error: Unsupported GitHub remote URL: $remote_url" >&2
            exit 1
            ;;
    esac
    echo "${remote_url%.git}"
}

release_download_base_url() {
    echo "https://github.com/$(release_repo_slug)/releases/download/v$VERSION"
}

create_updater_bundle() {
    local app_source="$1"
    local bundle_dest="$2"
    local app_dir
    app_dir="$(dirname "$app_source")"
    rm -f "$bundle_dest"
    tar -C "$app_dir" -czf "$bundle_dest" "$(basename "$app_source")"
}

sign_updater_bundle() {
    local bundle_path="$1"
    local signature_path="$2"
    local generated_sig="${bundle_path}.sig"
    local signer_args=(pnpm --dir "$ROOT/apps/desktop" exec tauri signer sign --private-key-path "$TAURI_PRIVATE_KEY_PATH")
    rm -f "$signature_path" "$generated_sig"
    if [[ -n "${TAURI_PRIVATE_KEY_PASSWORD+x}" ]]; then
        signer_args+=(--password "${TAURI_PRIVATE_KEY_PASSWORD:-}")
    fi
    signer_args+=("$bundle_path")
    "${signer_args[@]}" >/dev/null
    if [[ ! -f "$generated_sig" ]]; then
        echo "Error: Expected updater signature not found: $generated_sig"
        exit 1
    fi
    mv "$generated_sig" "$signature_path"
}

read_release_metadata_field() {
    local metadata_json="$1"
    local field_name="$2"
    FIELD_NAME="$field_name" RELEASE_METADATA_JSON="$metadata_json" node -e '
const metadata = JSON.parse(process.env.RELEASE_METADATA_JSON);
process.stdout.write(String(metadata[process.env.FIELD_NAME] ?? ""));
'
}

load_release_metadata() {
    local release_metadata_json
    release_metadata_json="$(read_release_metadata_json)"
    RELEASE_BODY="$(read_release_metadata_field "$release_metadata_json" body)"
    RELEASE_PUBLISHED_AT="$(read_release_metadata_field "$release_metadata_json" publishedAt)"
}

write_latest_json() {
    local notes="$1"
    local published_at="$2"
    RELEASE_NOTES="$notes" \
    PUBLISHED_AT="$published_at" \
    UPDATER_PLATFORMS_JSON="$UPDATER_PLATFORMS_JSON" \
    VERSION="$VERSION" \
    node <<'EOF' > "$LATEST_JSON"
const version = process.env.VERSION;
const notes = process.env.RELEASE_NOTES;
const pubDate = process.env.PUBLISHED_AT;
const platforms = JSON.parse(process.env.UPDATER_PLATFORMS_JSON);
process.stdout.write(
  JSON.stringify(
    {
      version,
      notes,
      pub_date: pubDate,
      platforms,
    },
    null,
    2,
  ) + "\n",
);
EOF
}

bazel_cache_configured() {
    if [[ ! -f "$HOME_BAZELRC" ]]; then
        return 1
    fi

    grep -Eq -- '--disk_cache=|--repository_cache=' "$HOME_BAZELRC"
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
for TOOL in bazel security codesign hdiutil xcrun node pnpm; do
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

if [[ -z "${KANNA_UPDATER_PUBKEY:-}" ]]; then
    echo "Error: Missing KANNA_UPDATER_PUBKEY."
    exit 1
fi

if [[ -z "${TAURI_PRIVATE_KEY_PATH:-}" ]]; then
    echo "Error: Missing TAURI_PRIVATE_KEY_PATH."
    exit 1
fi

if [[ ! -f "$TAURI_PRIVATE_KEY_PATH" ]]; then
    echo "Error: Tauri updater private key not found: $TAURI_PRIVATE_KEY_PATH"
    exit 1
fi

if [[ "$RELEASE" = true && ${#ARCH_LABELS[@]} -ne 2 ]]; then
    echo "Error: updater releases must include both arm64 and x86_64 artifacts"
    exit 1
fi

echo "    Prerequisites OK"

if ! bazel_cache_configured; then
    echo "    Note: shared Bazel caches are not configured in $HOME_BAZELRC"
    echo "          For faster, more space-efficient release builds across worktrees, add:"
    echo "          build --disk_cache=$HOME/Library/Caches/bazel-disk-cache"
    echo "          build --repository_cache=$HOME/Library/Caches/bazel-repository-cache"
fi

# --- Bump version ---

STEP="bumping version"

SOURCE_VERSION=$(read_current_version)
IFS='.' read -r MAJOR MINOR PATCH <<< "$SOURCE_VERSION"

# Fetch tags from origin so release retry checks see the latest remote state.
git -C "$ROOT" fetch --quiet origin --tags

case $BUMP in
    major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
    minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
    patch) PATCH=$((PATCH + 1)) ;;
esac

VERSION="$MAJOR.$MINOR.$PATCH"

echo "==> Shipping Kanna v$SOURCE_VERSION → v$VERSION"

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
UPDATER_PATHS=()
RELEASE_DIR="$BUILD_DIR/release"
mkdir -p "$RELEASE_DIR"

STEP="building release artifacts"
TARGETS=()
for LABEL in "${ARCH_LABELS[@]}"; do
    TARGETS+=("$(bazel_target_for_label "$LABEL")")
    TARGETS+=("$(signed_app_target_for_label "$LABEL")")
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

for LABEL in "${ARCH_LABELS[@]}"; do
    STEP="collecting artifact ($LABEL)"
    TARGET="$(bazel_target_for_label "$LABEL")"
    DMG_SOURCE="$(resolve_bazel_output "$TARGET")"
    if [[ ! -f "$DMG_SOURCE" ]]; then
        echo "Error: Expected Bazel output not found: $DMG_SOURCE"
        exit 1
    fi

    DMG_NAME="$(release_asset_name "$LABEL")"
    DMG_DEST="$RELEASE_DIR/$DMG_NAME"
    rm -f "$DMG_DEST"
    cp "$DMG_SOURCE" "$DMG_DEST"
    DMG_PATHS+=("$DMG_DEST")

    echo "    Built: $DMG_NAME"
done

STEP="creating updater artifacts"
GENERATED_RELEASE_NOTES=""
RELEASE_BODY=""
RELEASE_PUBLISHED_AT=""
if [[ "$RELEASE" = true ]]; then
    GENERATED_RELEASE_NOTES="$(
        gh api "repos/$(release_repo_slug)/releases/generate-notes" \
            -X POST \
            -f tag_name="v$VERSION" \
            -f target_commitish="main" \
            --jq '.body'
    )"
else
    RELEASE_BODY="Dry-run updater manifest for v$VERSION"
    RELEASE_PUBLISHED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
fi

URL_DARWIN_AARCH64=""
SIG_DARWIN_AARCH64=""
URL_DARWIN_X86_64=""
SIG_DARWIN_X86_64=""

for LABEL in "${ARCH_LABELS[@]}"; do
    APP_SOURCE="$(resolve_bazel_output "$(signed_app_target_for_label "$LABEL")")"
    if [[ ! -d "$APP_SOURCE" ]]; then
        echo "Error: Expected signed app bundle not found: $APP_SOURCE"
        exit 1
    fi

    BUNDLE_NAME="$(updater_asset_name "$LABEL")"
    BUNDLE_PATH="$RELEASE_DIR/$BUNDLE_NAME"
    SIG_NAME="$(updater_signature_name "$LABEL")"
    SIG_PATH="$RELEASE_DIR/$SIG_NAME"
    create_updater_bundle "$APP_SOURCE" "$BUNDLE_PATH"
    sign_updater_bundle "$BUNDLE_PATH" "$SIG_PATH"
    UPDATER_PATHS+=("$BUNDLE_PATH" "$SIG_PATH")

    PLATFORM_KEY="$(updater_platform_key "$LABEL")"
    BUNDLE_URL="$(release_download_base_url)/$BUNDLE_NAME"
    SIGNATURE_VALUE="$(tr -d '\n' < "$SIG_PATH")"

    case "$PLATFORM_KEY" in
        darwin-aarch64)
            URL_DARWIN_AARCH64="$BUNDLE_URL"
            SIG_DARWIN_AARCH64="$SIGNATURE_VALUE"
            ;;
        darwin-x86_64)
            URL_DARWIN_X86_64="$BUNDLE_URL"
            SIG_DARWIN_X86_64="$SIGNATURE_VALUE"
            ;;
    esac

    echo "    Built: $BUNDLE_NAME"
    echo "    Signed: $SIG_NAME"
done

LATEST_JSON="$RELEASE_DIR/latest.json"
UPDATER_PLATFORMS_JSON="$(
    URL_DARWIN_AARCH64="$URL_DARWIN_AARCH64" \
    SIG_DARWIN_AARCH64="$SIG_DARWIN_AARCH64" \
    URL_DARWIN_X86_64="$URL_DARWIN_X86_64" \
    SIG_DARWIN_X86_64="$SIG_DARWIN_X86_64" \
    node <<'EOF'
const candidates = [
  ["darwin-aarch64", process.env.URL_DARWIN_AARCH64, process.env.SIG_DARWIN_AARCH64],
  ["darwin-x86_64", process.env.URL_DARWIN_X86_64, process.env.SIG_DARWIN_X86_64],
];
const platforms = Object.fromEntries(
  candidates
    .filter(([, url, signature]) => Boolean(url) && Boolean(signature))
    .map(([key, url, signature]) => [key, { signature, url }]),
);
process.stdout.write(JSON.stringify(platforms));
EOF
)"

if [[ "$RELEASE" = false ]]; then
    write_latest_json "$RELEASE_BODY" "$RELEASE_PUBLISHED_AT"
    echo "    Built: latest.json"
fi

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
        STEP="reading GitHub release metadata"
        load_release_metadata
        write_latest_json "$RELEASE_BODY" "$RELEASE_PUBLISHED_AT"
        echo "    Built: latest.json"

        STEP="uploading GitHub release assets"
        echo "    Updating GitHub release assets..."
        gh release upload "v$VERSION" "${DMG_PATHS[@]}" "${UPDATER_PATHS[@]}" "$LATEST_JSON" --clobber
    else
        STEP="creating GitHub release"
        echo "    Creating GitHub release..."
        gh release create "v$VERSION" "${DMG_PATHS[@]}" "${UPDATER_PATHS[@]}" \
            --title "Kanna v$VERSION" \
            --notes "$GENERATED_RELEASE_NOTES"

        STEP="reading GitHub release metadata"
        load_release_metadata
        write_latest_json "$RELEASE_BODY" "$RELEASE_PUBLISHED_AT"
        echo "    Built: latest.json"

        STEP="uploading GitHub release manifest"
        echo "    Uploading latest.json..."
        gh release upload "v$VERSION" "$LATEST_JSON" --clobber
    fi

    echo "==> Shipped Kanna v$VERSION"
    echo "    $(read_release_url)"
else
    echo "==> Built Kanna v$VERSION"
    for DMG in "${DMG_PATHS[@]}"; do
        echo "    DMG: $DMG"
    done
    for UPDATER_ASSET in "${UPDATER_PATHS[@]}"; do
        echo "    Updater: $UPDATER_ASSET"
    done
    echo "    Manifest: $LATEST_JSON"
    echo "    Run with --release to tag and publish to GitHub"
fi
