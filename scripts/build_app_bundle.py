#!/usr/bin/env python3
"""Build a release's self-update bundle (see docs/adr/0002-in-place-self-update.md).

Run from the repo root after `npm run build` in frontend/:
    python scripts/build_app_bundle.py v0.5.0 amd64 dist-bundles/

Writes isopod-app-<tag>-<arch>.tar.gz and a .sha256 next to it. The image's Python version must
match PYTHON_VERSION, since the bundle's dependencies include compiled extensions.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

PYTHON_VERSION = "3.11"
PLATFORMS = {
    "amd64": ["manylinux_2_28_x86_64", "manylinux_2_17_x86_64", "manylinux2014_x86_64", "manylinux_2_5_x86_64", "manylinux1_x86_64"],
    "arm64": ["manylinux_2_28_aarch64", "manylinux_2_17_aarch64", "manylinux2014_aarch64"],
}


def code_version() -> str:
    with open("backend/main.py", "r", encoding="utf-8") as f:
        return re.search(r'^ISOPOD_VERSION = "([^"]+)"', f.read(), re.M).group(1)


def main() -> None:
    tag, arch, out_dir = sys.argv[1:4]
    if code_version() != tag:
        sys.exit(f"backend/main.py says {code_version()}, not {tag}")
    if not os.path.isfile("frontend/dist/index.html"):
        sys.exit("Build the frontend first")

    with open("docker/image-rev", "r", encoding="utf-8") as f:
        required_image_rev = int(f.read().strip())

    with tempfile.TemporaryDirectory() as work:
        shutil.copytree("backend", os.path.join(work, "backend"), ignore=shutil.ignore_patterns("tests", "__pycache__", "venv", ".env"))
        shutil.copytree("frontend/dist", os.path.join(work, "frontend", "dist"))
        platforms = [flag for p in PLATFORMS[arch] for flag in ("--platform", p)]
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--quiet", "--no-cache-dir", "--target", os.path.join(work, "deps"),
             "--only-binary=:all:", "--implementation", "cp", "--python-version", PYTHON_VERSION, *platforms,
             "-r", "backend/requirements.txt"],
            check=True,
        )
        with open(os.path.join(work, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump({"version": tag, "arch": arch, "required_image_rev": required_image_rev}, f)

        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, f"isopod-app-{tag}-{arch}.tar.gz")
        with tarfile.open(path, "w:gz") as tar:
            for name in sorted(os.listdir(work)):
                tar.add(os.path.join(work, name), arcname=name)

    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    with open(path + ".sha256", "w", encoding="utf-8") as f:
        f.write(f"{digest.hexdigest()}  {os.path.basename(path)}\n")
    print(path, os.path.getsize(path), "bytes")


if __name__ == "__main__":
    main()
