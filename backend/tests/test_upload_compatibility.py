"""Exercise the real upload route through FastAPI's multipart/form binding."""
import os
import tempfile
import unittest
from unittest import mock

from fastapi.testclient import TestClient

from backend import main


class UploadCompatibilityTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        for patch in (
            mock.patch.object(main, "get_instance_path", return_value=self.root),
            mock.patch.object(main.auth_store, "username_for", return_value="admin"),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        self.client = TestClient(main.app)
        self.addCleanup(self.client.close)
        self.url = "/api/instances/test/files/upload"

    def test_multiple_binary_files_and_form_fields(self):
        for payload in (b"original\x00\xff", b"replacement\x00\xfe"):
            response = self.client.post(
                self.url,
                data={"path": "nested", "collision_strategy": "rename_new"},
                files=[("files", ("one.bin", payload)), ("files", ("two.bin", b"two"))],
            )
            self.assertEqual(response.status_code, 200, response.text)
            uploaded = response.json()["uploaded"]
            self.assertEqual(len(uploaded), 2)
            with open(os.path.join(self.root, "nested", uploaded[0]), "rb") as saved:
                self.assertEqual(saved.read(), payload)
            with open(os.path.join(self.root, "nested", uploaded[1]), "rb") as saved:
                self.assertEqual(saved.read(), b"two")
        self.assertEqual(len(os.listdir(os.path.join(self.root, "nested"))), 4)

    def test_missing_file_returns_validation_error(self):
        response = self.client.post(self.url, data={"path": "."})
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["detail"][0]["loc"], ["body", "files"])
        self.assertEqual(os.listdir(self.root), [])

    def test_unauthenticated_upload_is_rejected_before_writing(self):
        with mock.patch.object(main.auth_store, "username_for", return_value=None):
            response = self.client.post(self.url, files={"files": ("one.bin", b"one")})
        self.assertEqual(response.status_code, 401, response.text)
        self.assertEqual(os.listdir(self.root), [])
