"""The dashboard updater: reported version and when an install can update itself."""
import os
import tempfile
import unittest
from unittest import mock

import httpx

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

    def test_update_check_only_offers_newer_releases(self):
        cases = [
            ("v0.5.0", "v0.4.1", False),
            ("v0.5.0", "v0.5.0", False),
            ("v0.5.0", "v0.5.1", True),
            ("v0.5.0", "v0.6.0", True),
            ("v0.5.0", "v1.0.0", True),
            ("v0.9.0", "v0.10.0", True),
            ("v0.10.0", "v0.9.0", False),
            ("v1.2.9", "v1.2.10", True),
            ("v1.2.10", "v1.2.9", False),
            ("v0.5.0", "0.5.0", False),
            ("0.5.0", "v0.5.1", True),
            ("v0.5.0", "Unknown", False),
            ("v0.5.0", "v0.6.0-rc.1", False),
            ("Unknown", "v0.6.0", False),
        ]
        for current, latest, expected in cases:
            with self.subTest(current=current, latest=latest):
                response = httpx.Response(200, json={"tag_name": latest, "assets": []})
                with mock.patch.object(main, "get_current_version", return_value=current), \
                        mock.patch.object(main, "cached_update_info", None), \
                        mock.patch.object(main.httpx, "AsyncClient") as client:
                    client.return_value.__aenter__.return_value.get.return_value = response
                    result = self.client.get("/api/system/check-updates?force=true")
                self.assertEqual(result.status_code, 200)
                info = result.json()
                self.assertEqual(info["current_version"], current)
                self.assertEqual(info["latest_version"], latest)
                self.assertEqual(info["has_update"], expected)

    def test_update_refuses_an_older_release_even_with_a_bundle(self):
        tag = "v0.4.1"
        name = main.self_update.bundle_name(tag, "amd64")
        prefix = f"https://github.com/{main.GITHUB_REPO}/releases/download/{tag}/"
        response = httpx.Response(200, json={
            "tag_name": tag,
            "assets": [
                {"name": asset, "browser_download_url": prefix + asset}
                for asset in (name, name + ".sha256")
            ],
        })
        with mock.patch.object(main, "get_current_version", return_value="v0.5.0"), \
                mock.patch.object(main, "self_update_compose_file", return_value=None), \
                mock.patch.object(main.httpx, "AsyncClient") as client, \
                mock.patch.object(main.self_update.platform, "machine", return_value="x86_64"), \
                mock.patch.object(main.self_update, "image_rev", return_value=1), \
                mock.patch.object(main.self_update, "stop_docker_daemon"), \
                mock.patch.object(main.os, "_exit"), \
                mock.patch.object(main.self_update, "install") as install:
            client.return_value.__aenter__.return_value.get.return_value = response
            result = self.client.post("/api/system/update")
        self.assertEqual(result.status_code, 409)
        install.assert_not_called()

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
