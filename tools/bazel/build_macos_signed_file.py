#!/usr/bin/env python3

import argparse
import re
import stat
import shutil
import subprocess
from pathlib import Path


DEVELOPER_ID_PATTERN = re.compile(r'"(Developer ID Application:[^"]+)"')


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--signing-identity")
    return parser.parse_args()


def detect_signing_identity() -> str:
    output = subprocess.check_output(
        ["security", "find-identity", "-v", "-p", "codesigning"],
        text=True,
    )
    for line in output.splitlines():
        match = DEVELOPER_ID_PATTERN.search(line)
        if match:
            return match.group(1)
    raise SystemExit("no Developer ID Application signing identity found")


def main() -> None:
    args = parse_args()

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()

    if not input_path.exists():
        raise SystemExit(f"input does not exist: {input_path}")

    signing_identity = args.signing_identity or detect_signing_identity()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(input_path, output_path)
    output_path.chmod(output_path.stat().st_mode | stat.S_IWUSR)

    subprocess.run(
        [
            "codesign",
            "--force",
            "--sign",
            signing_identity,
            "--timestamp",
            str(output_path),
        ],
        check=True,
    )

    subprocess.run(
        [
            "codesign",
            "--verify",
            "--verbose=2",
            str(output_path),
        ],
        check=True,
    )


if __name__ == "__main__":
    main()
