"""Auto-pause settings and sleeping detection (#62).

Run from the repo root: python -m unittest discover backend/tests
"""
import os
import tempfile
import time
import unittest

from backend import autopause


class ApplySettingsTest(unittest.TestCase):
    def test_enabling_fills_in_timers_and_disables_watchdog(self):
        env = {"ENABLE_AUTOPAUSE": "true", "AUTOPAUSE_TIMEOUT_EST": "900"}
        autopause.apply_settings(env)
        self.assertEqual(env["ENABLE_AUTOPAUSE"], "TRUE")
        self.assertEqual(env["AUTOPAUSE_TIMEOUT_EST"], "900")
        self.assertEqual(env["AUTOPAUSE_TIMEOUT_INIT"], "900")
        self.assertEqual(env["MAX_TICK_TIME"], "-1")

    def test_bad_timeout_falls_back_to_default(self):
        for value in ("", "abc", "0", "-5"):
            env = {"ENABLE_AUTOPAUSE": "TRUE", "AUTOPAUSE_TIMEOUT_EST": value}
            autopause.apply_settings(env)
            self.assertEqual(env["AUTOPAUSE_TIMEOUT_EST"], str(autopause.DEFAULT_TIMEOUT_SECONDS), value)

    def test_disabling_restores_watchdog_and_keeps_timeout(self):
        env = {"ENABLE_AUTOPAUSE": "FALSE", "AUTOPAUSE_TIMEOUT_EST": "900", "MAX_TICK_TIME": "-1"}
        autopause.apply_settings(env)
        self.assertNotIn("MAX_TICK_TIME", env)
        self.assertEqual(env["AUTOPAUSE_TIMEOUT_EST"], "900")

    def test_disabled_leaves_custom_watchdog_alone(self):
        env = {"MAX_TICK_TIME": "120000"}
        autopause.apply_settings(env)
        self.assertEqual(env, {"MAX_TICK_TIME": "120000"})


class SleepingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = self.tmp.name
        os.makedirs(os.path.join(self.path, "data"))
        self.marker = os.path.join(self.path, "data", autopause.PAUSED_MARKER)

    def tearDown(self):
        self.tmp.cleanup()

    def test_no_marker_is_awake(self):
        self.assertFalse(autopause.is_sleeping(self.path, time.time() - 60))

    def test_marker_since_start_is_sleeping(self):
        open(self.marker, "w").close()
        self.assertTrue(autopause.is_sleeping(self.path, time.time() - 60))

    def test_marker_left_from_before_the_restart_is_ignored(self):
        open(self.marker, "w").close()
        old = time.time() - 3600
        os.utime(self.marker, (old, old))
        self.assertFalse(autopause.is_sleeping(self.path, time.time() - 60))

    def test_unknown_start_time_is_awake(self):
        open(self.marker, "w").close()
        self.assertFalse(autopause.is_sleeping(self.path, None))

    def test_parse_started_at(self):
        self.assertEqual(autopause.parse_started_at("2026-10-28T12:00:00.123456789Z"), 1793188800.0)
        self.assertIsNone(autopause.parse_started_at("0001-01-01T00:00:00Z"))
        self.assertIsNone(autopause.parse_started_at(None))
        self.assertIsNone(autopause.parse_started_at("garbage"))


if __name__ == "__main__":
    unittest.main()
