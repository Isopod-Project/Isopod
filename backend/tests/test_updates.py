"""The dashboard updater: reported version and when an install can update itself."""
import os
import tempfile
import unittest
from unittest import mock

from fastapi.testclient import TestClient

from backend import main


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patches = [
            mock.patch.object(main, "SERVERS_DIR", self.tmp.name),
            mock.patch.object(main.auth_store, "username_for", return_value="admin"),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.client = TestClient(main.app)

    def test_version_ignores_a_stale_version_file(self):
        with open(os.path.join(self.tmp.name, ".isopod_version"), "w", encoding="utf-8") as f:
            f.write("v99.0.0")
        self.assertEqual(self.client.get("/api/system/info").json()["version"], main.ISOPOD_VERSION)

    def test_update_is_refused_without_a_compose_file(self):
        with mock.patch.object(main, "self_update_compose_file", return_value=None), \
                mock.patch.object(main.subprocess, "Popen") as popen, \
                mock.patch.object(main.os, "_exit") as exit_process:
            res = self.client.post("/api/system/update")
        self.assertEqual(res.status_code, 409)
        popen.assert_not_called()
        exit_process.assert_not_called()
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, ".isopod_version")))

    def test_compose_file_is_found_from_the_working_directory(self):
        cwd = os.getcwd()
        self.addCleanup(os.chdir, cwd)
        os.chdir(self.tmp.name)
        self.assertIsNone(main.self_update_compose_file())
        open("isopod-compose.yml", "w", encoding="utf-8").close()
        self.assertEqual(main.self_update_compose_file(), "isopod-compose.yml")


if __name__ == "__main__":
    unittest.main()
