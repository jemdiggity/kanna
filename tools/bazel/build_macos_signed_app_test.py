import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_macos_signed_app


class BuildMacosSignedAppTest(unittest.TestCase):
    def test_normalize_bundle_directory_modes_makes_app_directories_755(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            app_path = Path(temp_dir) / "Kanna.app"
            contents_path = app_path / "Contents"
            macos_path = contents_path / "MacOS"
            macos_path.mkdir(parents=True)
            executable_path = macos_path / "Kanna"
            executable_path.write_text("binary", encoding="utf-8")

            os.chmod(macos_path, 0o555)
            os.chmod(contents_path, 0o555)
            os.chmod(app_path, 0o555)

            try:
                build_macos_signed_app.normalize_bundle_directory_modes(app_path)

                self.assertEqual(stat.S_IMODE(app_path.stat().st_mode), 0o755)
                self.assertEqual(stat.S_IMODE(contents_path.stat().st_mode), 0o755)
                self.assertEqual(stat.S_IMODE(macos_path.stat().st_mode), 0o755)
                self.assertEqual(
                    stat.S_IMODE(executable_path.stat().st_mode),
                    0o644,
                )
            finally:
                os.chmod(macos_path, 0o755)
                os.chmod(contents_path, 0o755)
                os.chmod(app_path, 0o755)


if __name__ == "__main__":
    unittest.main()
