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

    def post_update(self, latest, install_error=None):
        async def latest_release():
            return latest
        with mock.patch.object(main, "self_update_compose_file", return_value=None), \
                mock.patch.object(main, "get_latest_release", side_effect=latest_release), \
                mock.patch.object(main.self_update, "image_rev", return_value=1), \
                mock.patch.object(main.self_update, "stop_docker_daemon"), \
                mock.patch.object(main.os, "_exit") as exit_process, \
                mock.patch.object(main.subprocess, "Popen") as popen, \
                mock.patch.object(main.self_update, "install", side_effect=install_error) as install:
            res = self.client.post("/api/system/update")
        popen.assert_not_called()
        return res, install, exit_process

    def test_update_is_refused_without_a_bundle(self):
        res, install, exit_process = self.post_update({"has_update": True, "bundle": None})
        self.assertEqual(res.status_code, 409)
        install.assert_not_called()
        exit_process.assert_not_called()
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, ".isopod_version")))

    def test_update_is_refused_when_already_up_to_date(self):
        res, install, _ = self.post_update({"has_update": False, "bundle": {"tag": "v9.0.0"}})
        self.assertEqual(res.status_code, 409)
        install.assert_not_called()

    def test_update_installs_the_bundle(self):
        bundle = {"tag": "v9.0.0"}
        res, install, _ = self.post_update({"has_update": True, "bundle": bundle})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["version"], "v9.0.0")
        install.assert_called_once_with(bundle, self.tmp.name)

    def test_failed_install_reports_the_reason(self):
        res, _, exit_process = self.post_update(
            {"has_update": True, "bundle": {"tag": "v9.0.0"}},
            install_error=main.self_update.UpdateError("Bad bundle"),
        )
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()["detail"], "Bad bundle")
        exit_process.assert_not_called()

    def test_compose_file_is_found_from_the_working_directory(self):
        cwd = os.getcwd()
        self.addCleanup(os.chdir, cwd)
        os.chdir(self.tmp.name)
        self.assertIsNone(main.self_update_compose_file())
        open("isopod-compose.yml", "w", encoding="utf-8").close()
        self.assertEqual(main.self_update_compose_file(), "isopod-compose.yml")


if __name__ == "__main__":
    unittest.main()
