#!/usr/bin/env python3

import argparse
import os
import shutil
import subprocess
import tempfile
from pathlib import Path


DEFAULT_WINDOW_POS = (10, 60)
DEFAULT_WINDOW_SIZE = (500, 350)
DEFAULT_ICON_SIZE = 128
DEFAULT_TEXT_SIZE = 16


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--volume-name", required=True)
    parser.add_argument("--include-applications-link", action="store_true")
    return parser.parse_args()


def parse_icon_positions(entries: list[str]) -> dict[str, tuple[int, int]]:
    positions: dict[str, tuple[int, int]] = {}
    for entry in entries:
        try:
            name, raw_coords = entry.split(":", 1)
            raw_x, raw_y = raw_coords.split(",", 1)
        except ValueError as exc:
            raise SystemExit(f"invalid icon position: {entry}") from exc
        positions[name] = (int(raw_x), int(raw_y))
    return positions


def copy_staged_item(source: Path, destination: Path) -> None:
    if source.is_symlink():
        os.symlink(os.readlink(source), destination)
    elif source.is_dir():
        shutil.copytree(source, destination, symlinks=False)
    else:
        shutil.copy2(source, destination, follow_symlinks=False)


def build_applescript(
    *,
    volume_name: str,
    window_pos: tuple[int, int],
    window_size: tuple[int, int],
    icon_size: int,
    text_size: int,
    icon_positions: dict[str, tuple[int, int]],
) -> str:
    position_lines = "\n".join(
        f'            set position of item "{name}" to {{{x}, {y}}}'
        for name, (x, y) in icon_positions.items()
    )
    return f"""on run (volumeName)
    tell application "Finder"
        tell disk (volumeName as string)
            open
            set theXOrigin to {window_pos[0]}
            set theYOrigin to {window_pos[1]}
            set theWidth to {window_size[0]}
            set theHeight to {window_size[1]}
            set dsStore to "\\"/Volumes/" & volumeName & "/.DS_Store\\""
            tell container window
                set current view to icon view
                set toolbar visible to false
                set statusbar visible to false
                set the bounds to {{theXOrigin, theYOrigin, theXOrigin + theWidth, theYOrigin + theHeight}}
            end tell
            tell the icon view options of container window
                set icon size to {icon_size}
                set text size to {text_size}
                set arrangement to not arranged
            end tell
{position_lines}
        end tell
    end tell
end run
"""


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
                copy_staged_item(child, destination)
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
