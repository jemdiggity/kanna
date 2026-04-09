#!/usr/bin/env python3

import argparse
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional


def copy_entries(entries: list[dict[str, str]], workspace_root: Path) -> None:
    for entry in entries:
        source = Path(entry["source"])
        destination = workspace_root / entry["dest"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source.is_symlink() and "node_modules" in Path(entry["dest"]).parts:
            target = os.readlink(source)
            if destination.exists() or destination.is_symlink():
                destination.unlink()
            destination.symlink_to(target)
        else:
            shutil.copy2(source.resolve(), destination)


def copy_tree(source: Path, destination: Path) -> None:
    for path in source.rglob("*"):
        if path.is_dir():
            continue
        relative = path.relative_to(source)
        dest_path = destination / relative
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        if path.is_symlink() and "node_modules" in relative.parts:
            target = os.readlink(path)
            if dest_path.exists() or dest_path.is_symlink():
                dest_path.unlink()
            dest_path.symlink_to(target)
        else:
            shutil.copy2(path.resolve(), dest_path)


def absolute_path(path: str) -> Path:
    candidate = Path(path)
    if candidate.is_absolute():
        return candidate
    return Path(os.path.abspath(candidate))


def resolve_against(base: Path, path: str) -> Path:
    candidate = Path(path)
    if candidate.is_absolute():
        return candidate
    return base / candidate


def resolve_execroot_path(path: str) -> Path:
    candidate = Path(path)
    if candidate.is_absolute():
        return candidate
    direct = absolute_path(path)
    if direct.exists():
        return direct
    external = absolute_path(os.path.join("external", path))
    if external.exists():
        return external
    return direct


def copy_tree_contents(source: Path, destination: Path) -> None:
    if not source.exists():
        return
    for path in source.rglob("*"):
        relative = path.relative_to(source)
        target = destination / relative
        if path.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        if path.is_symlink():
            link_target = os.readlink(path)
            if target.exists() or target.is_symlink():
                target.unlink()
            target.symlink_to(link_target)
        else:
            shutil.copy2(path, target)


def load_manifest(path: Optional[str]) -> list[dict[str, str]]:
    if not path:
        return []
    return json.loads(Path(path).read_text())


def toolchain_dest(source: Path) -> Path:
    parts = source.parts
    if "external" in parts:
        external_index = parts.index("external")
        if external_index + 2 < len(parts):
            return Path(*parts[external_index + 2 :])
    raise ValueError(f"unable to derive toolchain-relative path for {source}")


def copy_toolchain_entries(entries: list[dict[str, str]], destination_root: Path) -> None:
    for entry in entries:
        source = Path(entry["source"])
        destination = destination_root / toolchain_dest(source)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-manifest", required=True)
    parser.add_argument("--stage-manifest", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--built-binary-name", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--cargo", required=True)
    parser.add_argument("--rustc", required=True)
    parser.add_argument("--cargo-home-marker", required=True)
    parser.add_argument("--zig", required=True)
    parser.add_argument("--zig-lib-dir", required=True)
    parser.add_argument("--rustc-lib-manifest", required=True)
    parser.add_argument("--host-rust-std-manifest", required=True)
    parser.add_argument("--target-rust-std-manifest")
    parser.add_argument("--target-triple")
    parser.add_argument("--frontend-dist")
    parser.add_argument("--frontend-dist-dest")
    parser.add_argument("--locked", action="store_true")
    args = parser.parse_args()

    source_entries = json.loads(Path(args.source_manifest).read_text())
    stage_entries = json.loads(Path(args.stage_manifest).read_text())
    rustc_lib_entries = load_manifest(args.rustc_lib_manifest)
    host_rust_std_entries = load_manifest(args.host_rust_std_manifest)
    target_rust_std_entries = load_manifest(args.target_rust_std_manifest)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="kanna-bazel-cargo-") as tmpdir:
        workspace_root = Path(tmpdir) / "workspace"
        workspace_root.mkdir(parents=True, exist_ok=True)
        temp_home = Path(tmpdir) / "home"
        temp_home.mkdir(parents=True, exist_ok=True)
        xdg_cache_home = temp_home / ".cache"
        xdg_cache_home.mkdir(parents=True, exist_ok=True)
        zig_global_cache_dir = xdg_cache_home / "zig"
        zig_global_cache_dir.mkdir(parents=True, exist_ok=True)
        zig_local_cache_dir = Path(tmpdir) / "zig-local-cache"
        zig_local_cache_dir.mkdir(parents=True, exist_ok=True)

        copy_entries(source_entries, workspace_root)
        copy_entries(stage_entries, workspace_root)

        if args.frontend_dist and args.frontend_dist_dest:
            copy_tree(Path(args.frontend_dist), workspace_root / args.frontend_dist_dest)

        cargo_target_dir = Path(tmpdir) / "cargo-target"
        env = dict(os.environ)
        cargo_path = absolute_path(args.cargo)
        rustc_path = absolute_path(args.rustc)
        cargo_home = absolute_path(args.cargo_home_marker).parent.parent
        zig_path = absolute_path(args.zig)
        zig_lib_dir = resolve_execroot_path(args.zig_lib_dir)
        env["CARGO_TARGET_DIR"] = str(cargo_target_dir)
        env["HOME"] = str(temp_home)
        env["CARGO_HOME"] = str(cargo_home)
        env["RUSTC"] = str(rustc_path)
        env["XDG_CACHE_HOME"] = str(xdg_cache_home)
        env["ZIG_LIB_DIR"] = str(zig_lib_dir)
        env["ZIG_GLOBAL_CACHE_DIR"] = str(zig_global_cache_dir)
        env["ZIG_LOCAL_CACHE_DIR"] = str(zig_local_cache_dir)
        env.setdefault("KANNA_BUILD_BRANCH", "")
        env.setdefault("KANNA_BUILD_COMMIT", "")
        env.setdefault("KANNA_BUILD_WORKTREE", "")
        path_entries = [
            str(cargo_path.parent),
            str(rustc_path.parent),
            str(zig_path.parent),
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ]
        env["PATH"] = ":".join(entry for entry in path_entries if entry)

        if args.target_triple and target_rust_std_entries:
            sysroot = Path(tmpdir) / "rust-sysroot"
            copy_toolchain_entries(rustc_lib_entries, sysroot)
            copy_toolchain_entries(host_rust_std_entries, sysroot)
            copy_toolchain_entries(target_rust_std_entries, sysroot)
            existing_rustflags = env.get("RUSTFLAGS", "").strip()
            sysroot_flag = f"--sysroot={sysroot}"
            env["RUSTFLAGS"] = (
                f"{existing_rustflags} {sysroot_flag}".strip()
                if existing_rustflags
                else sysroot_flag
            )

        command = [str(cargo_path), "build"]
        if args.profile == "release":
            command.append("--release")
        if args.target_triple:
            command.extend(["--target", args.target_triple])
        if args.locked:
            command.append("--locked")
        command.extend(["--manifest-path", args.manifest])

        subprocess.run(command, cwd=workspace_root, env=env, check=True)

        profile_dir = "release" if args.profile == "release" else "debug"
        binary_path = cargo_target_dir
        if args.target_triple:
            binary_path = binary_path / args.target_triple
        binary_path = binary_path / profile_dir / args.built_binary_name

        if not binary_path.exists():
            raise SystemExit(f"expected cargo binary at {binary_path}")

        shutil.copy2(binary_path, output)
        output.chmod(binary_path.stat().st_mode)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
