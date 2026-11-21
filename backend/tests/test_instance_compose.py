import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import instance_compose, main


class InstanceComposeTests(unittest.TestCase):
    def test_host_commands_and_discovery_use_the_same_project(self):
        with patch.dict(os.environ, {"ISOPOD_DOCKER_MODE": "host"}):
            self.assertEqual(
                instance_compose.command(os.path.join("servers", "Survival"), "up", "-d"),
                ["docker", "compose", "--project-name", "isopod-instance-survival",
                 "-f", "docker-compose.yml", "up", "-d"],
            )
            self.assertEqual(instance_compose.project_names("Survival"), ("isopod-instance-survival",))

            with tempfile.TemporaryDirectory() as servers_dir, patch.object(main, "SERVERS_DIR", servers_dir):
                path = Path(servers_dir) / "Survival"
                path.mkdir()
                (path / "docker-compose.yml").touch()
                self.assertIsNone(main._instance_path_for_project("survival"))
                self.assertEqual(main._instance_path_for_project("isopod-instance-survival"), str(path))

    def test_dind_keeps_existing_compose_projects(self):
        with patch.dict(os.environ, {"ISOPOD_DOCKER_MODE": "dind"}):
            self.assertEqual(instance_compose.command("survival", "down"), ["docker", "compose", "down"])
            self.assertEqual(instance_compose.project_names("Survival"), ("survival", "Survival"))
