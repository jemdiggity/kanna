import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("build_frontend_dist.py")


def write_executable(path: Path, content: str) -> None:
    path.write_text(content)
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


class BuildFrontendDistTest(unittest.TestCase):
    def test_build_uses_declared_node_binary(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            src_root = root / "src"
            src_root.mkdir()
            package_json = src_root / "package.json"
            package_json.write_text('{"name":"test-app"}\n')

            fake_bin = root / "bin"
            fake_bin.mkdir()
            fake_pnpm = fake_bin / "pnpm"
            fake_node = fake_bin / "node"

            write_executable(
                fake_node,
                "#!/bin/sh\nexit 0\n",
            )
            write_executable(
                fake_pnpm,
                """#!/bin/sh
set -eu
command -v node >/dev/null 2>&1
if [ "$1" = "exec" ] && [ "$2" = "vite" ]; then
  out_dir=""
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "--outDir" ]; then
      shift
      out_dir="$1"
      break
    fi
    shift
  done
  mkdir -p "$out_dir"
  touch "$out_dir/index.html"
fi
""",
            )

            manifest_path = root / "sources.json"
            manifest_path.write_text(
                json.dumps(
                    [
                        {
                            "source": str(package_json),
                            "dest": "apps/desktop/package.json",
                        }
                    ]
                )
            )
            out_dir = root / "out"

            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT_PATH),
                    "--source-manifest",
                    str(manifest_path),
                    "--package-dir",
                    "apps/desktop",
                    "--out-dir",
                    str(out_dir),
                    "--pnpm",
                    str(fake_pnpm),
                    "--node",
                    str(fake_node),
                ],
                env={"PATH": "", "TMPDIR": str(root / "tmp")},
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            self.assertTrue((out_dir / "index.html").exists())


if __name__ == "__main__":
    unittest.main()
