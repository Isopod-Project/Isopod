"""Exercise CurseForge instance creation at the outbound HTTP boundary."""
import asyncio
import os
import tempfile
import unittest
from unittest.mock import patch

import httpx
from fastapi import HTTPException
from backend import main


class CurseForgeSecurityTests(unittest.TestCase):
    def create(self, project="123", file="456", latest=None, status=200):
        self.requests = []
        def handler(request):
            self.requests.append(request)
            return httpx.Response(status, json={"data": {
                "slug": "test-pack", "latestFiles": latest or [],
                "gameVersions": ["1.20.1"],
            }}, headers={"Location": "http://127.0.0.1/private"})
        factory = httpx.AsyncClient
        with tempfile.TemporaryDirectory() as folder, \
                patch.object(main, "SERVERS_DIR", folder), \
                patch.object(main, "get_settings", return_value={}), \
                patch.object(main, "cf_api_headers", return_value={"x-api-key": "test-secret"}), \
                patch.object(main.httpx, "AsyncClient", side_effect=lambda **kw: factory(transport=httpx.MockTransport(handler), **kw)):
            try:
                return asyncio.run(main.create_instance(main.CreateInstanceRequest(
                    name="Security pack", template="AUTO_CURSEFORGE", port=25565,
                    version=None, cf_id=project, modpack_version=file,
                )))
            finally:
                self.remaining = os.listdir(folder)

    def test_rejects_file_path_and_query_injection_before_network_or_disk(self):
        for value in ("../../search", "456?other=1", "456#fragment", "https://evil.example", "//127.0.0.1", "%2e%2e", "１２３", "123\n", "1" * 21, ""):
            with self.subTest(value=value):
                with self.assertRaises(HTTPException) as caught:
                    self.create(file=value)
                self.assertEqual(caught.exception.status_code, 400)
                self.assertEqual(self.requests, [])
                self.assertEqual(self.remaining, [])

    def test_project_ids_are_ascii_decimal(self):
        for value in ("../search", "１２３", "²", "123?x=1"):
            with self.subTest(value=value):
                with self.assertRaises(HTTPException):
                    self.create(project=value)
                self.assertEqual(self.requests, [])
                self.assertEqual(self.remaining, [])

    def test_selected_file_uses_expected_origin_and_path(self):
        self.create()
        self.assertEqual([str(r.url) for r in self.requests], [
            "https://api.curseforge.com/v1/mods/123",
            "https://api.curseforge.com/v1/mods/123/files/456",
        ])
        self.assertTrue(all(r.headers["x-api-key"] == "test-secret" for r in self.requests))

    def test_latest_file_keeps_normal_install_working(self):
        self.create(file=None, latest=[{"id": 789, "gameVersions": ["1.20.1"]}])
        self.assertEqual(len(self.requests), 2)
        self.assertTrue(all(r.url.host == "api.curseforge.com" for r in self.requests))

    def test_latest_file_is_also_validated(self):
        with self.assertRaises(HTTPException):
            self.create(file=None, latest=[{"id": "../../search"}])
        self.assertEqual(len(self.requests), 2)
        self.assertEqual(self.remaining, [])

    def test_redirect_is_not_followed_with_api_key(self):
        with self.assertRaises(HTTPException) as caught:
            self.create(status=302)
        self.assertEqual(caught.exception.status_code, 502)
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(self.requests[0].url.host, "api.curseforge.com")
