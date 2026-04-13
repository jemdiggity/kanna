# Bazel DMG Finder Layout Design

Date: 2026-04-13
Status: Approved for planning

## Summary

Bazel-built macOS DMGs currently mount as plain folders with default Finder presentation. Tauri-built DMGs mount with normal installer-style presentation because their DMG creation path writes Finder metadata, sets a custom volume icon, and positions the app plus `Applications` link in icon view.

The goal is to make Bazel-built DMGs present the same normal mounted-folder view as Tauri-built DMGs without delegating packaging back to Tauri. Bazel should remain self-contained, but its DMG builder should perform the missing Finder cosmetic setup.

## Problem

The current Bazel DMG builder in `tools/bazel/build_macos_dmg.py` only:

- creates a blank HFS+ image
- copies `Kanna.app` into it
- creates the `Applications` symlink
- detaches and compresses the image

That produces a functional DMG, but Finder renders it with default folder layout because the image does not contain:

- a `.DS_Store` file with window/view metadata
- a `.VolumeIcon.icns` file
- the mounted-volume FinderInfo flag indicating a custom icon
- explicit icon positions for `Kanna.app` and `Applications`

Inspection of the Tauri-built DMG confirmed that it includes `.DS_Store` and `.VolumeIcon.icns`, while the Bazel-built DMG does not.

## Goals

- Make Bazel-built DMGs mount with the same class of normal Finder presentation as Tauri-built DMGs.
- Keep Bazel DMG packaging self-contained inside `tools/bazel/`.
- Express DMG presentation parameters explicitly in Bazel rule inputs instead of burying them as untracked script constants.

## Non-Goals

- Byte-for-byte reproduction of Tauri DMG artifacts.
- Delegating Bazel DMG creation to Tauri-generated helper scripts.
- Introducing checked-in `.DS_Store` templates.
- Redesigning the visual style of the DMG beyond matching Tauri’s normal installer-like layout.

## Chosen Approach

Extend the Bazel `macos_dmg` rule and `tools/bazel/build_macos_dmg.py` so the Bazel builder performs the missing Finder setup directly.

The builder will continue to:

- stage the signed `.app`
- add the `Applications` symlink
- create a temporary read-write image
- copy staged contents into the mounted volume
- compress the image to the final DMG

The new behavior will add:

- copying an `.icns` file into the mounted volume as `.VolumeIcon.icns`
- setting the custom volume icon bit on the mounted volume
- running Finder via AppleScript to:
  - open the mounted volume
  - switch the window to icon view
  - hide toolbar and status bar
  - set fixed window bounds
  - set icon size and text size
  - place `Kanna.app` and `Applications` at explicit coordinates
  - reopen the window and wait for `.DS_Store` to be written

This mirrors the missing presentation layer from Tauri’s DMG path while keeping Bazel in control of packaging.

## Rule And Script Changes

### `tools/bazel/defs.bzl`

The `macos_dmg` rule will be expanded to accept presentation inputs rather than only the app bundle and volume name.

Expected additions:

- `volume_icon`: label for a single `.icns` file
- `window_pos`: optional coordinate pair
- `window_size`: optional width/height pair
- `icon_size`: optional integer
- `text_size`: optional integer
- `icon_positions`: optional string-keyed map or equivalent structured attributes for named top-level items

The rule implementation will pass those values to `build_macos_dmg.py`.

### Root `BUILD.bazel`

The release DMG targets will pass:

- the existing desktop icon asset as the DMG volume icon
- explicit coordinates for `Kanna.app`
- explicit coordinates for `Applications`
- window sizing values matching the intended Tauri-like layout

The layout values only need to produce a normal installer presentation. Exact parity with Tauri’s script defaults is not required as long as the resulting view is visually equivalent.

### `tools/bazel/build_macos_dmg.py`

The script will gain support for:

- accepting a volume icon path
- accepting window/layout parameters
- copying `.VolumeIcon.icns`
- invoking `SetFile` to mark the volume icon file and mounted volume appropriately
- generating and running AppleScript against Finder to write `.DS_Store`
- waiting for `.DS_Store` creation before detaching

The script should continue to fail clearly if required packaging inputs are missing or if DMG creation steps fail.

## Error Handling

- If the app bundle or configured icon file is missing, the builder exits with a clear error.
- If Finder scripting fails, the build fails instead of silently producing a plain DMG. Silent degradation would preserve the current mismatch and make packaging nondeterministic.
- If `.DS_Store` is not written within a reasonable wait period, the build fails with a specific error.
- If `SetFile` is unavailable, the build should fail clearly. This packaging path already depends on macOS-native tooling such as `hdiutil`, and custom volume icons are part of the expected output.

## Testing Strategy

Manual verification is sufficient for this packaging change.

Required checks:

1. Build the Bazel DMG target.
2. Mount the Bazel DMG and verify the top-level volume contains:
   - `.DS_Store`
   - `.VolumeIcon.icns`
   - `Kanna.app`
   - `Applications`
3. Compare the mounted Bazel DMG to the Tauri-built DMG and verify both present a normal icon-view installer layout in Finder.
4. Confirm the custom volume icon appears for the mounted Bazel DMG.

Additional shell-level checks may inspect `ls -la` output and extended attributes after mounting, but Finder presentation is the actual acceptance criterion.

## Risks

- Finder scripting can be timing-sensitive. The implementation should explicitly wait for `.DS_Store` generation before detach.
- `SetFile` is part of Xcode command line tools; the script must fail clearly if unavailable instead of proceeding with partial metadata.
- Small Finder layout differences across macOS versions may exist, so acceptance should be based on normal appearance rather than byte-level metadata parity.

## Acceptance Criteria

- Bazel-built DMGs no longer mount as plain default folders.
- Mounted Bazel-built DMGs contain Finder metadata equivalent in purpose to the Tauri-built DMG: `.DS_Store` and `.VolumeIcon.icns`.
- Finder shows `Kanna.app` and `Applications` in a normal installer-style icon layout.
- The Bazel packaging flow remains implemented inside `tools/bazel/` and does not shell out to Tauri’s generated DMG helper.
