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
