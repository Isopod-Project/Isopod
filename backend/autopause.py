"""Auto-pause: let an idle Java server sleep and wake it when a player connects.

The work is done by itzg/minecraft-server's own autopause. Once nobody has been online
for AUTOPAUSE_TIMEOUT_EST seconds it saves the world and freezes the Java process
(SIGSTOP), which frees the CPU. knockd inside the container watches the game port, and
the first connection attempt (a join or a server-list ping) resumes it. Isopod only turns
the feature on, reports the sleeping state, and wakes the server before stopping it.

Memory stays allocated while the process is frozen; the host can swap it out, but the
container keeps it. Stopping the container instead would free it, but then nothing would
be listening to wake the server again.
"""
import os
import subprocess
from datetime import datetime, timezone
from typing import Optional

# The image touches this in the data folder when it pauses and removes it when it resumes.
PAUSED_MARKER = ".paused"
DEFAULT_TIMEOUT_SECONDS = 600


def enabled(env: dict) -> bool:
    return str(env.get("ENABLE_AUTOPAUSE", "")).lower() == "true"


def apply_settings(env: dict) -> None:
    """Fill in the variables autopause depends on, in place, from ENABLE_AUTOPAUSE and AUTOPAUSE_TIMEOUT_EST."""
    if not enabled(env):
        # Isopod set this when autopause was turned on; put the watchdog back.
        if env.get("MAX_TICK_TIME") == "-1":
            del env["MAX_TICK_TIME"]
        return
    env["ENABLE_AUTOPAUSE"] = "TRUE"
    timeout = str(env.get("AUTOPAUSE_TIMEOUT_EST", "")).strip()
    if not timeout.isdigit() or int(timeout) <= 0:
        timeout = str(DEFAULT_TIMEOUT_SECONDS)
    env["AUTOPAUSE_TIMEOUT_EST"] = timeout
    # Also sleep when nobody joins after a start, on the same timer.
    env["AUTOPAUSE_TIMEOUT_INIT"] = timeout
    # A resumed server looks like one tick lasted the whole nap, and the watchdog would kill it.
    env["MAX_TICK_TIME"] = "-1"


def _marker(instance_path: str) -> str:
    return os.path.join(instance_path, "data", PAUSED_MARKER)


def parse_started_at(value: Optional[str]) -> Optional[float]:
    """Docker's State.StartedAt (e.g. 2026-10-28T12:00:00.123456789Z) as a Unix timestamp."""
    if not value or value.startswith("0001-"):
        return None
    try:
        return datetime.strptime(value[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        return None


def is_sleeping(instance_path: str, started_at: Optional[float]) -> bool:
    """Whether the server is paused right now.

    The marker outlives the container if it is stopped while paused, so only a marker
    written since the container last started counts.
    """
    if started_at is None:
        return False
    try:
        return os.path.getmtime(_marker(instance_path)) >= started_at
    except OSError:
        return False


def wake(instance_path: str) -> None:
    """Resume a paused server so it can shut down cleanly. Does nothing if it isn't paused."""
    if not os.path.exists(_marker(instance_path)):
        return
    try:
        # The image's own resume script: no-op unless Java is stopped, and removes the marker.
        subprocess.run(
            ["docker", "compose", "exec", "-T", "mc", "/image/scripts/auto/resume.sh"],
            cwd=instance_path, capture_output=True, text=True, timeout=15,
        )
    except Exception as e:
        print(f"Couldn't wake {os.path.basename(instance_path)} before stopping: {e}")
