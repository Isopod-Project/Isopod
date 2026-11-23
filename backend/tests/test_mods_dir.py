"""The mods folder isn't created by reads, and folders the backend makes match the data owner (#202).

Run from the repo root: python -m unittest discover backend/tests
"""
import os
import stat
import tempfile
import unittest
from unittest import mock

from backend import main


class ModsDirTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.instance = os.path.join(self.tmp.name, "pack")
        os.makedirs(os.path.join(self.instance, "data"))
        patcher = mock.patch.object(main, "get_instance_path", return_value=self.instance)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.mods = os.path.join(self.instance, "data", "mods")

    def test_read_only_lookup_does_not_create_the_folder(self):
        self.assertEqual(main.get_instance_mods_dir("pack", create=False), self.mods)
        self.assertFalse(os.path.exists(self.mods))

    def test_listing_mods_does_not_create_the_folder(self):
        import asyncio
        self.assertEqual(asyncio.run(main.list_instance_mods("pack")), [])
        self.assertFalse(os.path.exists(self.mods))

    def test_writers_still_get_a_folder(self):
        self.assertEqual(main.get_instance_mods_dir("pack"), self.mods)
        self.assertTrue(os.path.isdir(self.mods))

    def test_new_folders_take_the_data_folder_owner(self):
        fake_owner = mock.Mock(st_uid=1000, st_gid=1000, st_mode=stat.S_IFDIR | 0o755)
        chowned = []
        real_stat = os.stat

        def fake_stat(path, *a, **kw):
            if os.path.abspath(path) == os.path.abspath(os.path.join(self.instance, "data")):
                return fake_owner
            return real_stat(path, *a, **kw)

        with mock.patch.object(main.os, "stat", side_effect=fake_stat), \
             mock.patch.object(main.os, "chown", side_effect=lambda p, u, g: chowned.append((p, u, g)), create=True):
            main.make_instance_dir(self.instance, os.path.join(self.mods, "sub"))

        self.assertEqual(sorted(chowned), sorted([
            (os.path.abspath(self.mods), 1000, 1000),
            (os.path.abspath(os.path.join(self.mods, "sub")), 1000, 1000),
        ]))

    def test_existing_folders_are_left_alone(self):
        os.makedirs(self.mods)
        with mock.patch.object(main.os, "chown", create=True) as chown:
            main.make_instance_dir(self.instance, self.mods)
        chown.assert_not_called()


if __name__ == "__main__":
    unittest.main()
