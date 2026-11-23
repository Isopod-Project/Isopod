import asyncio
import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from backend import main


class GamePortTests(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.object(main, "SERVERS_DIR", directory))
        self.enterContext(patch.object(main.instance_compose, "uses_host_docker", return_value=False))

    def create(self, name, port, template="VANILLA"):
        request = main.CreateInstanceRequest(name=name, template=template, port=port, eula_accepted=True)
        return asyncio.run(main.create_instance(request))

    def test_suggestions_and_conflicts(self):
        for port in (25565, 25566):
            self.assertEqual(main.game_ports()["port"], port)
            self.create(str(port), port)
        for port in (25565, 25564, 25600):
            with self.assertRaises(HTTPException):
                self.create("rejected", port)
            self.assertFalse(os.path.exists(os.path.join(main.SERVERS_DIR, "rejected")))
        self.create("bedrock", 19132, "BEDROCK")
        self.assertEqual(main.game_ports(True)["port"], 19133)

    def test_host_docker_warns_outside_standard_range(self):
        with patch.object(main.instance_compose, "uses_host_docker", return_value=True):
            for port in (25564, 24600, 25600):
                result = self.create(str(port), port)
                self.assertIn("25565–25585", result["warning"])
            config = main.InstanceConfig(**main.get_config("24600"))
            config.port = 24601
            result = asyncio.run(main.update_config("24600", config))
            self.assertIn("25565–25585", result["warning"])

    def test_settings_validate_before_saving(self):
        self.create("first", 25565)
        self.create("second", 25566)
        config = main.InstanceConfig(**main.get_config("second"))
        for port in (25565, 25600):
            config.port = port
            with self.assertRaises(HTTPException):
                asyncio.run(main.update_config("second", config))
        config.port = 25570
        asyncio.run(main.update_config("second", config))
        self.assertEqual(main.get_config("second")["port"], 25570)
