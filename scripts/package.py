#!/usr/bin/env python3
"""Build the Chrome Web Store upload zip: dist/task-colors-for-google-calendar-<version>.zip

Only the files the extension needs are included (manifest, src/, popup/,
icons/), with manifest.json at the zip root. Run from anywhere:

    python3 scripts/package.py
"""
import json
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
INCLUDE = ["manifest.json", "src", "popup", "icons"]


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text())
    version = manifest["version"]

    # Every file the manifest and popup reference must be in the package.
    files = []
    for entry in INCLUDE:
        path = ROOT / entry
        files += [path] if path.is_file() else sorted(p for p in path.rglob("*") if p.is_file())
    names = {p.relative_to(ROOT).as_posix() for p in files}
    referenced = set(manifest["icons"].values()) | {manifest["background"]["service_worker"], manifest["action"]["default_popup"]}
    for cs in manifest["content_scripts"]:
        referenced |= set(cs["js"])
    missing = sorted(referenced - names)
    if missing:
        raise SystemExit(f"Missing files referenced by manifest.json: {missing}")

    out = ROOT / "dist" / f"task-colors-for-google-calendar-{version}.zip"
    out.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files:
            z.write(p, p.relative_to(ROOT).as_posix())
    print(f"Wrote {out.relative_to(ROOT)} ({len(files)} files, {out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
