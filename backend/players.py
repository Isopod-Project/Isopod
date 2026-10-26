"""Online players and per-player moderation commands, sent through the server's RCON.

The player list comes from the vanilla `list` command, which every server type supports.
Its output is cached briefly so the dashboard, side panel and edit view can all poll
without each one opening a new RCON session.
"""
import json
import os
import re
import subprocess
import threading
import time
from typing import Dict, List, Optional, Tuple

# How long a `list` result is reused before RCON is asked again.
CACHE_SECONDS = 3

# Java names are 3-16 of [A-Za-z0-9_]; Bedrock players joining through Geyser/Floodgate get a
# "." prefix and can be longer. Anything else is rejected so a name can't smuggle extra
# command text into RCON.
PLAYER_NAME = re.compile(r"^\.?[A-Za-z0-9_]{1,32}$")

# Kick/ban reasons and messages are free text; cap them and drop control characters.
MAX_TEXT = 256

# Minecraft formatting codes (§a) and ANSI colour escapes that some servers add to output.
FORMATTING = re.compile(r"§.|\x1b\[[0-9;]*[A-Za-z]")

# 1.13+: "There are 2 of a max of 20 players online: Steve, Alex"
# older:  "There are 2/20 players online:\nSteve, Alex"
LIST_HEADER = re.compile(r"There are (\d+)\s*(?:of a max(?: of)?|/)\s*(\d+) players online:?", re.IGNORECASE)

# RCON reports a command that did nothing with a normal exit code; these mark that case.
FAILURE_PREFIXES = ("No player was found", "Unknown or incomplete command", "Incorrect argument", "Nothing changed", "That player does not exist")

ACTIONS = ("kick", "ban", "pardon", "op", "deop", "whitelist_add", "whitelist_remove", "message", "teleport")

_cache: Dict[str, Tuple[float, dict]] = {}
_cache_lock = threading.Lock()


def is_valid_name(name: str) -> bool:
    return bool(PLAYER_NAME.match(name or ""))


def clean_text(text: Optional[str]) -> str:
    text = "".join(ch if ch.isprintable() else " " for ch in (text or ""))
    return " ".join(text.split())[:MAX_TEXT]


def parse_list(output: str) -> Optional[dict]:
    """Read the online count, slot count and names from `list` output. None if unrecognised."""
    text = FORMATTING.sub("", output or "")
    m = LIST_HEADER.search(text)
    if not m:
        return None
    names: List[str] = []
    for line in text[m.end():].splitlines():
        # Some plugins group the list by rank, e.g. "admins: Steve, Alex"
        if ":" in line:
            line = line.split(":", 1)[1]
        for name in line.split(","):
            name = name.strip()
            if name and is_valid_name(name) and name not in names:
                names.append(name)
    return {"online": int(m.group(1)), "max": int(m.group(2)), "players": names}


def rcon(path: str, command: str, timeout: int = 5) -> Tuple[bool, str]:
    """Run one command through the instance's rcon-cli. Returns (succeeded, output)."""
    try:
        result = subprocess.run(
            ["docker", "compose", "exec", "-T", "mc", "rcon-cli", command],
            cwd=path, capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return False, "The server didn't answer in time."
    except Exception as e:
        print(f"rcon-cli failed: {e}")
        return False, "Couldn't reach the server console."
    output = FORMATTING.sub("", (result.stdout + result.stderr)).strip()
    return result.returncode == 0 and not output.startswith(FAILURE_PREFIXES), output


def online_players(instance_id: str, path: str) -> dict:
    """Current player list. `available` is false when RCON couldn't be reached."""
    now = time.time()
    with _cache_lock:
        cached = _cache.get(instance_id)
        if cached and now - cached[0] < CACHE_SECONDS:
            return cached[1]

    ok, output = rcon(path, "list")
    parsed = parse_list(output) if ok else None
    result = {"available": True, **parsed} if parsed else {"available": False, "online": 0, "max": 0, "players": []}

    with _cache_lock:
        _cache[instance_id] = (time.time(), result)
    return result


def forget(instance_id: str) -> None:
    """Drop the cached list so the next request reflects a kick or ban straight away."""
    with _cache_lock:
        _cache.pop(instance_id, None)


def build_command(action: str, name: str, reason: str = "", message: str = "", target: str = "") -> str:
    """The RCON command for a kick, ban, pardon, message or teleport. Raises ValueError on bad input."""
    if not is_valid_name(name):
        raise ValueError("Invalid player name")
    reason, message = clean_text(reason), clean_text(message)
    if action == "kick":
        return f"kick {name} {reason}".strip()
    if action == "ban":
        return f"ban {name} {reason}".strip()
    if action == "pardon":
        return f"pardon {name}"
    if action == "message":
        if not message:
            raise ValueError("Message is empty")
        return f"tell {name} {message}"
    if action == "teleport":
        if not is_valid_name(target):
            raise ValueError("Invalid teleport target")
        if target.lower() == name.lower():
            raise ValueError("Pick another player to teleport to")
        return f"tp {name} {target}"
    raise ValueError(f"Unknown action: {action}")


def read_bans(data_dir: str) -> List[dict]:
    """Banned players from the server's banned-players.json; empty if the file is missing or unreadable."""
    try:
        with open(os.path.join(data_dir, "banned-players.json")) as f:
            entries = json.load(f)
    except (OSError, ValueError):
        return []
    if not isinstance(entries, list):
        return []
    keys = ("name", "uuid", "reason", "source", "created", "expires")
    return [{k: e.get(k) for k in keys} for e in entries if isinstance(e, dict) and e.get("name")]


def remove_ban(data_dir: str, name: str) -> bool:
    """Drop a player from banned-players.json while the server is stopped. False if they weren't banned.

    The server reads this file at startup and rewrites it on every ban/pardon, so editing it
    is only safe while the server isn't running; pardon goes through RCON otherwise.
    """
    path = os.path.join(data_dir, "banned-players.json")
    try:
        with open(path) as f:
            entries = json.load(f)
    except (OSError, ValueError):
        return False
    kept = [e for e in entries if not (isinstance(e, dict) and str(e.get("name", "")).lower() == name.lower())]
    if len(kept) == len(entries):
        return False
    with open(path, "w") as f:
        json.dump(kept, f, indent=2)
    return True
