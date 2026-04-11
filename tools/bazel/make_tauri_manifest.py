#!/usr/bin/env python3

import argparse
import json
import shutil
from pathlib import Path


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def copy_entry(source: Path, destination: Path) -> list[dict[str, str]]:
    if source.is_dir():
        copied: list[dict[str, str]] = []
        for child in sorted(source.rglob("*")):
            if child.is_dir():
                continue
            relative = child.relative_to(source)
            child_destination = destination / relative
            ensure_parent(child_destination)
            shutil.copy2(child, child_destination)
            copied.append(
                {
                    "source": str(child),
                    "destination": str(child_destination),
                }
            )
        return copied

    ensure_parent(destination)
    shutil.copy2(source, destination)
    return [{"source": str(source), "destination": str(destination)}]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--output-manifest", required=True)
    args = parser.parse_args()

    spec = json.loads(Path(args.spec).read_text())
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    manifest_entries = []
    for entry in spec["entries"]:
        source = Path(entry["source"])
        destination = output_dir / entry["destination"]
        for copied in copy_entry(source, destination):
            manifest_entries.append(
                {
                    "kind": entry["kind"],
                    "source": copied["source"],
                    "destination": copied["destination"].removeprefix(str(output_dir) + "/"),
                }
            )

    output_manifest = {
        "metadata": spec["metadata"],
        "entries": sorted(manifest_entries, key=lambda item: item["destination"]),
    }
    Path(args.output_manifest).write_text(json.dumps(output_manifest, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
