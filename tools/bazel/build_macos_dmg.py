#!/usr/bin/env python3

import argparse
import os
import shutil
import subprocess
import tempfile
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--volume-name", required=True)
    parser.add_argument("--include-applications-link", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    app_path = Path(args.app).resolve()
    output_path = Path(args.output).resolve()

    if not app_path.exists():
        raise SystemExit(f"app does not exist: {app_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="kanna-dmg-") as temp_dir:
        staging_dir = Path(temp_dir) / "staging"
        staging_dir.mkdir()
        mounted_dmg = Path(temp_dir) / "mounted.dmg"
        compressed_dmg = Path(temp_dir) / "compressed.dmg"
        mount_dir = Path(temp_dir) / "mount"
        mount_dir.mkdir()

        staged_app = staging_dir / app_path.name
        shutil.copytree(app_path, staged_app, symlinks=False)

        if args.include_applications_link:
            os.symlink("/Applications", staging_dir / "Applications")

        du_output = subprocess.check_output(["du", "-sk", str(staging_dir)], text=True)
        staging_size_kb = int(du_output.split()[0])
        image_size_kb = max(10240, int(staging_size_kb * 1.25) + 10240)

        create_command = [
            "hdiutil",
            "create",
            "-size",
            f"{image_size_kb}k",
            "-fs",
            "HFS+",
            "-volname",
            args.volume_name,
            "-ov",
            str(mounted_dmg),
        ]
        subprocess.run(create_command, check=True)

        attach_command = [
            "hdiutil",
            "attach",
            str(mounted_dmg),
            "-mountpoint",
            str(mount_dir),
            "-nobrowse",
            "-quiet",
        ]
        subprocess.run(attach_command, check=True)

        try:
            for child in staging_dir.iterdir():
                destination = mount_dir / child.name
                if child.is_symlink():
                    os.symlink(os.readlink(child), destination)
                elif child.is_dir():
                    shutil.copytree(child, destination, symlinks=False)
                else:
                    shutil.copy2(child, destination, follow_symlinks=False)
        finally:
            subprocess.run(["hdiutil", "detach", str(mount_dir), "-quiet"], check=True)

        convert_command = [
            "hdiutil",
            "convert",
            str(mounted_dmg),
            "-format",
            "UDZO",
            "-ov",
            "-o",
            str(compressed_dmg),
        ]
        subprocess.run(convert_command, check=True)
        shutil.move(compressed_dmg, output_path)


if __name__ == "__main__":
    main()
