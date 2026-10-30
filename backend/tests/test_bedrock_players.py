"""Online players on a Bedrock server, rebuilt from the Bedrock Dedicated Server log.

Run from the repo root: python -m unittest discover backend/tests
"""
import os
import subprocess
import tempfile
import unittest
from unittest import mock

from backend import bedrock, players

XUID_TACO = "2535400000000001"
XUID_ALEX = "2535400000000002"

START = """\
[2026-10-28 12:00:00:001 INFO] Starting Server
[2026-10-28 12:00:00:002 INFO] Version: 1.21.120.4
[2026-10-28 12:00:03:000 INFO] Server started.
"""


def connected(name, xuid):
    return f"[2026-10-28 12:01:00:000 INFO] Player connected: {name}, xuid: {xuid}\n"


def spawned(name, xuid):
    return f"[2026-10-28 12:01:02:000 INFO] Player Spawned: {name} xuid: {xuid}, pfid: 7f3c0000aaaa0001\n"


def disconnected(name, xuid):
    return f"[2026-10-28 12:30:00:000 INFO] Player disconnected: {name}, xuid: {xuid}, pfid: 7f3c0000aaaa0001\n"


class ParseOnlinePlayersTests(unittest.TestCase):
    def test_connected_players_are_online_with_their_xuids(self):
        log = START + connected("Tacoz YouTube", XUID_TACO) + spawned("Tacoz YouTube", XUID_TACO) + connected("Alex", XUID_ALEX)
        self.assertEqual(bedrock.parse_online_players(log), {"Tacoz YouTube": XUID_TACO, "Alex": XUID_ALEX})

    def test_disconnected_players_are_removed(self):
        log = START + connected("Tacoz YouTube", XUID_TACO) + connected("Alex", XUID_ALEX) + disconnected("Tacoz YouTube", XUID_TACO)
        self.assertEqual(bedrock.parse_online_players(log), {"Alex": XUID_ALEX})

    def test_a_player_who_rejoins_is_listed_once(self):
        log = START + connected("Alex", XUID_ALEX) + disconnected("Alex", XUID_ALEX) + connected("alex", XUID_ALEX)
        self.assertEqual(bedrock.parse_online_players(log), {"alex": XUID_ALEX})

    def test_a_restart_forgets_players_from_the_previous_run(self):
        # The server stopped (or crashed) without logging Alex's disconnect
        log = START + connected("Alex", XUID_ALEX) + START + connected("Tacoz YouTube", XUID_TACO)
        self.assertEqual(bedrock.parse_online_players(log), {"Tacoz YouTube": XUID_TACO})

    def test_nobody_online_after_a_restart(self):
        self.assertEqual(bedrock.parse_online_players(START + connected("Alex", XUID_ALEX) + START), {})

    def test_a_missing_xuid_is_none(self):
        log = START + "[2026-10-28 12:01:00:000 INFO] Player connected: Alex, xuid: \n"
        self.assertEqual(bedrock.parse_online_players(log), {"Alex": None})

    def test_tty_carriage_returns_and_other_lines_are_ignored(self):
        log = (START + connected("Alex", XUID_ALEX)).replace("\n", "\r\n") + "[INFO] Running AutoCompaction...\r\n"
        self.assertEqual(bedrock.parse_online_players(log), {"Alex": XUID_ALEX})

    def test_empty_log(self):
        self.assertEqual(bedrock.parse_online_players(""), {})
        self.assertEqual(bedrock.parse_online_players(None), {})


class MaxPlayersTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)

    def write_properties(self, text):
        with open(os.path.join(self.dir.name, "server.properties"), "w") as f:
            f.write(text)

    def test_reads_max_players(self):
        self.write_properties("server-name=Test\nmax-players=25\nonline-mode=true\n")
        self.assertEqual(bedrock.read_max_players(self.dir.name), 25)

    def test_falls_back_to_the_bds_default(self):
        self.assertEqual(bedrock.read_max_players(self.dir.name), bedrock.DEFAULT_MAX_PLAYERS)
        self.write_properties("max-players=lots\n")
        self.assertEqual(bedrock.read_max_players(self.dir.name), bedrock.DEFAULT_MAX_PLAYERS)


class OnlinePlayersTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        os.makedirs(os.path.join(self.dir.name, "data"))
        with open(os.path.join(self.dir.name, "data", "server.properties"), "w") as f:
            f.write("max-players=12\n")
        players.forget("bedrock-test")
        self.addCleanup(players.forget, "bedrock-test")

    def logs(self, stdout, returncode=0):
        return mock.patch("backend.bedrock.subprocess.run", return_value=subprocess.CompletedProcess([], returncode, stdout, ""))

    def test_players_endpoint_result_for_a_running_server(self):
        with self.logs(START + connected("Tacoz YouTube", XUID_TACO)):
            result = players.online_players("bedrock-test", self.dir.name, is_bedrock=True)
        self.assertEqual(result, {
            "available": True, "online": 1, "max": 12,
            "players": ["Tacoz YouTube"], "xuids": {"Tacoz YouTube": XUID_TACO},
        })

    def test_unavailable_when_the_log_cant_be_read(self):
        with self.logs("", returncode=1):
            result = players.online_players("bedrock-test", self.dir.name, is_bedrock=True)
        self.assertFalse(result["available"])


if __name__ == "__main__":
    unittest.main()
