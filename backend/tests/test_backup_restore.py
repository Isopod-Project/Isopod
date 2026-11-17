"""Restoring backups and snapshots: a corrupt archive must leave the current files alone."""
import json
import os
import tempfile
import unittest
import zipfile
from unittest import mock

from backend import backups


def _write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def _corrupt_member(zip_path: str, member: str) -> None:
    """Flip a byte in a member's stored data so its CRC check fails, leaving the rest readable."""
    with zipfile.ZipFile(zip_path) as zipf:
        info = zipf.getinfo(member)
    with open(zip_path, "r+b") as f:
        f.seek(info.header_offset + 26)
        name_len = int.from_bytes(f.read(2), "little")
        extra_len = int.from_bytes(f.read(2), "little")
        data_start = info.header_offset + 30 + name_len + extra_len
        f.seek(data_start)
        byte = f.read(1)
        f.seek(data_start)
        f.write(bytes([byte[0] ^ 0xFF]))


class RestoreTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.instance = os.path.join(tmp.name, "server")
        self.data = os.path.join(self.instance, "data")
        self.bdir = os.path.join(self.instance, "backups")
        os.makedirs(self.bdir)
        _write(os.path.join(self.data, "world", "level.dat"), "current")
        _write(os.path.join(self.data, "world", "region", "r.0.0.mca"), "current region")
        _write(os.path.join(self.data, "mods", "current.jar"), "current mod")
        _write(os.path.join(self.data, "server.properties"), "current props")
        _write(os.path.join(self.instance, "docker-compose.yml"), "current compose")

    def _make_backup(self, name: str) -> str:
        path = os.path.join(self.bdir, name)
        with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as zipf:
            zipf.writestr("world/level.dat", "old")
            zipf.writestr("world/region/r.0.0.mca", "old region " * 50)
        return path

    def _make_snapshot(self, name: str) -> str:
        path = os.path.join(self.bdir, name)
        manifest = {"reason": "test", "worlds": ["world"], "data_dirs": ["mods"],
                    "files": ["docker-compose.yml", "data/server.properties"]}
        with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as zipf:
            zipf.writestr("data/world/level.dat", "old")
            zipf.writestr("data/world/region/r.0.0.mca", "old region " * 50)
            zipf.writestr("data/mods/old.jar", "old mod")
            zipf.writestr("data/server.properties", "old props")
            zipf.writestr("docker-compose.yml", "old compose")
            zipf.writestr(backups.SNAPSHOT_MANIFEST, json.dumps(manifest))
        return path

    def _assert_current_untouched(self):
        self.assertEqual(_read(os.path.join(self.data, "world", "level.dat")), "current")
        self.assertEqual(_read(os.path.join(self.data, "world", "region", "r.0.0.mca")), "current region")
        self.assertEqual(os.listdir(os.path.join(self.data, "mods")), ["current.jar"])
        self.assertEqual(_read(os.path.join(self.data, "server.properties")), "current props")
        self.assertEqual(_read(os.path.join(self.instance, "docker-compose.yml")), "current compose")
        leftovers = [n for n in os.listdir(self.data) + os.listdir(self.instance) if n.startswith(".isopod-")]
        self.assertEqual(leftovers, [])

    def test_valid_backup_replaces_world(self):
        self._make_backup("backup-20260101-000000.zip")
        self.assertEqual(backups.restore_backup(self.instance, "backup-20260101-000000.zip"), ["world"])
        self.assertEqual(_read(os.path.join(self.data, "world", "level.dat")), "old")
        self.assertEqual(sorted(os.listdir(self.data)), ["mods", "server.properties", "world"])
        self.assertFalse(any(n.startswith(".isopod-") for n in os.listdir(self.data)))

    def test_corrupt_backup_keeps_current_world(self):
        path = self._make_backup("backup-20260101-000000.zip")
        _corrupt_member(path, "world/region/r.0.0.mca")
        with self.assertRaises(zipfile.BadZipFile):
            backups.restore_backup(self.instance, "backup-20260101-000000.zip")
        self._assert_current_untouched()

    def test_valid_snapshot_rolls_everything_back(self):
        self._make_snapshot("snapshot-20260101-000000.zip")
        backups.restore_snapshot(self.instance, "snapshot-20260101-000000.zip")
        self.assertEqual(_read(os.path.join(self.data, "world", "level.dat")), "old")
        # Mods added after the snapshot are removed.
        self.assertEqual(os.listdir(os.path.join(self.data, "mods")), ["old.jar"])
        self.assertEqual(_read(os.path.join(self.data, "server.properties")), "old props")
        self.assertEqual(_read(os.path.join(self.instance, "docker-compose.yml")), "old compose")
        self.assertFalse(any(n.startswith(".isopod-") for n in os.listdir(self.instance)))

    def test_corrupt_snapshot_keeps_current_files(self):
        path = self._make_snapshot("snapshot-20260101-000000.zip")
        _corrupt_member(path, "data/world/region/r.0.0.mca")
        with self.assertRaises(zipfile.BadZipFile):
            backups.restore_snapshot(self.instance, "snapshot-20260101-000000.zip")
        self._assert_current_untouched()

    def test_failure_during_swap_puts_old_files_back(self):
        self._make_snapshot("snapshot-20260101-000000.zip")
        real_replace = os.replace
        staged_moves = {"n": 0}

        def flaky_replace(src, dst):
            # Fail on the second staged path moved into place, after everything was moved aside.
            if ".isopod-restore-" in str(src):
                staged_moves["n"] += 1
                if staged_moves["n"] == 2:
                    raise OSError("disk full")
            return real_replace(src, dst)

        with mock.patch.object(backups.os, "replace", side_effect=flaky_replace):
            with self.assertRaises(OSError):
                backups.restore_snapshot(self.instance, "snapshot-20260101-000000.zip")
        self._assert_current_untouched()


if __name__ == "__main__":
    unittest.main()
