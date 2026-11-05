"""Update Now on a standard install (#172). See docs/adr/0002-in-place-self-update.md.

The container can't rebuild its own image, so a release ships a bundle per architecture holding
the backend, the built frontend, and the Python dependencies. The bundle is unpacked under
SERVERS_DIR/.isopod-app, and docker/entrypoint.sh starts Isopod from there on the next boot. If
that boot never reaches startup, the entrypoint goes back to the previous version.

Changes to the image itself (the Dockerfile, the entrypoint, the compose file) can't arrive this
way. A release that needs them sets a higher docker/image-rev, and Update Now gives way to the
manual commands.
"""
import hashlib
import json
import os
import platform
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
from typing import Optional

import httpx

APP_DIR_NAME = ".isopod-app"
IMAGE_REV_FILE = "/etc/isopod-image-rev"
DOCKERD_PID_FILE = "/var/run/docker.pid"
TAG_RE = re.compile(r"^v\d+\.\d+\.\d+$")
STABLE_VERSION_RE = re.compile(r"v?([0-9]+)\.([0-9]+)\.([0-9]+)")
ARCHES = {"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64", "arm64": "arm64"}
MAX_BUNDLE_BYTES = 512 * 1024 * 1024
# Same as dockerd's --shutdown-timeout in the entrypoint, plus some room
DOCKERD_STOP_SECONDS = 90
SMOKE_TEST_SECONDS = 120
VERSIONS_KEPT = 2


class UpdateError(Exception):
    """An update that can't go ahead, with a reason fit to show the user."""


def app_root(servers_dir: str) -> str:
    return os.path.join(servers_dir, APP_DIR_NAME)


def image_rev() -> Optional[int]:
    """The running image's revision, or None on an image without the entrypoint support."""
    try:
        with open(IMAGE_REV_FILE, "r", encoding="utf-8") as f:
            return int(f.read().strip())
    except (OSError, ValueError):
        return None


def is_newer_release(latest: str, current: str) -> bool:
    """Compare stable versions numerically; unrecognized formats are not updates."""
    latest_match = STABLE_VERSION_RE.fullmatch(latest)
    current_match = STABLE_VERSION_RE.fullmatch(current)
    if latest_match is None or current_match is None:
        return False
    latest_parts = tuple(int(part) for part in latest_match.groups())
    current_parts = tuple(int(part) for part in current_match.groups())
    return latest_parts > current_parts


def bundle_name(tag: str, arch: str) -> str:
    return f"isopod-app-{tag}-{arch}.tar.gz"


def find_bundle(release: dict, repo: str, machine: Optional[str] = None) -> Optional[dict]:
    """The bundle's download URLs for this machine, if the release has them on the expected host."""
    tag = release.get("tag_name") or ""
    arch = ARCHES.get((machine or platform.machine()).lower())
    if not arch or not TAG_RE.match(tag):
        return None
    name = bundle_name(tag, arch)
    prefix = f"https://github.com/{repo}/releases/download/{tag}/"
    urls = {a.get("name"): a.get("browser_download_url") or "" for a in release.get("assets") or []}
    if urls.get(name) != prefix + name or urls.get(name + ".sha256") != prefix + name + ".sha256":
        return None
    return {"tag": tag, "name": name, "url": urls[name], "sha256_url": urls[name + ".sha256"]}


def can_install(release: dict, repo: str) -> bool:
    return image_rev() is not None and find_bundle(release, repo) is not None


def _download(url: str, dest: str) -> str:
    """Save url to dest and return its SHA-256."""
    digest = hashlib.sha256()
    size = 0
    with httpx.stream("GET", url, follow_redirects=True, timeout=120) as res:
        if res.status_code != 200:
            raise UpdateError(f"The download failed with status {res.status_code}.")
        with open(dest, "wb") as out:
            for chunk in res.iter_bytes():
                size += len(chunk)
                if size > MAX_BUNDLE_BYTES:
                    raise UpdateError("The update is larger than expected, so it wasn't installed.")
                digest.update(chunk)
                out.write(chunk)
    return digest.hexdigest()


def _unpack(bundle: str, dest: str) -> None:
    with tarfile.open(bundle, "r:gz") as tar:
        # The "data" filter refuses absolute paths, "..", links out of dest, and device files
        tar.extractall(dest, filter="data")


def _read_manifest(path: str, tag: str) -> dict:
    try:
        with open(os.path.join(path, "manifest.json"), "r", encoding="utf-8") as f:
            manifest = json.load(f)
    except (OSError, ValueError):
        raise UpdateError("The update has no valid manifest, so it wasn't installed.")
    if manifest.get("version") != tag:
        raise UpdateError("The update's version doesn't match the release, so it wasn't installed.")
    return manifest


def _smoke_test(path: str) -> None:
    """Import the new version with its own dependencies, so a bad bundle never gets as far as a restart."""
    env = dict(os.environ, PYTHONPATH=os.path.join(path, "deps"))
    try:
        result = subprocess.run(
            [sys.executable, "-c", "import backend.main"],
            cwd=path, env=env, capture_output=True, text=True, timeout=SMOKE_TEST_SECONDS,
        )
    except subprocess.TimeoutExpired:
        raise UpdateError("The new version took too long to load, so it wasn't installed.")
    if result.returncode != 0:
        print(f"Update smoke test failed: {result.stderr[-2000:]}")
        raise UpdateError("The new version failed to load, so it wasn't installed.")


def _prune(root: str, keep: list) -> None:
    versions = os.path.join(root, "versions")
    for name in os.listdir(versions):
        if name not in keep:
            shutil.rmtree(os.path.join(versions, name), ignore_errors=True)


def _read_tag(path: str) -> Optional[str]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            tag = f.read().strip()
    except OSError:
        return None
    return tag if TAG_RE.match(tag) else None


def install(bundle: dict, servers_dir: str) -> None:
    """Download, check, and unpack a bundle, then mark it to start on the next boot."""
    tag = bundle["tag"]
    rev = image_rev()
    root = app_root(servers_dir)
    versions = os.path.join(root, "versions")
    os.makedirs(versions, exist_ok=True)

    with tempfile.TemporaryDirectory(dir=root, prefix="download-") as work:
        archive = os.path.join(work, bundle["name"])
        checksum_file = archive + ".sha256"
        _download(bundle["sha256_url"], checksum_file)
        with open(checksum_file, "r", encoding="utf-8") as f:
            expected = f.read().split()[0].lower() if os.path.getsize(checksum_file) else ""
        if _download(bundle["url"], archive) != expected:
            raise UpdateError("The download didn't match its checksum, so it wasn't installed.")

        unpacked = os.path.join(work, "unpacked")
        _unpack(archive, unpacked)
        manifest = _read_manifest(unpacked, tag)
        required = manifest.get("required_image_rev")
        if not isinstance(required, int) or rev is None or required > rev:
            raise UpdateError("This update needs a rebuild, so it has to be installed with the commands below.")
        _smoke_test(unpacked)

        target = os.path.join(versions, tag)
        shutil.rmtree(target, ignore_errors=True)
        os.replace(unpacked, target)

    active = _read_tag(os.path.join(root, "active"))
    _prune(root, [tag] + ([active] if active else []))
    for name in ("tried", "failed"):
        try:
            os.remove(os.path.join(root, name))
        except FileNotFoundError:
            pass
    pending = os.path.join(root, "pending")
    with open(pending + ".tmp", "w", encoding="utf-8") as f:
        f.write(tag)
    os.replace(pending + ".tmp", pending)


def mark_started(servers_dir: str, version: str) -> None:
    """Called once the app is up: the entrypoint's trial of a pending version succeeded."""
    root = app_root(servers_dir)
    pending = os.path.join(root, "pending")
    if _read_tag(pending) != version:
        return
    active = os.path.join(root, "active")
    with open(active + ".tmp", "w", encoding="utf-8") as f:
        f.write(version)
    os.replace(active + ".tmp", active)
    for path in (pending, os.path.join(root, "tried")):
        try:
            os.remove(path)
        except FileNotFoundError:
            pass


def failed_version(servers_dir: str) -> Optional[str]:
    """A version that didn't start, which the entrypoint rolled back from."""
    return _read_tag(os.path.join(app_root(servers_dir), "failed"))


def _is_running(pid: int) -> bool:
    """False once it has exited. Nothing reaps dockerd here, so it lingers as a zombie."""
    try:
        with open(f"/proc/{pid}/stat", "r", encoding="utf-8") as f:
            return f.read().rsplit(")", 1)[1].split()[0] != "Z"
    except (OSError, IndexError):
        return False


def stop_docker_daemon() -> None:
    """Stop the inner dockerd, which saves and stops the servers and restarts them with it."""
    try:
        with open(DOCKERD_PID_FILE, "r", encoding="utf-8") as f:
            pid = int(f.read().strip())
        os.kill(pid, signal.SIGTERM)
    except (OSError, ValueError):
        return  # Using the host's Docker, or it's already gone
    deadline = time.time() + DOCKERD_STOP_SECONDS
    while time.time() < deadline:
        if not _is_running(pid):
            return
        time.sleep(1)
    print("Update: dockerd is still stopping, restarting anyway.")
