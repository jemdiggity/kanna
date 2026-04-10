#!/bin/bash
# Verify (and optionally install) all prerequisites for developing Kanna.
#
# Usage:
#   ./scripts/setup.sh           # check prereqs + install dependencies
#   ./scripts/setup.sh --check   # check prereqs only (no install)
set -e

CHECK_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=true ;;
  esac
done

PASS=0
WARN=0
FAIL=0

pass() { PASS=$((PASS + 1)); printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { WARN=$((WARN + 1)); printf "  \033[33m!\033[0m %s\n" "$1"; }
fail() { FAIL=$((FAIL + 1)); printf "  \033[31m✗\033[0m %s\n" "$1"; }

section() { printf "\n\033[1m%s\033[0m\n" "$1"; }

# ── Required tools ──────────────────────────────────────────────────

section "Required tools"

# Xcode Command Line Tools (macOS — provides clang, WebKit, macOS SDK)
if xcode-select -p &>/dev/null; then
  pass "Xcode Command Line Tools"
else
  fail "Xcode Command Line Tools — install with: xcode-select --install"
fi

# Rust / Cargo
if command -v rustc &>/dev/null; then
  rust_ver="$(rustc --version | awk '{print $2}')"
  pass "Rust $rust_ver"
else
  fail "Rust — install from https://rustup.rs"
fi

if command -v cargo &>/dev/null; then
  pass "Cargo"
else
  fail "Cargo — comes with Rust, install from https://rustup.rs"
fi

# Node.js
NODE_REQUIRED="22.0.0"
if command -v node &>/dev/null; then
  node_ver="$(node --version | sed 's/^v//')"
  if printf '%s\n%s\n' "$NODE_REQUIRED" "$node_ver" | sort -V | head -n1 | grep -qx "$NODE_REQUIRED"; then
    pass "Node.js $node_ver (>= $NODE_REQUIRED)"
  else
    fail "Node.js $node_ver is too old — need >= $NODE_REQUIRED. Update from https://nodejs.org/"
  fi
else
  fail "Node.js — install from https://nodejs.org/"
fi

# pnpm
PNPM_REQUIRED="10.8.1"
if command -v pnpm &>/dev/null; then
  pnpm_ver="$(pnpm --version)"
  if printf '%s\n%s\n' "$PNPM_REQUIRED" "$pnpm_ver" | sort -V | head -n1 | grep -qx "$PNPM_REQUIRED"; then
    pass "pnpm $pnpm_ver (>= $PNPM_REQUIRED)"
  else
    fail "pnpm $pnpm_ver is too old — need >= $PNPM_REQUIRED. Update with: corepack prepare pnpm@${PNPM_REQUIRED} --activate"
  fi
else
  fail "pnpm — install with: corepack enable && corepack prepare pnpm@${PNPM_REQUIRED} --activate"
fi

# Bazelisk / Bazel
if command -v bazelisk &>/dev/null; then
  bazel_ver="$(bazelisk version | sed -n 's/^Build label: //p' | head -1)"
  if [ -n "$bazel_ver" ]; then
    pass "Bazelisk/Bazel $bazel_ver"
  else
    pass "Bazelisk"
  fi
elif command -v bazel &>/dev/null; then
  bazel_ver="$(bazel version | sed -n 's/^Build label: //p' | head -1)"
  if [ -n "$bazel_ver" ]; then
    pass "Bazel $bazel_ver"
  else
    pass "Bazel"
  fi
else
  fail "Bazelisk/Bazel — install with: brew install bazelisk"
fi

# Git
if command -v git &>/dev/null; then
  git_ver="$(git --version | awk '{print $3}')"
  pass "Git $git_ver"
else
  fail "Git — install with: brew install git"
fi

# Zig (needed by libghostty-vt-sys during the Rust build)
if command -v zig &>/dev/null; then
  zig_ver="$(zig version)"
  pass "Zig $zig_ver"
else
  fail "Zig — install from https://ziglang.org/download/ or with: brew install zig"
fi

# tmux (used by dev.sh)
if command -v tmux &>/dev/null; then
  tmux_ver="$(tmux -V | awk '{print $2}')"
  pass "tmux $tmux_ver"
else
  fail "tmux — install with: brew install tmux"
fi

# ── Optional tools ──────────────────────────────────────────────────

section "Optional tools"

# Claude CLI (needed for integration tests and agent tasks)
if command -v claude &>/dev/null; then
  pass "Claude CLI"
else
  warn "Claude CLI not found — needed for integration tests and agent tasks"
fi

# x86_64 OpenSSL (needed for cross-compiling x86_64 builds on arm64 Macs)
if [[ "$(uname -m)" = "arm64" ]]; then
  if [[ -d "/usr/local/opt/openssl@3" ]]; then
    pass "x86_64 OpenSSL (for cross-compile)"
  else
    warn "x86_64 OpenSSL not found — needed for x86_64 cross-compile in ship.sh"
    warn "  Install with: arch -x86_64 /usr/local/bin/brew install openssl@3"
  fi
fi

# ── Dependencies ────────────────────────────────────────────────────

section "Dependencies"

if [ "$CHECK_ONLY" = true ]; then
  if [ -d "node_modules" ]; then
    pass "node_modules present (skipping install — --check mode)"
  else
    warn "node_modules missing — run without --check to install"
  fi
else
  if [ "$FAIL" -gt 0 ]; then
    printf "\n\033[31mFix the issues above before installing dependencies.\033[0m\n"
  else
    printf "  Installing dependencies with pnpm...\n"
    pnpm install
    pass "pnpm install (includes Tauri CLI via @tauri-apps/cli)"
  fi
fi

# ── Summary ─────────────────────────────────────────────────────────

section "Summary"
printf "  %s passed, %s warnings, %s failed\n" "$PASS" "$WARN" "$FAIL"

if [ "$FAIL" -gt 0 ]; then
  printf "\n\033[31mSome required tools are missing. See above for install instructions.\033[0m\n"
  exit 1
fi

if [ "$CHECK_ONLY" = false ] && [ "$FAIL" -eq 0 ]; then
  printf "\n\033[32mReady! Start the dev server with: ./scripts/dev.sh\033[0m\n"
fi
