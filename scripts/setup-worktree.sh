#!/bin/sh
set -eu

repo_root="$(git rev-parse --show-toplevel)"
mkdir -p "${repo_root}/.cargo"
printf "[build]\ntarget-dir = \".build\"\nbuild-dir = \"%s/Library/Caches/kanna/rust-build\"\n" "$HOME" > "${repo_root}/.cargo/config.toml"
