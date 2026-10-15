"""Scheduled and on-demand world backups for Isopod instances.

Backups are zip files of an instance's world folders (any folder under data/ that
contains a level.dat), stored in <instance>/backups/. Per-instance schedule settings
live in isopod-meta.json under the "backups" key.
"""
import os
import re
import shutil
import subprocess
import time
import zipfile
from datetime import datetime
from typing import Callable, Dict, List

BACKUPS_DIR_NAME = "backups"
BACKUP_NAME_RE = re.compile(r"^backup-\d{8}-\d{6}(-\d+)?\.zip$")

DEFAULT_SETTINGS = {
    "enabled": False,
    "interval_hours": 24,
    "keep": 7,
}


def get_settings(meta: dict) -> dict:
    settings = dict(DEFAULT_SETTINGS)
    settings.update(meta.get("backups") or {})
    return settings


def validate_settings(enabled: bool, interval_hours: float, keep: int) -> dict:
    if interval_hours <= 0:
        raise ValueError("Backup interval must be greater than zero.")
    if keep < 1:
        raise ValueError("Must keep at least one backup.")
    return {"enabled": bool(enabled), "interval_hours": float(interval_hours), "keep": int(keep)}


def backups_dir(instance_path: str) -> str:
    return os.path.join(instance_path, BACKUPS_DIR_NAME)


def backup_file_path(instance_path: str, name: str) -> str:
    """Resolve a backup file name, rejecting anything that isn't one of ours."""
    if not BACKUP_NAME_RE.match(name):
        raise ValueError("Invalid backup name.")
    path = os.path.join(backups_dir(instance_path), name)
    if not os.path.isfile(path):
        raise FileNotFoundError(name)
    return path


def find_world_dirs(instance_path: str) -> List[str]:
    """Return world folder names under data/ (any folder holding a level.dat)."""
    data_dir = os.path.join(instance_path, "data")
    if not os.path.isdir(data_dir):
        return []
    return sorted(
        entry.name for entry in os.scandir(data_dir)
        if entry.is_dir() and os.path.isfile(os.path.join(entry.path, "level.dat"))
    )


def list_backups(instance_path: str) -> List[dict]:
    bdir = backups_dir(instance_path)
    if not os.path.isdir(bdir):
        return []
    items = []
    for entry in os.scandir(bdir):
        if entry.is_file() and BACKUP_NAME_RE.match(entry.name):
            stat = entry.stat()
            items.append({"name": entry.name, "size": stat.st_size, "created": stat.st_mtime})
    items.sort(key=lambda b: (b["created"], b["name"]), reverse=True)
    return items


def _rcon(instance_path: str, command: str) -> bool:
    try:
        result = subprocess.run(
            ["docker", "compose", "exec", "-T", "mc", "rcon-cli", command],
            cwd=instance_path, capture_output=True, text=True, timeout=30,
        )
        return result.returncode == 0
    except Exception:
        return False


def create_backup(instance_path: str) -> dict:
    """Zip all world folders. If the server is running, flush and pause saving while copying."""
    worlds = find_world_dirs(instance_path)
    if not worlds:
        raise ValueError("No world folders found to back up.")

    bdir = backups_dir(instance_path)
    os.makedirs(bdir, exist_ok=True)
    base = f"backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    name = f"{base}.zip"
    counter = 1
    while os.path.exists(os.path.join(bdir, name)):
        name = f"{base}-{counter}.zip"
        counter += 1
    zip_path = os.path.join(bdir, name)
    tmp_path = zip_path + ".partial"

    # Fails harmlessly when the server is stopped; then files are already consistent on disk.
    saving_paused = _rcon(instance_path, "save-off")
    if saving_paused:
        _rcon(instance_path, "save-all flush")
    try:
        data_dir = os.path.join(instance_path, "data")
        with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            for world in worlds:
                world_path = os.path.join(data_dir, world)
                for root, _dirs, files in os.walk(world_path):
                    for file in files:
                        # session.lock is held open by the running server and isn't needed to restore.
                        if file == "session.lock":
                            continue
                        file_path = os.path.join(root, file)
                        zipf.write(file_path, os.path.relpath(file_path, data_dir))
        os.replace(tmp_path, zip_path)
    finally:
        if saving_paused:
            _rcon(instance_path, "save-on")
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    stat = os.stat(zip_path)
    return {"name": name, "size": stat.st_size, "created": stat.st_mtime}


def prune_backups(instance_path: str, keep: int) -> None:
    for old in list_backups(instance_path)[keep:]:
        try:
            os.remove(os.path.join(backups_dir(instance_path), old["name"]))
        except OSError as e:
            print(f"Failed to prune backup {old['name']}: {e}")


def restore_backup(instance_path: str, name: str) -> List[str]:
    """Replace the world folders contained in the backup. Caller must ensure the server is stopped."""
    zip_path = backup_file_path(instance_path, name)
    data_dir = os.path.realpath(os.path.join(instance_path, "data"))
    with zipfile.ZipFile(zip_path, "r") as zipf:
        members = zipf.namelist()
        worlds = sorted({m.replace("\\", "/").split("/", 1)[0] for m in members if m.strip("/")})
        for member in members:
            target = os.path.realpath(os.path.join(data_dir, member))
            if not target.startswith(data_dir + os.sep):
                raise ValueError("Backup contains an unsafe path.")
        for world in worlds:
            shutil.rmtree(os.path.join(data_dir, world), ignore_errors=True)
        zipf.extractall(data_dir)
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
