"""Servers are only created after the user accepts the Minecraft EULA (#217)."""
import asyncio
import io
import os
import tempfile
import unittest
import zipfile
from unittest.mock import AsyncMock, patch

import yaml
from fastapi import HTTPException, UploadFile
from backend import main


def compose_env(folder, slug):
    with open(os.path.join(folder, slug, "docker-compose.yml")) as f:
        return main.env_as_dict(yaml.safe_load(f)["services"]["mc"]["environment"])


def zip_upload(entries):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in entries.items():
            z.writestr(name, data)
    buf.seek(0)
    return UploadFile(file=buf, filename="world.zip")


class EulaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = self.tmp.name
        self.patches = [patch.object(main, "SERVERS_DIR", self.folder),
                        patch.object(main, "get_settings", return_value={})]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def create(self, template="vanilla", **kw):
        return asyncio.run(main.create_instance(main.CreateInstanceRequest(
            name="Eula test", template=template, port=25565, **kw)))

    def import_zip(self, entries, eula_accepted):
        return asyncio.run(main.import_instance(
            file=zip_upload(entries), name="Imported", port=None, difficulty=None, gamemode=None,
            seed=None, level_type=None, generate_structures=None, memory=None, group=None,
            eula_accepted=eula_accepted))

    def test_create_without_acceptance_is_refused_and_writes_nothing(self):
        for template in ("vanilla", "bedrock"):
            with self.subTest(template=template):
                with self.assertRaises(HTTPException) as caught:
                    self.create(template=template)
                self.assertEqual(caught.exception.status_code, 400)
                self.assertIn("EULA", caught.exception.detail)
                self.assertEqual(os.listdir(self.folder), [])

    def test_create_with_acceptance_writes_eula(self):
        slug = self.create(eula_accepted=True)["id"]
        self.assertEqual(compose_env(self.folder, slug)["EULA"], "TRUE")

    def test_bedrock_create_with_acceptance_writes_eula(self):
        slug = self.create(template="bedrock", eula_accepted=True)["id"]
        self.assertEqual(compose_env(self.folder, slug)["EULA"], "TRUE")

    def test_import_without_acceptance_is_refused(self):
        for value in (None, "false", ""):
            with self.subTest(value=value):
                with self.assertRaises(HTTPException) as caught:
                    self.import_zip({"world/level.dat": b"x"}, value)
                self.assertEqual(caught.exception.status_code, 400)
                self.assertEqual(os.listdir(self.folder), [])

    def test_imported_world_records_acceptance(self):
        slug = self.import_zip({"world/level.dat": b"x"}, "true")["id"]
        self.assertEqual(compose_env(self.folder, slug)["EULA"], "TRUE")

    def test_imported_server_export_records_acceptance(self):
        compose = yaml.dump({"services": {"mc": {
            "image": "itzg/minecraft-server", "ports": ["25565:25565"],
            "environment": ["TYPE=PAPER", "EULA=FALSE"]}}})
        slug = self.import_zip({"docker-compose.yml": compose}, "true")["id"]
        self.assertEqual(compose_env(self.folder, slug)["EULA"], "TRUE")

    def write_compose(self, slug, env):
        os.makedirs(os.path.join(self.folder, slug))
        with open(os.path.join(self.folder, slug, "docker-compose.yml"), "w") as f:
            yaml.dump({"services": {"mc": {"image": "itzg/minecraft-server", "environment": env}}}, f)

    def save_config(self, slug, env):
        with patch.object(main, "sync_instance_mods_to_disk", new=AsyncMock(return_value={})), \
                patch.object(main.bedrock, "apply_crossplay"), \
                patch.object(main, "take_pre_update_snapshot", return_value=None):
            asyncio.run(main.update_config(slug, main.InstanceConfig(image="itzg/minecraft-server", environment=env)))

    def test_config_save_keeps_the_stored_answer(self):
        self.write_compose("kept", ["TYPE=PAPER", "EULA=TRUE"])
        self.save_config("kept", {"TYPE": "PAPER"})
        self.assertEqual(compose_env(self.folder, "kept")["EULA"], "TRUE")

    def test_config_save_no_longer_forces_eula(self):
        self.write_compose("declined", ["TYPE=PAPER", "EULA=TRUE"])
        self.save_config("declined", {"TYPE": "PAPER", "EULA": "FALSE"})
        self.assertEqual(compose_env(self.folder, "declined")["EULA"], "FALSE")

    def start(self, slug):
        done = type("Done", (), {"returncode": 0, "stderr": ""})()
        with patch.object(main.subprocess, "run", return_value=done):
            asyncio.run(main.start_instance(slug))

    def test_servers_from_before_the_checkbox_still_start_accepted(self):
        self.write_compose("legacy", ["TYPE=PAPER"])
        self.start("legacy")
        self.assertEqual(compose_env(self.folder, "legacy")["EULA"], "TRUE")

    def test_start_respects_a_declined_eula(self):
        self.write_compose("declined", ["TYPE=PAPER", "EULA=FALSE"])
        self.start("declined")
        self.assertEqual(compose_env(self.folder, "declined")["EULA"], "FALSE")


if __name__ == "__main__":
    unittest.main()
