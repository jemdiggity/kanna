#!/bin/sh
set -eu

repo_root="$(git rev-parse --show-toplevel)"
git_common_dir="$(git rev-parse --git-common-dir)"
main_repo_root="$(cd "${git_common_dir}/.." && pwd)"

mkdir -p "${repo_root}/.cargo"
printf "[build]\ntarget-dir = \".build\"\n" > "${repo_root}/.cargo/config.toml"

if [ -d "${main_repo_root}/.build" ] && [ ! -e "${repo_root}/.build" ]; then
  cp -c -R "${main_repo_root}/.build" "${repo_root}/.build"
fi
