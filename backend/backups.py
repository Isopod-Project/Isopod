"""Scheduled and on-demand world backups for Isopod instances.

Backups are zip files of an instance's world folders (any folder under data/ that
contains a level.dat, or data/worlds/ on Bedrock), stored in <instance>/backups/, or in <root>/<instance id>/ when a
backup folder is set in the global settings. Per-instance schedule settings live in
isopod-meta.json under the "backups" key.

Snapshots are taken automatically before mod, loader, and version changes. They live
next to backups but also hold the mods/config/plugins folders and the server config, so
restoring one rolls the whole instance back. Their members are stored relative to the
instance folder, and an isopod-snapshot.json manifest records why each was taken.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import zipfile
from datetime import datetime
from typing import Callable, Dict, List, Optional

from . import instance_compose

from . import bedrock

BACKUPS_DIR_NAME = "backups"
ARCHIVE_NAME_RE = re.compile(r"^(backup|snapshot)-\d{8}-\d{6}(-\d+)?\.zip$")

SNAPSHOT_MANIFEST = "isopod-snapshot.json"
# Folders under data/ that a mod, loader, or version change can rewrite.
SNAPSHOT_DATA_DIRS = ["mods", "config", "plugins"]
SNAPSHOT_FILES = ["docker-compose.yml", "data/server.properties"]
# Several changes in a row (e.g. toggling mods one by one) share the first snapshot.
SNAPSHOT_MIN_INTERVAL = 600

DEFAULT_SETTINGS = {
    "enabled": False,
    "interval_hours": 24,
    "keep": 7,
    "snapshot_keep": 3,
}


def get_settings(meta: dict) -> dict:
    settings = dict(DEFAULT_SETTINGS)
    settings.update(meta.get("backups") or {})
    return settings


def validate_settings(enabled: bool, interval_hours: float, keep: int, snapshot_keep: int = DEFAULT_SETTINGS["snapshot_keep"]) -> dict:
    if interval_hours <= 0:
        raise ValueError("Backup interval must be greater than zero.")
    if keep < 1:
        raise ValueError("Must keep at least one backup.")
    if snapshot_keep < 0:
        raise ValueError("Snapshots to keep can't be negative.")
    return {
        "enabled": bool(enabled),
        "interval_hours": float(interval_hours),
        "keep": int(keep),
        "snapshot_keep": int(snapshot_keep),
    }


# Returns the global backup folder, or None to keep backups inside each instance.
_backup_root: Callable[[], Optional[str]] = lambda: None


def set_backup_root_provider(provider: Callable[[], Optional[str]]) -> None:
    global _backup_root
    _backup_root = provider


def backups_dir(instance_path: str) -> str:
    root = _backup_root()
    if root:
        return os.path.join(root, os.path.basename(os.path.normpath(instance_path)))
    return os.path.join(instance_path, BACKUPS_DIR_NAME)


def backup_file_path(instance_path: str, name: str) -> str:
    """Resolve a backup or snapshot file name, rejecting anything that isn't one of ours."""
    if not ARCHIVE_NAME_RE.match(name):
        raise ValueError("Invalid backup name.")
    folder = os.path.realpath(backups_dir(instance_path))
    path = os.path.realpath(os.path.join(folder, name))
    if not path.startswith(folder + os.sep):
        raise ValueError("Invalid backup name.")
    if not os.path.isfile(path):
        raise FileNotFoundError(name)
    return path


def find_world_dirs(instance_path: str) -> List[str]:
    """Return world folder names under data/ (any folder holding a level.dat, or Bedrock's worlds/)."""
    data_dir = os.path.join(instance_path, "data")
    if not os.path.isdir(data_dir):
        return []
    return sorted(
        [entry.name for entry in os.scandir(data_dir)
         if entry.is_dir() and os.path.isfile(os.path.join(entry.path, "level.dat"))]
        + bedrock.find_world_dirs(data_dir)
    )


def _list_archives(instance_path: str, kind: str) -> List[dict]:
    bdir = backups_dir(instance_path)
    if not os.path.isdir(bdir):
        return []
    items = []
    for entry in os.scandir(bdir):
        if entry.is_file() and entry.name.startswith(f"{kind}-") and ARCHIVE_NAME_RE.match(entry.name):
            stat = entry.stat()
            items.append({"name": entry.name, "size": stat.st_size, "created": stat.st_mtime})
    items.sort(key=lambda b: (b["created"], b["name"]), reverse=True)
    return items


def list_backups(instance_path: str) -> List[dict]:
    return _list_archives(instance_path, "backup")


def _read_manifest(zip_path: str) -> dict:
    try:
        with zipfile.ZipFile(zip_path, "r") as zipf:
            return json.loads(zipf.read(SNAPSHOT_MANIFEST))
    except Exception:
        return {}


def list_snapshots(instance_path: str) -> List[dict]:
    items = _list_archives(instance_path, "snapshot")
    for item in items:
        manifest = _read_manifest(os.path.join(backups_dir(instance_path), item["name"]))
        item["reason"] = manifest.get("reason") or "Before an update"
    return items


def _rcon(instance_path: str, command: str) -> bool:
    try:
        result = subprocess.run(
            instance_compose.command(instance_path, "exec", "-T", "mc", "rcon-cli", command),
            cwd=instance_path, capture_output=True, text=True, timeout=30,
        )
        return result.returncode == 0
    except Exception:
        return False


def _new_archive_path(instance_path: str, kind: str) -> str:
    bdir = backups_dir(instance_path)
    os.makedirs(bdir, exist_ok=True)
    base = f"{kind}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    name = f"{base}.zip"
    counter = 1
    while os.path.exists(os.path.join(bdir, name)):
        name = f"{base}-{counter}.zip"
        counter += 1
    return os.path.join(bdir, name)


def _zip_tree(zipf: zipfile.ZipFile, folder: str, relative_to: str) -> None:
    for root, _dirs, files in os.walk(folder):
        for file in files:
            # session.lock is held open by the running server and isn't needed to restore.
            if file == "session.lock":
                continue
            file_path = os.path.join(root, file)
            zipf.write(file_path, os.path.relpath(file_path, relative_to))


def _write_archive(instance_path: str, zip_path: str, fill: Callable[[zipfile.ZipFile], None]) -> dict:
    """Write an archive via fill(). If the server is running, flush and pause saving while copying."""
    tmp_path = zip_path + ".partial"
    # Fails harmlessly when the server is stopped; then files are already consistent on disk.
    saving_paused = _rcon(instance_path, "save-off")
    if saving_paused:
        _rcon(instance_path, "save-all flush")
    # Bedrock servers have no RCON; they pause saving through the console instead.
    bedrock_held = not saving_paused and bedrock.hold_saving(instance_path)
    try:
        with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            fill(zipf)
        os.replace(tmp_path, zip_path)
    finally:
        if saving_paused:
            _rcon(instance_path, "save-on")
        if bedrock_held:
            bedrock.resume_saving(instance_path)
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    stat = os.stat(zip_path)
    return {"name": os.path.basename(zip_path), "size": stat.st_size, "created": stat.st_mtime}


def create_backup(instance_path: str) -> dict:
    """Zip all world folders."""
    worlds = find_world_dirs(instance_path)
    if not worlds:
        raise ValueError("No world folders found to back up.")
    data_dir = os.path.join(instance_path, "data")

    def fill(zipf: zipfile.ZipFile) -> None:
        for world in worlds:
            _zip_tree(zipf, os.path.join(data_dir, world), data_dir)

    return _write_archive(instance_path, _new_archive_path(instance_path, "backup"), fill)


def create_snapshot(instance_path: str, reason: str) -> dict:
    """Zip the worlds, mods/config/plugins folders, and server config, so the instance can be rolled back."""
    worlds = find_world_dirs(instance_path)
    data_dirs = [d for d in SNAPSHOT_DATA_DIRS if os.path.isdir(os.path.join(instance_path, "data", d))]
    files = [f for f in SNAPSHOT_FILES if os.path.isfile(os.path.join(instance_path, f))]
    manifest = {
        "reason": reason,
        "created": time.time(),
        "worlds": worlds,
        "data_dirs": data_dirs,
        "files": files,
    }

    def fill(zipf: zipfile.ZipFile) -> None:
        for folder in worlds + data_dirs:
            _zip_tree(zipf, os.path.join(instance_path, "data", folder), instance_path)
        for file in files:
            zipf.write(os.path.join(instance_path, file), file)
        zipf.writestr(SNAPSHOT_MANIFEST, json.dumps(manifest, indent=2))

    snapshot = _write_archive(instance_path, _new_archive_path(instance_path, "snapshot"), fill)
    snapshot["reason"] = reason
    return snapshot


def recent_snapshot(instance_path: str, within_seconds: float = SNAPSHOT_MIN_INTERVAL) -> Optional[dict]:
    snapshots = list_snapshots(instance_path)
    if snapshots and time.time() - snapshots[0]["created"] < within_seconds:
        return snapshots[0]
    return None


def _prune(instance_path: str, items: List[dict], keep: int) -> None:
    for old in items[keep:]:
        try:
            os.remove(os.path.join(backups_dir(instance_path), old["name"]))
        except OSError as e:
            print(f"Failed to prune {old['name']}: {e}")


def prune_backups(instance_path: str, keep: int) -> None:
    _prune(instance_path, list_backups(instance_path), keep)


def prune_snapshots(instance_path: str, keep: int) -> None:
    _prune(instance_path, _list_archives(instance_path, "snapshot"), keep)


def _check_members(members: List[str], base: str) -> None:
    for member in members:
        target = os.path.realpath(os.path.join(base, member))
        if not target.startswith(base + os.sep):
            raise ValueError("Backup contains an unsafe path.")


def _top_level(member: str, nested: str = "") -> str:
    """The folder or file a member belongs to, e.g. "data/world" for "data/world/level.dat" when nested is "data"."""
    parts = member.replace("\\", "/").strip("/").split("/")
    if nested and parts[0] == nested and len(parts) > 1:
        return f"{parts[0]}/{parts[1]}"
    return parts[0]


def _staged_restore(zipf: zipfile.ZipFile, members: List[str], base: str, replace: List[str]) -> None:
    """Extract members under base, replacing each path in replace (relative to base).

    Everything is extracted to a staging folder first, so a corrupt archive fails before
    anything live is touched. Current copies are then moved aside and only deleted once
    every staged path is in place; any failure along the way puts the old ones back.
    """
    os.makedirs(base, exist_ok=True)
    staging = tempfile.mkdtemp(prefix=".isopod-restore-", dir=base)
    aside = tempfile.mkdtemp(prefix=".isopod-previous-", dir=base)
    moved_aside: List[str] = []
    moved_in: List[str] = []
    try:
        zipf.extractall(staging, members=members)
        for rel in replace:
            live = os.path.join(base, rel)
            if os.path.lexists(live):
                os.makedirs(os.path.dirname(os.path.join(aside, rel)), exist_ok=True)
                os.replace(live, os.path.join(aside, rel))
                moved_aside.append(rel)
        for rel in replace:
            staged = os.path.join(staging, rel)
            if os.path.lexists(staged):
                os.makedirs(os.path.dirname(os.path.join(base, rel)), exist_ok=True)
                os.replace(staged, os.path.join(base, rel))
                moved_in.append(rel)
    except BaseException:
        for rel in moved_in:
            live = os.path.join(base, rel)
            if os.path.isdir(live) and not os.path.islink(live):
                shutil.rmtree(live, ignore_errors=True)
            else:
                try:
                    os.remove(live)
                except OSError:
                    pass
        for rel in moved_aside:
            os.replace(os.path.join(aside, rel), os.path.join(base, rel))
        # Only reached once everything is back; if a move above failed, the old copies stay in aside.
        shutil.rmtree(aside, ignore_errors=True)
        raise
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    shutil.rmtree(aside, ignore_errors=True)


def restore_snapshot(instance_path: str, name: str) -> List[str]:
    """Put the worlds, mod folders, and server config back as they were. Caller must ensure the server is stopped."""
    zip_path = backup_file_path(instance_path, name)
    base = os.path.realpath(instance_path)
    with zipfile.ZipFile(zip_path, "r") as zipf:
        try:
            manifest = json.loads(zipf.read(SNAPSHOT_MANIFEST))
        except (KeyError, ValueError):
            raise ValueError("Snapshot is missing its manifest.")
        members = [m for m in zipf.namelist() if m != SNAPSHOT_MANIFEST]
        _check_members(members, base)
        # Replace every snapshot-managed folder, so mods added after the snapshot don't linger.
        replace = set()
        for folder in set(manifest.get("worlds", [])) | set(SNAPSHOT_DATA_DIRS):
            if not folder or "/" in folder or "\\" in folder or folder in (".", ".."):
                continue
            replace.add(f"data/{folder}")
        replace.update(_top_level(m, "data") for m in members if m.strip("/"))
        _staged_restore(zipf, members, base, sorted(replace))
    return list(manifest.get("worlds", [])) + list(manifest.get("data_dirs", [])) + list(manifest.get("files", []))


def restore_backup(instance_path: str, name: str) -> List[str]:
    """Replace the world folders contained in the backup. Caller must ensure the server is stopped."""
    if name.startswith("snapshot-"):
        return restore_snapshot(instance_path, name)
    zip_path = backup_file_path(instance_path, name)
    data_dir = os.path.realpath(os.path.join(instance_path, "data"))
    with zipfile.ZipFile(zip_path, "r") as zipf:
        members = zipf.namelist()
        worlds = sorted({_top_level(m) for m in members if m.strip("/")})
        _check_members(members, data_dir)
        _staged_restore(zipf, members, data_dir, worlds)
    return worlds


# Last scheduled attempt per instance path, so a failing instance isn't retried every tick.
_last_attempt: Dict[str, float] = {}


def run_due_backups(servers_dir: str, get_meta: Callable[[str], Dict]) -> None:
    """Back up every instance whose schedule is enabled and whose newest backup is older than its interval."""
    if not os.path.isdir(servers_dir):
        return
    now = time.time()
    for entry in os.scandir(servers_dir):
        if not entry.is_dir() or not os.path.exists(os.path.join(entry.path, "docker-compose.yml")):
            continue
        settings = get_settings(get_meta(entry.path))
        if not settings["enabled"]:
            continue
        existing = list_backups(entry.path)
        last = max(existing[0]["created"] if existing else 0, _last_attempt.get(entry.path, 0))
        if now - last < settings["interval_hours"] * 3600:
            continue
        _last_attempt[entry.path] = now
        try:
            backup = create_backup(entry.path)
            print(f"Scheduled backup created for {entry.name}: {backup['name']}")
            prune_backups(entry.path, settings["keep"])
        except Exception as e:
            print(f"Scheduled backup failed for {entry.name}: {e}")
