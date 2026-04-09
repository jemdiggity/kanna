#!/usr/bin/env python3

import argparse
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path


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


def absolute_path(path: str) -> Path:
    candidate = Path(path)
    if candidate.is_absolute():
        return candidate
    return Path(os.path.abspath(candidate))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-manifest", required=True)
    parser.add_argument("--package-dir", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--bun", required=True)
    args = parser.parse_args()

    out_dir = Path(args.out_dir).resolve()
    out_dir.parent.mkdir(parents=True, exist_ok=True)

    env = dict(os.environ)
    home = Path(env.get("TMPDIR", "/tmp")) / "kanna-bazel-home"
    home.mkdir(parents=True, exist_ok=True)
    env["HOME"] = str(home)
    bun_path = absolute_path(args.bun)
    path_entries = [
        str(bun_path.parent),
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ]
    env["PATH"] = ":".join(entry for entry in path_entries if entry)

    source_entries = json.loads(Path(args.source_manifest).read_text())

    with tempfile.TemporaryDirectory(prefix="kanna-bazel-frontend-") as tmpdir:
        workspace_root = Path(tmpdir) / "workspace"
        workspace_root.mkdir(parents=True, exist_ok=True)
        copy_entries(source_entries, workspace_root)

        package_dir = workspace_root / args.package_dir
        subprocess.run([str(bun_path), "x", "vue-tsc", "--noEmit"], cwd=package_dir, env=env, check=True)
        subprocess.run(
            [str(bun_path), "x", "vite", "build", "--outDir", str(out_dir), "--emptyOutDir"],
            cwd=package_dir,
            env=env,
            check=True,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
