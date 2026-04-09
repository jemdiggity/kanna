#!/usr/bin/env python3

import argparse
import os
import stat
import shutil
import subprocess
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dmg", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(
            f"missing required environment variable: {name}\n"
            "Run Bazel with --config=notarize so Bazel forwards notarization credentials."
        )
    return value


def main() -> None:
    args = parse_args()

    dmg_path = Path(args.dmg).resolve()
    output_path = Path(args.output).resolve()

    if not dmg_path.exists():
        raise SystemExit(f"dmg does not exist: {dmg_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(dmg_path, output_path)
    output_path.chmod(output_path.stat().st_mode | stat.S_IWUSR)

    keychain_profile = os.environ.get("APPLE_KEYCHAIN_PROFILE")

    submit_command = [
        "xcrun",
        "notarytool",
        "submit",
        str(output_path),
        "--wait",
    ]
    if keychain_profile:
        submit_command.extend([
            "--keychain-profile",
            keychain_profile,
        ])
    else:
        apple_id = required_env("APPLE_ID")
        apple_password = required_env("APPLE_PASSWORD")
        apple_team_id = required_env("APPLE_TEAM_ID")
        submit_command.extend([
            "--apple-id",
            apple_id,
            "--password",
            apple_password,
            "--team-id",
            apple_team_id,
        ])

    subprocess.run(submit_command, check=True)

    subprocess.run(
        [
            "xcrun",
            "stapler",
            "staple",
            str(output_path),
        ],
        check=True,
    )

    subprocess.run(
        [
            "xcrun",
            "stapler",
            "validate",
            str(output_path),
        ],
        check=True,
    )


if __name__ == "__main__":
    main()
