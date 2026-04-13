# Bazel DMG Finder Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Bazel-built macOS DMGs mount with the same normal Finder installer-style view as Tauri-built DMGs.

**Architecture:** Keep Bazel DMG packaging inside `tools/bazel/`, but extend the `macos_dmg` rule so it can pass Finder layout metadata into the DMG builder script. Refactor `tools/bazel/build_macos_dmg.py` into testable helpers, then add the missing Finder-facing packaging steps: volume icon staging, `SetFile` metadata, AppleScript-driven `.DS_Store` generation, and mounted-DMG verification.

**Tech Stack:** Bazel Starlark rules, Python 3, macOS `hdiutil`, `osascript`, `SetFile`, Finder `.DS_Store` metadata

---

## File Map

- `tools/bazel/build_macos_dmg.py`
  Responsibility: build the DMG, stage contents, apply Finder metadata, and compress the final image.
- `tools/bazel/build_macos_dmg_test.py`
  Responsibility: unit-test the DMG builder's deterministic helpers without mounting a DMG.
- `tools/bazel/defs.bzl`
  Responsibility: expose DMG layout attributes on the `macos_dmg` rule and forward them to the script.
- `BUILD.bazel`
  Responsibility: configure the release DMG targets with the shared icon and Finder layout coordinates.

### Task 1: Add test coverage and helper boundaries for the DMG builder

**Files:**
- Create: `tools/bazel/build_macos_dmg_test.py`
- Modify: `tools/bazel/build_macos_dmg.py`

- [ ] **Step 1: Write the failing helper tests**

```python
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_macos_dmg


class BuildMacosDmgTest(unittest.TestCase):
    def test_parse_icon_positions_rejects_missing_separator(self) -> None:
        with self.assertRaises(SystemExit):
            build_macos_dmg.parse_icon_positions(["Kanna.app:160"])

    def test_parse_icon_positions_parses_named_coordinates(self) -> None:
        self.assertEqual(
            build_macos_dmg.parse_icon_positions(
                ["Kanna.app:160,175", "Applications:352,175"]
            ),
            {
                "Kanna.app": (160, 175),
                "Applications": (352, 175),
            },
        )

    def test_build_applescript_includes_window_and_icon_clauses(self) -> None:
        script = build_macos_dmg.build_applescript(
            volume_name="Kanna",
            window_pos=(10, 60),
            window_size=(500, 350),
            icon_size=128,
            text_size=16,
            icon_positions={
                "Kanna.app": (160, 175),
                "Applications": (352, 175),
            },
        )
        self.assertIn('set position of item "Kanna.app" to {160, 175}', script)
        self.assertIn('set position of item "Applications" to {352, 175}', script)
        self.assertIn("set icon size to 128", script)
        self.assertIn('set dsStore to "\\"/Volumes/" & volumeName & "/.DS_Store\\""', script)

    def test_copy_staged_item_preserves_symlinks(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source_file = root / "source.txt"
            source_file.write_text("kanna", encoding="utf-8")
            source_link = root / "Applications"
            source_link.symlink_to("/Applications")
            dest_link = root / "Applications.copy"
            build_macos_dmg.copy_staged_item(source_link, dest_link)
            self.assertTrue(dest_link.is_symlink())
            self.assertEqual(dest_link.readlink(), Path("/Applications"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail against the current script**

Run: `python3 -m unittest tools/bazel/build_macos_dmg_test.py -v`
Expected: `ERROR` because `parse_icon_positions`, `build_applescript`, and `copy_staged_item` do not exist yet.

- [ ] **Step 3: Refactor the script into importable helpers with stable defaults**

```python
DEFAULT_WINDOW_POS = (10, 60)
DEFAULT_WINDOW_SIZE = (500, 350)
DEFAULT_ICON_SIZE = 128
DEFAULT_TEXT_SIZE = 16


def parse_icon_positions(entries: list[str]) -> dict[str, tuple[int, int]]:
    positions: dict[str, tuple[int, int]] = {}
    for entry in entries:
        name, raw_coords = entry.split(":", 1)
        raw_x, raw_y = raw_coords.split(",", 1)
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
```

- [ ] **Step 4: Re-run the helper tests**

Run: `python3 -m unittest tools/bazel/build_macos_dmg_test.py -v`
Expected: `OK`

- [ ] **Step 5: Commit the helper refactor**

```bash
git add tools/bazel/build_macos_dmg.py tools/bazel/build_macos_dmg_test.py
git commit -m "test: cover bazel dmg layout helpers"
```

### Task 2: Extend the Bazel rule and release targets with DMG layout inputs

**Files:**
- Modify: `tools/bazel/defs.bzl`
- Modify: `BUILD.bazel`

- [ ] **Step 1: Write the failing build query expectation**

Run: `bazel query //:kanna_dmg_release_arm64 --output=build | sed -n '1,40p'`
Expected: the emitted rule block shows only `app`, `output_name`, and `volume_name`, with no volume icon or icon position arguments.

- [ ] **Step 2: Add new `macos_dmg` rule attributes in `tools/bazel/defs.bzl`**

```python
    if ctx.file.volume_icon:
        args.add("--volume-icon", ctx.file.volume_icon.path)
    if ctx.attr.window_pos:
        args.add("--window-pos", ",".join([str(value) for value in ctx.attr.window_pos]))
    if ctx.attr.window_size:
        args.add("--window-size", ",".join([str(value) for value in ctx.attr.window_size]))
    if ctx.attr.icon_size:
        args.add("--icon-size", str(ctx.attr.icon_size))
    if ctx.attr.text_size:
        args.add("--text-size", str(ctx.attr.text_size))
    for name, coords in sorted(ctx.attr.icon_positions.items()):
        parts = coords.split(",")
        if len(parts) != 2:
            fail("icon_positions[%s] must be formatted as x,y" % name)
        args.add("--icon-position", "%s:%s,%s" % (name, parts[0], parts[1]))

    ctx.actions.run_shell(
        inputs = depset(direct = [app, tool] + ([ctx.file.volume_icon] if ctx.file.volume_icon else [])),
```

```python
macos_dmg = rule(
    implementation = _macos_dmg_impl,
    attrs = {
        "app": attr.label(mandatory = True),
        "output_name": attr.string(mandatory = True),
        "volume_name": attr.string(mandatory = True),
        "volume_icon": attr.label(allow_single_file = [".icns"]),
        "window_pos": attr.int_list(default = [10, 60]),
        "window_size": attr.int_list(default = [500, 350]),
        "icon_size": attr.int(default = 128),
        "text_size": attr.int(default = 16),
        "icon_positions": attr.string_dict(default = {
            "Kanna.app": "160,175",
            "Applications": "352,175",
        }),
        "include_applications_link": attr.bool(default = True),
```
- [ ] **Step 3: Configure both release DMG targets in `BUILD.bazel`**

```python
macos_dmg(
    name = "kanna_dmg_release_arm64",
    app = ":kanna_signed_app_release_arm64",
    output_name = "release/Kanna-arm64.dmg",
    volume_name = "Kanna",
    volume_icon = ":desktop_macos_icon",
    window_pos = [10, 60],
    window_size = [500, 350],
    icon_size = 128,
    text_size = 16,
    icon_positions = {
        "Applications": "352,175",
        "Kanna.app": "160,175",
    },
)
```

```python
macos_dmg(
    name = "kanna_dmg_release_x86_64",
    app = ":kanna_signed_app_release_x86_64",
    output_name = "release/Kanna-x86_64.dmg",
    volume_name = "Kanna",
    volume_icon = ":desktop_macos_icon",
    window_pos = [10, 60],
    window_size = [500, 350],
    icon_size = 128,
    text_size = 16,
    icon_positions = {
        "Applications": "352,175",
        "Kanna.app": "160,175",
    },
)
```

- [ ] **Step 4: Verify the release target now carries the new configuration**

Run: `bazel query //:kanna_dmg_release_arm64 --output=build | sed -n '1,60p'`
Expected: the emitted rule block includes `volume_icon`, `window_pos`, `window_size`, `icon_size`, `text_size`, and `icon_positions`.

- [ ] **Step 5: Commit the Bazel rule wiring**

```bash
git add tools/bazel/defs.bzl BUILD.bazel
git commit -m "build: wire bazel dmg finder layout inputs"
```

### Task 3: Implement Finder cosmetics in the DMG builder and verify the mounted output

**Files:**
- Modify: `tools/bazel/build_macos_dmg.py`
- Test: `tools/bazel/build_macos_dmg_test.py`

- [ ] **Step 1: Extend CLI parsing to accept the new DMG presentation inputs**

```python
    parser.add_argument("--volume-icon")
    parser.add_argument("--window-pos", default="10,60")
    parser.add_argument("--window-size", default="500,350")
    parser.add_argument("--icon-size", type=int, default=128)
    parser.add_argument("--text-size", type=int, default=16)
    parser.add_argument("--icon-position", action="append", default=[])
```

- [ ] **Step 2: Add macOS tool wrappers with explicit failures**

```python
def run_checked(command: list[str]) -> None:
    subprocess.run(command, check=True)


def require_tool(name: str) -> str:
    tool_path = shutil.which(name)
    if tool_path is None:
        raise SystemExit(f"required tool not found in PATH: {name}")
    return tool_path


def mark_volume_icon(mount_dir: Path, icon_path: Path) -> None:
    setfile = require_tool("SetFile")
    staged_icon = mount_dir / ".VolumeIcon.icns"
    shutil.copy2(icon_path, staged_icon)
    run_checked([setfile, "-c", "icnC", str(staged_icon)])
    run_checked([setfile, "-a", "C", str(mount_dir)])
```

- [ ] **Step 3: Run Finder to write `.DS_Store` after staged contents are copied**

```python
def run_finder_layout(
    *,
    volume_name: str,
    mount_dir: Path,
    window_pos: tuple[int, int],
    window_size: tuple[int, int],
    icon_size: int,
    text_size: int,
    icon_positions: dict[str, tuple[int, int]],
) -> None:
    script = build_applescript(
        volume_name=volume_name,
        window_pos=window_pos,
        window_size=window_size,
        icon_size=icon_size,
        text_size=text_size,
        icon_positions=icon_positions,
    )
    with tempfile.NamedTemporaryFile("w", suffix=".applescript", delete=False) as handle:
        handle.write(script)
        applescript_path = Path(handle.name)
    try:
        run_checked(["osascript", str(applescript_path), volume_name])
        ds_store_path = mount_dir / ".DS_Store"
        for _ in range(10):
            if ds_store_path.exists():
                return
            time.sleep(1)
    finally:
        applescript_path.unlink(missing_ok=True)
    raise SystemExit(f"Finder did not write .DS_Store for mounted volume: {mount_dir}")
```

- [ ] **Step 4: Call the new helper flow from `main()`**

```python
        window_pos = parse_pair(args.window_pos, "window position")
        window_size = parse_pair(args.window_size, "window size")
        icon_positions = parse_icon_positions(args.icon_position)
        volume_icon_path = Path(args.volume_icon).resolve() if args.volume_icon else None

        if volume_icon_path is not None and not volume_icon_path.exists():
            raise SystemExit(f"volume icon does not exist: {volume_icon_path}")

        try:
            for child in staging_dir.iterdir():
                copy_staged_item(child, mount_dir / child.name)
            if volume_icon_path is not None:
                mark_volume_icon(mount_dir, volume_icon_path)
            run_finder_layout(
                volume_name=args.volume_name,
                mount_dir=mount_dir,
                window_pos=window_pos,
                window_size=window_size,
                icon_size=args.icon_size,
                text_size=args.text_size,
                icon_positions=icon_positions,
            )
        finally:
            run_checked(["hdiutil", "detach", str(mount_dir), "-quiet"])
```

- [ ] **Step 5: Re-run the helper tests**

Run: `python3 -m unittest tools/bazel/build_macos_dmg_test.py -v`
Expected: `OK`

- [ ] **Step 6: Build the Bazel DMG and inspect the mounted volume**

Run: `bazel build //:kanna_dmg_release_arm64`
Expected: `Target //:kanna_dmg_release_arm64 up-to-date`

Run: `tmpdir=$(mktemp -d) && mount_dir="$tmpdir/bazel" && mkdir -p "$mount_dir" && hdiutil attach bazel-bin/release/Kanna-arm64.dmg -mountpoint "$mount_dir" -nobrowse -quiet && ls -la "$mount_dir" && hdiutil detach "$mount_dir" -quiet`
Expected: the listing includes `.DS_Store`, `.VolumeIcon.icns`, `Applications`, and `Kanna.app`.

- [ ] **Step 7: Compare the Bazel DMG with the Tauri-built DMG**

Run: `tmpdir=$(mktemp -d) && tauri_mount="$tmpdir/tauri" && bazel_mount="$tmpdir/bazel" && mkdir -p "$tauri_mount" "$bazel_mount" && hdiutil attach .build/release/bundle/dmg/Kanna_0.0.36_aarch64.dmg -mountpoint "$tauri_mount" -nobrowse -quiet && hdiutil attach bazel-bin/release/Kanna-arm64.dmg -mountpoint "$bazel_mount" -nobrowse -quiet && ls -la "$tauri_mount" && ls -la "$bazel_mount" && hdiutil detach "$tauri_mount" -quiet && hdiutil detach "$bazel_mount" -quiet`
Expected: both listings include `.DS_Store`, `.VolumeIcon.icns`, `Applications`, and `Kanna.app`.

- [ ] **Step 8: Manually confirm Finder presentation**

Run: `open bazel-bin/release/Kanna-arm64.dmg`
Expected: Finder shows the mounted volume in icon view with `Kanna.app` and `Applications` laid out like the Tauri DMG instead of the default folder view.

- [ ] **Step 9: Commit the packaging behavior change**

```bash
git add tools/bazel/build_macos_dmg.py tools/bazel/build_macos_dmg_test.py
git commit -m "build: add finder layout to bazel dmg"
```
