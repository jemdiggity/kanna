from __future__ import annotations

import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from normalize_tauri_context import normalize_generated_context


class NormalizeTauriContextTest(unittest.TestCase):
    def test_rewrites_plugin_command_namespace_without_touching_permission_keys(self) -> None:
        source = """
map . insert ("plugin:plugin-sql|load" . into () , vec ! []) ;
map . insert ("plugin:plugin-shell|open" . into () , vec ! []) ;
map . insert ("plugin-sql" . into () , manifest) ;
map . insert ("plugin-shell" . into () , manifest) ;
"""

        normalized = normalize_generated_context(source)

        self.assertIn('"plugin:sql|load"', normalized)
        self.assertIn('"plugin:shell|open"', normalized)
        self.assertIn('"plugin-sql"', normalized)
        self.assertIn('"plugin-shell"', normalized)
        self.assertNotIn('"plugin:plugin-sql|load"', normalized)
        self.assertNotIn('"plugin:plugin-shell|open"', normalized)


if __name__ == "__main__":
    unittest.main()
