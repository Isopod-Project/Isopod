"""Bedrock console command output, read back from the server log.

Run from the repo root: python -m unittest discover backend/tests
"""
import subprocess
import time
import unittest
from unittest import mock

from backend import bedrock

BEFORE = "2026-10-28T12:00:00.5Z"


class FakeDocker:
    """Stands in for `docker compose`: a log that grows as commands are sent."""

    def __init__(self, replies, log=None):
        self.log = list(log if log is not None else [(BEFORE, "[2026-10-28 12:00:00:500 INFO] Server started.")])
        self.replies = replies
        self.sent = []
        self.clock = 1

    def stamp(self):
        self.clock += 1
        # Docker trims trailing zeros, so the timestamps don't all have the same width
        return f"2026-10-28T12:00:0{self.clock}.{self.clock}Z"

    def run(self, args, **kwargs):
        if "send-command" in args:
            command = args[-1]
            self.sent.append(command)
            for line in self.replies.get(command, []):
                self.log.append((self.stamp(), line))
            return subprocess.CompletedProcess(args, 0, "", "")
        if "--tail=1" in args:
            lines = self.log[-1:]
        else:
            # --since is inclusive, like docker's
            since = args[args.index("--since") + 1]
            lines = [l for l in self.log if bedrock._timestamp_key(l[0]) >= bedrock._timestamp_key(since)]
        return subprocess.CompletedProcess(args, 0, "".join(f"{s} {t}\n" for s, t in lines), "")


class CommandReplyTests(unittest.TestCase):
    def test_log_prefix_is_stripped(self):
        self.assertEqual(
            bedrock.command_reply("time query daytime", ["[2026-10-28 12:00:01:000 INFO] Day time is 6000"]),
            "Day time is 6000",
        )

    def test_player_joins_and_the_echoed_command_are_left_out(self):
        lines = [
            "list",
            "[2026-10-28 12:00:01:000 INFO] Player connected: Tacoz YouTube, xuid: 2535400000000001",
            "There are 1/10 players online:",
            "[2026-10-28 12:00:01:100 INFO] Running AutoCompaction...",
            "Tacoz YouTube",
            "[2026-10-28 12:00:01:200 INFO] Player Spawned: Tacoz YouTube xuid: 2535400000000001",
        ]
        self.assertEqual(bedrock.command_reply("list", lines), "There are 1/10 players online:\nTacoz YouTube")

    def test_timestamps_compare_with_trimmed_zeros(self):
        self.assertGreater(bedrock._timestamp_key("2026-10-28T12:00:00.51Z"), bedrock._timestamp_key("2026-10-28T12:00:00.5Z"))
        self.assertGreater(bedrock._timestamp_key("2026-10-28T12:00:00.000000001Z"), bedrock._timestamp_key("2026-10-28T12:00:00Z"))


class RunCommandTests(unittest.TestCase):
    def run_with(self, docker, command):
        with mock.patch.object(bedrock.subprocess, "run", side_effect=docker.run), \
                mock.patch.object(bedrock, "COMMAND_POLL_INTERVAL", 0.01), \
                mock.patch.object(bedrock, "COMMAND_REPLY_QUIET", 0.03):
            return bedrock.run_command("/instance", command)

    def test_reply_comes_back_without_earlier_log_lines(self):
        docker = FakeDocker({"time query daytime": ["[2026-10-28 12:00:02:000 INFO] Day time is 6000"]})
        self.assertEqual(self.run_with(docker, "time query daytime"), (True, "Day time is 6000"))
        self.assertEqual(docker.sent, ["time query daytime"])

    def test_multi_line_reply(self):
        docker = FakeDocker({"list": ["There are 1/10 players online:", "Tacoz YouTube"]})
        self.assertEqual(self.run_with(docker, "list"), (True, "There are 1/10 players online:\nTacoz YouTube"))

    def test_silent_command_returns_empty_without_hanging(self):
        docker = FakeDocker({})
        with mock.patch.object(bedrock, "COMMAND_REPLY_WAIT", 0.2):
            started = time.monotonic()
            self.assertEqual(self.run_with(docker, "save resume"), (True, ""))
        self.assertLess(time.monotonic() - started, 1)

    def test_failed_send_is_reported(self):
        docker = FakeDocker({})
        read = docker.run
        docker.run = lambda args, **kw: subprocess.CompletedProcess(args, 1, "", "no such service") if "send-command" in args else read(args)
        self.assertEqual(self.run_with(docker, "list"), (False, "no such service"))

    def test_reply_is_found_when_the_log_was_empty(self):
        docker = FakeDocker({"list": ["There are 0/10 players online:"]}, log=[])
        self.assertEqual(self.run_with(docker, "list"), (True, "There are 0/10 players online:"))

    def test_unreadable_log_still_sends_the_command(self):
        docker = FakeDocker({})
        send = docker.run
        docker.run = lambda args, **kw: send(args) if "send-command" in args else subprocess.CompletedProcess(args, 1, "", "")
        self.assertEqual(self.run_with(docker, "list"), (True, ""))
        self.assertEqual(docker.sent, ["list"])


if __name__ == "__main__":
    unittest.main()
