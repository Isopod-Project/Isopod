"""Crash detection, crash-loop protection, and crash report parsing.

The watchdog follows Docker's container events. `docker compose stop/down/kill` send a
`kill` through the Docker API before the container dies, so a container that dies
without one, with a non-zero exit code or after running out of memory, has crashed.
Docker's restart policy restarts it, waiting longer after each quick failure; if it
crashes CRASH_LOOP_LIMIT times within CRASH_LOOP_WINDOW seconds, the watchdog stops the
server instead of letting it bootloop.
"""
import os
import re
import time
from typing import Callable, Dict, List, Optional

# Isopod's restart policy names -> the compose `restart:` value. "always" keeps
# unless-stopped so servers still come back after the machine restarts.
RESTART_POLICIES = {"always": "unless-stopped", "on-failure": "on-failure", "never": "no"}
DEFAULT_RESTART_POLICY = "always"

CRASH_LOOP_LIMIT = 3
CRASH_LOOP_WINDOW = 120
# A container that dies this soon after an API kill was stopped on purpose.
KILL_GRACE_SECONDS = 60


def policy_from_compose(value) -> str:
    value = str(value or "no").lower()
    if value in ("unless-stopped", "always"):
        return "always"
    if value.startswith("on-failure"):
        return "on-failure"
    return "never"


class CrashWatchdog:
    def __init__(
        self,
        resolve_instance: Callable[[str], Optional[str]],
        save_meta: Callable[[str, dict], None],
        get_policy: Callable[[str], str],
        halt: Callable[[str], None],
    ):
        self.resolve_instance = resolve_instance
        self.save_meta = save_meta
        self.get_policy = get_policy
        self.halt = halt
        self._kills: Dict[str, float] = {}
        self._ooms: Dict[str, float] = {}
        self._crashes: Dict[str, List[float]] = {}

    def handle_event(self, event: dict, now: Optional[float] = None) -> Optional[dict]:
        """Process one Docker event. Returns the crash it recorded, if any."""
        now = time.time() if now is None else now
        if event.get("Type") != "container":
            return None
        actor = event.get("Actor") or {}
        attrs = actor.get("Attributes") or {}
        container_id = actor.get("ID") or event.get("id") or ""
        project = attrs.get("com.docker.compose.project")
        if not project:
            return None
        action = event.get("Action") or event.get("status")
        if action == "kill":
            self._kills[container_id] = now
            return None
        if action == "oom":
            self._ooms[container_id] = now
            return None
        if action != "die":
            return None

        stopped_on_purpose = now - self._kills.pop(container_id, 0) < KILL_GRACE_SECONDS
        out_of_memory = now - self._ooms.pop(container_id, 0) < KILL_GRACE_SECONDS
        try:
            exit_code = int(attrs.get("exitCode", 0))
        except (TypeError, ValueError):
            exit_code = 0
        if stopped_on_purpose or (exit_code == 0 and not out_of_memory):
            return None
        path = self.resolve_instance(project)
        if not path:
            return None

        history = [t for t in self._crashes.get(path, []) if now - t < CRASH_LOOP_WINDOW] + [now]
        self._crashes[path] = history
        crash = {"time": now, "exit_code": exit_code, "oom_killed": out_of_memory, "count": len(history)}
        name = os.path.basename(path)
        print(f"[watchdog] {name} crashed (exit code {exit_code}{', out of memory' if out_of_memory else ''}).")

        if self.get_policy(path) != "never" and len(history) >= CRASH_LOOP_LIMIT:
            self._crashes[path] = []
            print(f"[watchdog] {name} crashed {len(history)} times within {CRASH_LOOP_WINDOW} seconds; "
                  "stopping it instead of restarting it again.")
            self.save_meta(path, {"last_crash": crash, "crash_loop_halted": {"time": now, "count": len(history)}})
            self.halt(path)
        else:
            self.save_meta(path, {"last_crash": crash})
        return crash

    def run(self, get_client: Callable[[], object]) -> None:
        """Follow Docker events forever, reconnecting when the stream drops."""
        while True:
            client = get_client()
            if client is None:
                time.sleep(30)
                continue
            try:
                events = client.events(decode=True, filters={"type": "container", "event": ["die", "kill", "oom"]})
                for event in events:
                    try:
                        self.handle_event(event)
                    except Exception as e:
                        print(f"[watchdog] Failed to handle Docker event: {e}")
            except Exception as e:
                print(f"[watchdog] Docker event stream ended ({e}); reconnecting.")
            time.sleep(5)


# --- Crash reports ------------------------------------------------------------------

MAX_REPORT_CHARS = 200_000
EXCEPTION_RE = re.compile(r"^[\w$.]+(?:Exception|Error|Throwable)\b")
JAR_RE = re.compile(r"[\w.+\-]+\.jar")


def latest_crash_report(instance_path: str, mod_files: List[str] = ()) -> Optional[dict]:
    """The newest report in data/crash-reports, with what analyze_report finds in it."""
    report_dir = os.path.join(instance_path, "data", "crash-reports")
    if not os.path.isdir(report_dir):
        return None
    reports = [e for e in os.scandir(report_dir) if e.is_file() and e.name.endswith(".txt")]
    if not reports:
        return None
    newest = max(reports, key=lambda e: e.stat().st_mtime)
    with open(newest.path, "r", encoding="utf-8", errors="replace") as f:
        text = f.read(MAX_REPORT_CHARS)
    return {"name": newest.name, "created": newest.stat().st_mtime, "text": text, **analyze_report(text, mod_files)}


def _suspected_mods(lines: List[str]) -> List[str]:
    """Forge/NeoForge list suspects as 'Suspected Mods: Name (id), Version: x', inline or on indented lines."""
    suspects: List[str] = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not re.match(r"^Suspected Mods?:", stripped):
            continue
        rest = stripped.split(":", 1)[1].strip()
        entries = [rest] if rest else []
        if not rest:
            indent = len(line) - len(line.lstrip())
            for follow in lines[i + 1:]:
                if not follow.strip() or len(follow) - len(follow.lstrip()) <= indent:
                    break
                if "Issue tracker" not in follow and not follow.strip().startswith("at "):
                    entries.append(follow.strip())
        for entry in entries:
            for part in entry.split(","):
                name = part.strip()
                if name and not name.lower().startswith(("version", "issue tracker")) and name.upper() not in ("NONE", "UNKNOWN"):
                    suspects.append(name)
    return list(dict.fromkeys(suspects))


def analyze_report(text: str, mod_files: List[str] = ()) -> dict:
    lines = text.splitlines()
    description = next((l.split(":", 1)[1].strip() for l in lines if l.startswith("Description:")), None)
    caused_by = [l.strip()[len("Caused by:"):].strip() for l in lines if l.strip().startswith("Caused by:")]
    root_cause = caused_by[-1] if caused_by else next((l.strip() for l in lines if EXCEPTION_RE.match(l.strip())), None)

    suspects = _suspected_mods(lines)
    # System Details lists every installed jar, so only look for jar names above it
    head = text.split("-- System Details --", 1)[0]
    installed = {os.path.basename(f).lower().replace(".disabled", ""): f for f in mod_files}
    for jar in JAR_RE.findall(head):
        if jar.lower() in installed and installed[jar.lower()] not in suspects:
            suspects.append(installed[jar.lower()])
    return {"description": description, "root_cause": root_cause, "suspects": suspects}
