"""Update Now on a standard install: finding, checking, and installing a release bundle."""
import hashlib
import io
import json
import os
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

from backend import self_update

REPO = "Isopod-Project/Isopod"
TAG = "v9.0.0"


def release(names=None, tag=TAG, host="https://github.com"):
    names = names if names is not None else [f"isopod-app-{tag}-amd64.tar.gz", f"isopod-app-{tag}-amd64.tar.gz.sha256"]
    return {
        "tag_name": tag,
        "assets": [{"name": n, "browser_download_url": f"{host}/{REPO}/releases/download/{tag}/{n}"} for n in names],
    }


def bundle_bytes(manifest=None, extra=None):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        files = {"manifest.json": json.dumps(manifest if manifest is not None else {"version": TAG, "required_image_rev": 1})}
        files.update(extra or {})
        for name, content in files.items():
            data = content.encode()
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


class FindBundleTests(unittest.TestCase):
    def test_finds_this_machines_bundle(self):
        bundle = self_update.find_bundle(release(), REPO, machine="x86_64")
        self.assertEqual(bundle["name"], f"isopod-app-{TAG}-amd64.tar.gz")

    def test_no_bundle_for_another_architecture(self):
        self.assertIsNone(self_update.find_bundle(release(), REPO, machine="aarch64"))

    def test_older_releases_without_bundles_have_none(self):
        self.assertIsNone(self_update.find_bundle(release(names=[]), REPO, machine="x86_64"))

    def test_rejects_a_missing_checksum(self):
        self.assertIsNone(self_update.find_bundle(release(names=[f"isopod-app-{TAG}-amd64.tar.gz"]), REPO, machine="x86_64"))

    def test_rejects_another_host(self):
        self.assertIsNone(self_update.find_bundle(release(host="https://evil.example"), REPO, machine="x86_64"))

    def test_rejects_a_tag_that_could_escape_a_path(self):
        self.assertIsNone(self_update.find_bundle(release(tag="../v9.0.0"), REPO, machine="x86_64"))


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = self_update.app_root(self.tmp.name)
        self.bundle = {"tag": TAG, "name": "b.tar.gz", "url": "bundle", "sha256_url": "sum"}
        for p in (
            mock.patch.object(self_update, "image_rev", return_value=1),
            mock.patch.object(self_update, "_smoke_test"),
        ):
            p.start()
            self.addCleanup(p.stop)

    def run_install(self, data, checksum=None):
        checksum = checksum if checksum is not None else hashlib.sha256(data).hexdigest()

        def download(url, dest):
            content = data if url == "bundle" else f"{checksum}  b.tar.gz\n".encode()
            with open(dest, "wb") as f:
                f.write(content)
            return hashlib.sha256(content).hexdigest()

        with mock.patch.object(self_update, "_download", side_effect=download):
            self_update.install(self.bundle, self.tmp.name)

    def read(self, name):
        with open(os.path.join(self.root, name), encoding="utf-8") as f:
            return f.read()

    def assert_not_pending(self):
        self.assertFalse(os.path.exists(os.path.join(self.root, "pending")))

    def test_good_bundle_is_unpacked_and_pending(self):
        self.run_install(bundle_bytes(extra={"backend/main.py": "x"}))
        self.assertEqual(self.read("pending"), TAG)
        self.assertEqual(self.read(f"versions/{TAG}/backend/main.py"), "x")

    def test_bad_checksum_changes_nothing(self):
        with self.assertRaises(self_update.UpdateError):
            self.run_install(bundle_bytes(), checksum="0" * 64)
        self.assert_not_pending()
        self.assertEqual(os.listdir(os.path.join(self.root, "versions")), [])

    def test_wrong_version_is_refused(self):
        with self.assertRaises(self_update.UpdateError):
            self.run_install(bundle_bytes({"version": "v1.0.0", "required_image_rev": 1}))
        self.assert_not_pending()

    def test_newer_image_requirement_is_refused(self):
        with self.assertRaises(self_update.UpdateError):
            self.run_install(bundle_bytes({"version": TAG, "required_image_rev": 2}))
        self.assert_not_pending()

    @unittest.skipIf(sys.version_info < (3, 11, 4), "tarfile filters need Python 3.11.4")
    def test_path_traversal_is_refused(self):
        with self.assertRaises(tarfile.TarError):
            self.run_install(bundle_bytes(extra={"../../escape.txt": "x"}))
        self.assert_not_pending()
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, "escape.txt")))

    def test_failed_smoke_test_changes_nothing(self):
        with mock.patch.object(self_update, "_smoke_test", side_effect=self_update.UpdateError("bad")):
            with self.assertRaises(self_update.UpdateError):
                self.run_install(bundle_bytes())
        self.assert_not_pending()

    def test_start_promotes_the_pending_version(self):
        self.run_install(bundle_bytes())
        open(os.path.join(self.root, "tried"), "w", encoding="utf-8").close()
        self_update.mark_started(self.tmp.name, TAG)
        self.assertEqual(self.read("active"), TAG)
        self.assert_not_pending()
        self.assertFalse(os.path.exists(os.path.join(self.root, "tried")))

    def test_starting_another_version_leaves_pending_alone(self):
        self.run_install(bundle_bytes())
        self_update.mark_started(self.tmp.name, "v0.1.0")
        self.assertEqual(self.read("pending"), TAG)

    def test_only_the_new_and_active_versions_are_kept(self):
        for tag in ("v1.0.0", "v2.0.0"):
            os.makedirs(os.path.join(self.root, "versions", tag))
        with open(os.path.join(self.root, "active"), "w", encoding="utf-8") as f:
            f.write("v2.0.0")
        self.run_install(bundle_bytes())
        self.assertEqual(sorted(os.listdir(os.path.join(self.root, "versions"))), ["v2.0.0", TAG])


class StopDaemonTests(unittest.TestCase):
    def test_a_zombie_counts_as_stopped(self):
        stat = mock.mock_open(read_data="42 (dockerd) Z 1 42")
        with mock.patch("builtins.open", stat):
            self.assertFalse(self_update._is_running(42))

    def test_a_sleeping_daemon_is_running(self):
        stat = mock.mock_open(read_data="42 (dockerd) S 1 42")
        with mock.patch("builtins.open", stat):
            self.assertTrue(self_update._is_running(42))

    def test_a_missing_process_is_stopped(self):
        with mock.patch("builtins.open", side_effect=FileNotFoundError):
            self.assertFalse(self_update._is_running(42))


if __name__ == "__main__":
    unittest.main()
