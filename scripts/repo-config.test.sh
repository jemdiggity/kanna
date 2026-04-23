#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$ROOT_DIR/.kanna/config.json"

assert_contains() {
  local needle="$1"
  if ! grep -Fq "$needle" "$CONFIG"; then
    printf 'expected %s to contain:\n%s\n' "$CONFIG" "$needle" >&2
    exit 1
  fi
}

assert_contains "\"/bin/sh ./scripts/setup-worktree.sh\""
assert_contains "\"/bin/bash ./scripts/dev.sh stop -k\""
assert_contains "\"/bin/bash ./scripts/clean.sh --all\""
assert_contains "\"\$schema\": \"https://schemas.kanna.build/config.schema.json\""
assert_contains "\"workspace\""
assert_contains "\"prepend\": [\"./node_modules/.bin\"]"
