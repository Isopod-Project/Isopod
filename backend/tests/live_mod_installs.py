"""Opt-in provider integration checks. See Documentation/developers/development_guide.md."""

import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch
from uuid import uuid4
import zipfile

from fastapi.testclient import TestClient
import httpx
import yaml

from backend import main


MC_VERSION = "1.21.1"
MODRINTH_PACK = "YkG1DyHE"  # Fabric Server Optimization
MODRINTH_PACK_VERSION = "vtGmZsbn"
CURSEFORGE_FABRIC_API = "306612"
CURSEFORGE_ATM9 = "715572"
MISSING_MOD = "isopod-integration-nonexistent-project"


class LiveModInstalls(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory(prefix="isopod-mods-")))
        self.enterContext(patch.object(main, "SERVERS_DIR", str(self.root)))
        self.enterContext(patch.object(main.auth_store, "path", str(self.root / ".isopod_auth.json")))
        self.enterContext(patch.object(main, "mod_metadata_cache", {}))
        # Do not enter the TestClient lifespan. The app's background tasks manage Docker
        # instances and backups, which are outside the request paths under test.
        self.client = TestClient(main.app, base_url="http://localhost")
        self.addCleanup(self.client.close)
        self.request("POST", "/api/auth/setup", json={
            "username": "integration",
            "password": uuid4().hex,
        })

    def request(self, method, path, status=200, **kwargs):
        response = self.client.request(method, path, **kwargs)
        self.assertEqual(response.status_code, status, response.text)
        return response.json()

    def create(self, **kwargs):
        result = self.request("POST", "/api/instances", json={
            "name": f"isopod-mods-test-{uuid4().hex[:12]}",
            "template": "fabric",
            "port": 0,
            "version": MC_VERSION,
            **kwargs,
        })
        return result["id"]

    def configure_mods(self, instance, **environment):
        endpoint = f"/api/instances/{instance}/config"
        config = self.request("GET", endpoint)
        config["environment"].update(environment)
        return self.request("PUT", endpoint, json=config)

    def installed_mod(self, instance, mod_id, *, project_id=None):
        listed = self.request("GET", f"/api/instances/{instance}/mods")
        matches = [mod for mod in listed if mod["id"] == (project_id or mod_id) and mod["source"] == "file"]
        self.assertEqual(len(matches), 1, listed)
        self.assertTrue(matches[0]["enabled"])
        filename = matches[0]["filename"]
        jar = self.root / instance / "data" / "mods" / filename
        with zipfile.ZipFile(jar) as archive:
            self.assertEqual(json.loads(archive.read("fabric.mod.json"))["id"], mod_id)
        return matches[0]

    def test_modrinth_install_and_failed_sync(self):
        instance = self.create()
        result = self.configure_mods(instance, MODRINTH_PROJECTS=f"lithium,{MISSING_MOD}")
        self.assertEqual(result["downloaded"], ["lithium"])
        self.assertEqual(result["failed"], [MISSING_MOD])
        self.installed_mod(instance, "lithium")

        # The dashboard's Check for Updates action consumes this response.
        jars = list((self.root / instance / "data" / "mods").glob("*.jar"))
        self.assertEqual(len(jars), 1)
        retry = self.request("POST", f"/api/instances/{instance}/mods/sync")
        self.assertEqual(retry["downloaded"], [])
        self.assertEqual(retry["failed"], [MISSING_MOD])
        self.assertEqual(list(jars[0].parent.glob("*.jar")), jars)

    def test_curseforge_without_key(self):
        instance = self.create()
        with patch.object(main, "CF_API_KEY", ""):
            result = self.request("GET", "/api/mods/search/curseforge", status=503)
            self.assertEqual(result["detail"], "CURSEFORGE_API_KEY is not set")
            result = self.configure_mods(instance, CURSEFORGE_FILES=CURSEFORGE_FABRIC_API)
        self.assertEqual(result["downloaded"], [])
        self.assertEqual(result["failed"], [CURSEFORGE_FABRIC_API])
        self.assertEqual(list((self.root / instance / "data" / "mods").iterdir()), [])

    @unittest.skipUnless(os.getenv("ISOPOD_TEST_CURSEFORGE") == "1", "Set ISOPOD_TEST_CURSEFORGE=1 for live CurseForge")
    def test_curseforge_install_with_key(self):
        self.assertTrue(main.CF_API_KEY, "Set CURSEFORGE_API_KEY to a valid CurseForge API key")
        hits = self.request("GET", "/api/mods/search/curseforge", params={
            "q": "Fabric API", "mc_version": MC_VERSION, "loader": "fabric",
        })
        self.assertIn(CURSEFORGE_FABRIC_API, {str(hit["id"]) for hit in hits})
        instance = self.create()
        result = self.configure_mods(instance, CURSEFORGE_FILES=CURSEFORGE_FABRIC_API)
        self.assertEqual(result["failed"], [])
        self.assertEqual(result["downloaded"], ["Fabric API"])
        installed = self.installed_mod(instance, "fabric-api", project_id=CURSEFORGE_FABRIC_API)
        self.assertEqual(installed["provider"], "curseforge")

    @unittest.skipUnless(os.getenv("ISOPOD_TEST_CURSEFORGE") == "1", "Set ISOPOD_TEST_CURSEFORGE=1 for live CurseForge")
    def test_curseforge_modpack_configuration_with_key(self):
        self.assertTrue(main.CF_API_KEY, "Set CURSEFORGE_API_KEY to a valid CurseForge API key")
        versions = self.request("GET", f"/api/mods/curseforge/{CURSEFORGE_ATM9}/versions")
        release = next((v for v in versions if "1.20.1" in v["game_versions"] and "forge" in v["loaders"]), None)
        self.assertIsNotNone(release, "All the Mods 9 has no listed Forge file for Minecraft 1.20.1")
        instance = self.create(
            template="auto_curseforge", cf_id=CURSEFORGE_ATM9, modpack_version=release["id"],
        )
        env = self.request("GET", f"/api/instances/{instance}/config")["environment"]
        self.assertEqual(env["TYPE"], "AUTO_CURSEFORGE")
        self.assertEqual(env["CF_SLUG"], "all-the-mods-9")
        self.assertEqual(env["CF_FILE_ID"], release["id"])
        self.assertEqual(env["CF_API_KEY"], "${CF_API_KEY}")
        self.assertEqual(env["VERSION"], "1.20.1")

    @unittest.skipUnless(os.getenv("ISOPOD_TEST_DOCKER") == "1", "Set ISOPOD_TEST_DOCKER=1 for first boot")
    def test_modrinth_modpack_first_boot(self):
        instance = self.create(
            template="modrinth", modrinth_id=MODRINTH_PACK,
            modpack_version=MODRINTH_PACK_VERSION, memory="2G",
        )
        path = self.root / instance
        config = self.request("GET", f"/api/instances/{instance}/config")
        self.assertEqual(config["environment"]["MODRINTH_VERSION"], MODRINTH_PACK_VERSION)
        self.assertEqual(config["environment"]["ISOPOD_MODPACK_LOADER"], "FABRIC")
        self.assertEqual(config["environment"]["VERSION"], "1.19.3")
        preview = self.request("GET", f"/api/instances/{instance}/mods")
        candidates = [mod for mod in preview if mod["source"] == "modpack" and mod["enabled"]]
        self.assertTrue(candidates, preview)
        self.assertEqual(list((path / "data" / "mods").glob("*.jar")), [])

        # Compare against the provider's manifest. Isopod's cached preview stores display metadata.
        release = httpx.get(f"https://api.modrinth.com/v2/version/{MODRINTH_PACK_VERSION}", timeout=20)
        mrpack = next(file for file in release.raise_for_status().json()["files"] if file["filename"].endswith(".mrpack"))
        download = httpx.get(mrpack["url"], follow_redirects=True, timeout=45)
        with zipfile.ZipFile(io.BytesIO(download.raise_for_status().content)) as archive:
            manifest = json.loads(archive.read("modrinth.index.json"))
        hashes = {Path(file["path"]).name: file["hashes"]["sha1"] for file in manifest["files"] if file["path"].startswith("mods/")}

        # Prevent the disposable Minecraft server from publishing a host port or
        # restarting after failure. Everything else comes from Isopod's generator.
        compose_path = path / "docker-compose.yml"
        compose = yaml.safe_load(compose_path.read_text())
        service = compose["services"]["mc"]
        service.pop("ports")
        service["restart"] = "no"
        if hasattr(os, "getuid"):
            service["environment"].extend([f"UID={os.getuid()}", f"GID={os.getgid()}"])
        compose_path.write_text(yaml.safe_dump(compose))
        self.enterContext(patch.dict(os.environ, {
            "COMPOSE_FILE": str(compose_path),
            "COMPOSE_PROJECT_NAME": instance,
        }))
        self.addCleanup(self.compose, path, "down", "--volumes", "--timeout", "10")

        self.request("POST", f"/api/instances/{instance}/start")
        self.wait_for_minecraft(path)
        installed = self.request("GET", f"/api/instances/{instance}/mods")
        installed_files = {mod["filename"] for mod in installed if mod["source"] == "file" and mod["enabled"]}
        installed_pack_files = installed_files & {mod["filename"] for mod in candidates}
        self.assertTrue(installed_pack_files, installed)
        for filename in installed_pack_files:
            with (path / "data" / "mods" / filename).open("rb") as jar:
                self.assertEqual(hashlib.file_digest(jar, "sha1").hexdigest(), hashes[filename], filename)

    def compose(self, path, *args):
        result = subprocess.run(
            ["docker", "compose", *args], cwd=path,
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def wait_for_minecraft(self, path):
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            states = self.compose(path, "ps", "--all", "--format", "{{.State}} {{.Health}}")
            if states.strip() == "running healthy":
                return
            if "exited" in states or "dead" in states:
                break
            time.sleep(3)
        logs = self.compose(path, "logs", "--no-color", "--tail", "80", "mc")
        self.fail(f"Minecraft did not become healthy. Compose state: {states.strip()}\n{logs}")
