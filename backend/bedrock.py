"""Bedrock Edition support: native Bedrock Dedicated Server instances and Geyser/Floodgate cross-play.

A Bedrock instance (TYPE=BEDROCK) runs itzg/minecraft-bedrock-server instead of
itzg/minecraft-server. It speaks UDP on 19132, has no RCON (commands go through the
image's send-command helper), and keeps its worlds under data/worlds/.

Cross-play lets Bedrock players join a Java server. Turning it on (ISOPOD_CROSSPLAY=true)
adds Geyser and Floodgate from GeyserMC's download API to the PLUGINS or MODS list and
publishes a UDP port (ISOPOD_BEDROCK_PORT) for Geyser's Bedrock listener.
"""
import os
import re
import subprocess
import time
from typing import Dict, List, Optional, Tuple

BEDROCK_IMAGE = "itzg/minecraft-bedrock-server"
BEDROCK_CONTAINER_PORT = 19132
DEFAULT_BEDROCK_PORT = 19132

CROSSPLAY_ENV = "ISOPOD_CROSSPLAY"
BEDROCK_PORT_ENV = "ISOPOD_BEDROCK_PORT"

GEYSER_DOWNLOAD = "https://download.geysermc.org/v2/projects/{project}/versions/latest/builds/latest/downloads/{platform}"

# Java server TYPE -> (GeyserMC download platform, itzg variable that downloads the jars)
CROSSPLAY_PLATFORMS = {
    "PAPER": ("spigot", "PLUGINS"),
    "PURPUR": ("spigot", "PLUGINS"),
    "FABRIC": ("fabric", "MODS"),
    "NEOFORGE": ("neoforge", "MODS"),
}

# Geyser and Floodgate for Fabric both need Fabric API.
FABRIC_API = "fabric-api"

# Bedrock only has these world types; Java ones fall back to DEFAULT.
LEVEL_TYPES = {"DEFAULT", "FLAT", "LEGACY"}
GAMEMODES = {"survival", "creative", "adventure"}

# Bedrock Dedicated Server logs this once players can join.
READY_MARKER = "Server started."

# BDS logs this at the start of every run. Players listed before it belong to an earlier run.
START_MARKER = "Starting Server"

# "Player connected: Tacoz YouTube, xuid: 2535400000000001"
# "Player disconnected: Tacoz YouTube, xuid: 2535400000000001, pfid: 7f3c..."
PLAYER_EVENT = re.compile(r"Player (connected|disconnected): (.+?), xuid: ?(\d*)")

# BDS's own default when server.properties has no max-players.
DEFAULT_MAX_PLAYERS = 10


def is_bedrock(server_type: Optional[str]) -> bool:
    return (server_type or "").upper() == "BEDROCK"


def supports_crossplay(server_type: Optional[str]) -> bool:
    return (server_type or "").upper() in CROSSPLAY_PLATFORMS


def crossplay_enabled(env: dict) -> bool:
    return str(env.get(CROSSPLAY_ENV, "")).lower() == "true"


def crossplay_urls(server_type: str) -> List[str]:
    platform = CROSSPLAY_PLATFORMS[server_type.upper()][0]
    return [GEYSER_DOWNLOAD.format(project=p, platform=platform) for p in ("geyser", "floodgate")]


def compose_service(slug: str, name: str, port: int, version: Optional[str], seed: Optional[str],
                    level_type: Optional[str], difficulty: Optional[str], gamemode: Optional[str],
                    allow_list_enabled: bool, allow_list_users: List[str]) -> dict:
    """The docker-compose service for a new Bedrock Dedicated Server instance."""
    version = version or "LATEST"
    if version.lower() in ("latest", "preview"):
        version = version.upper()
    level_type = (level_type or "DEFAULT").upper()
    gamemode = (gamemode or "survival").lower()
    env = [
        "EULA=TRUE",
        "TYPE=BEDROCK",
        f"VERSION={version}",
        f"SERVER_NAME={name} Hosted by Isopod",
        f"LEVEL_SEED={seed or ''}",
        f"LEVEL_TYPE={level_type if level_type in LEVEL_TYPES else 'DEFAULT'}",
        f"DIFFICULTY={difficulty or 'easy'}",
        f"GAMEMODE={gamemode if gamemode in GAMEMODES else 'survival'}",
        # BDS 1.26+ defaults to NetherNet, which negotiates extra UDP ports through a signaling
        # service and fails behind Isopod's nested NAT. RakNet answers on the one published port.
        "TRANSPORT=raknet",
    ]
    if allow_list_enabled or allow_list_users:
        env.append(f"ALLOW_LIST={'true' if allow_list_enabled else 'false'}")
    # The entrypoint turns the allowlist on whenever ALLOW_LIST_USERS has names, so it's only
    # set while the allowlist is on. users.json keeps the names either way.
    if allow_list_enabled and allow_list_users:
        env.append(f"ALLOW_LIST_USERS={','.join(allow_list_users)}")
    return {
        "image": BEDROCK_IMAGE,
        "container_name": f"isopod_{slug}",
        "ports": [f"{port}:{BEDROCK_CONTAINER_PORT}/udp"],
        "environment": env,
        "volumes": ["./data:/data"],
        "dns": ["8.8.8.8", "1.1.1.1"],
        "restart": "unless-stopped",
        # send-command writes to the server console through the container's stdin
        "stdin_open": True,
        "tty": True,
    }


def host_port(mapping) -> Optional[int]:
    try:
        return int(str(mapping).split(":")[0])
    except ValueError:
        return None


def is_bedrock_mapping(mapping) -> bool:
    """True for a port mapping that publishes the Bedrock (Geyser or BDS) UDP listener."""
    return str(mapping).endswith(f":{BEDROCK_CONTAINER_PORT}/udp")


def bedrock_port(service: dict) -> Optional[int]:
    """The host port Bedrock players connect to, or None if the instance doesn't accept them."""
    for mapping in service.get("ports") or []:
        if is_bedrock_mapping(mapping):
            return host_port(mapping)
    return None


def reassign_ports(service: dict, used_ports: set, game_port: Optional[int] = None) -> None:
    """Move every published port to a free host port, keeping its container side and protocol.

    The first mapping is the game port; game_port, when given, is tried for it first.
    """
    new_ports = []
    for i, mapping in enumerate(service.get("ports") or []):
        current = host_port(mapping)
        if current is None:
            new_ports.append(mapping)
            continue
        port = game_port if i == 0 and game_port else current
        while port in used_ports or port < 1024:
            port += 1
        used_ports.add(port)
        container_side = str(mapping).split(":", 1)[1] if ":" in str(mapping) else str(mapping)
        new_ports.append(f"{port}:{container_side}")
    service["ports"] = new_ports


def _split_list(value: Optional[str]) -> List[str]:
    return [x.strip() for x in str(value or "").replace("\n", ",").split(",") if x.strip()]


def apply_crossplay(service: dict, env: dict, data_dir: str, was_enabled: bool) -> None:
    """Install or remove Geyser and Floodgate to match ISOPOD_CROSSPLAY. Edits service and env in place.

    Does nothing unless cross-play is on or was on before this save, so a Geyser the user
    installed by hand is left alone. Raises ValueError for a bad Bedrock port or a server
    type Geyser can't run on.
    """
    server_type = (env.get("TYPE") or "").upper()
    enabled = crossplay_enabled(env)
    if not enabled and not was_enabled:
        return
    if enabled and not supports_crossplay(server_type):
        raise ValueError("Bedrock cross-play needs a Paper, Purpur, Fabric, or NeoForge server.")

    # Drop whatever an earlier toggle added, then add back what the current setting needs
    for key in ("PLUGINS", "MODS"):
        kept = [u for u in _split_list(env.get(key)) if "download.geysermc.org" not in u]
        if kept:
            env[key] = ",".join(kept)
        else:
            env.pop(key, None)
    ports = [p for p in (service.get("ports") or []) if not is_bedrock_mapping(p)]

    if enabled:
        try:
            port = int(env.get(BEDROCK_PORT_ENV) or DEFAULT_BEDROCK_PORT)
        except ValueError:
            raise ValueError("Bedrock port must be a number.")
        if not 1024 <= port <= 65535:
            raise ValueError("Bedrock port must be between 1024 and 65535.")
        env[BEDROCK_PORT_ENV] = str(port)
        platform_key = CROSSPLAY_PLATFORMS[server_type][1]
        env[platform_key] = ",".join(_split_list(env.get(platform_key)) + crossplay_urls(server_type))
        if server_type == "FABRIC":
            projects = _split_list(env.get("MODRINTH_PROJECTS"))
            if FABRIC_API not in [p.lower() for p in projects]:
                env["MODRINTH_PROJECTS"] = ",".join(projects + [FABRIC_API])
        ports.append(f"{port}:{BEDROCK_CONTAINER_PORT}/udp")
    else:
        remove_crossplay_jars(data_dir)

    service["ports"] = ports


def remove_crossplay_jars(data_dir: str) -> List[str]:
    """Delete downloaded Geyser and Floodgate jars so turning cross-play off really removes them."""
    removed = []
    for folder in ("plugins", "mods"):
        path = os.path.join(data_dir, folder)
        if not os.path.isdir(path):
            continue
        for entry in os.scandir(path):
            name = entry.name.lower()
            if entry.is_file() and name.endswith((".jar", ".jar.disabled")) and name.startswith(("geyser", "floodgate")):
                os.remove(entry.path)
                removed.append(entry.name)
    return removed


def find_world_dirs(data_dir: str) -> List[str]:
    """["worlds"] when data/worlds/ holds a Bedrock world, else []."""
    worlds = os.path.join(data_dir, "worlds")
    if not os.path.isdir(worlds):
        return []
    has_world = any(e.is_dir() and os.path.isfile(os.path.join(e.path, "level.dat")) for e in os.scandir(worlds))
    return ["worlds"] if has_world else []


def parse_online_players(log: str) -> Dict[str, Optional[str]]:
    """Gamertag -> XUID (None if the log had none) for the players online at the end of a BDS log.

    Rebuilt from connect/disconnect lines, starting over at each server start, so players
    still listed when the server stopped or crashed don't carry over into the next run.
    """
    online: Dict[str, Optional[str]] = {}
    for line in (log or "").splitlines():
        if START_MARKER in line:
            online.clear()
            continue
        m = PLAYER_EVENT.search(line)
        if not m:
            continue
        name = m.group(2).strip()
        # Gamertags are case-insensitive, so a rejoin with different casing replaces the old entry
        for known in [n for n in online if n.lower() == name.lower()]:
            del online[known]
        if m.group(1) == "connected" and name:
            online[name] = m.group(3) or None
    return online


def read_max_players(data_dir: str) -> int:
    """max-players from server.properties, or BDS's default if it's missing or unreadable."""
    try:
        with open(os.path.join(data_dir, "server.properties")) as f:
            for line in f:
                key, sep, value = line.partition("=")
                if sep and key.strip() == "max-players":
                    return int(value.strip())
    except (OSError, ValueError):
        pass
    return DEFAULT_MAX_PLAYERS


def online_players(instance_path: str) -> Optional[dict]:
    """Online players of a running BDS instance, read from its container log. None if the log can't be read."""
    try:
        result = subprocess.run(
            ["docker", "compose", "logs", "--no-log-prefix", "mc"],
            cwd=instance_path, capture_output=True, text=True, timeout=10,
        )
    except Exception as e:
        print(f"Couldn't read the Bedrock server log: {e}")
        return None
    if result.returncode != 0:
        return None
    online = parse_online_players(result.stdout)
    return {
        "online": len(online),
        "max": read_max_players(os.path.join(instance_path, "data")),
        "players": list(online),
        "xuids": online,
    }


def send_command(instance_path: str, command: str, timeout: int = 10) -> Tuple[bool, str]:
    """Type a command into the Bedrock server console. The output only shows up in the log."""
    try:
        result = subprocess.run(
            ["docker", "compose", "exec", "-T", "mc", "send-command", command],
            cwd=instance_path, capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return False, "The server didn't accept the command in time."
    except Exception as e:
        print(f"Bedrock send-command failed: {e}")
        return False, "Couldn't send the command to the server."
    return result.returncode == 0, (result.stdout + result.stderr).strip()


# How long to wait for a command's reply in the log. BDS answers within a fraction of a
# second, so a command that prints nothing gives up after COMMAND_REPLY_WAIT.
COMMAND_REPLY_WAIT = 1.5
COMMAND_REPLY_QUIET = 0.3
COMMAND_POLL_INTERVAL = 0.1

# Log lines BDS writes on its own, which can land between a command and its reply
UNRELATED_LINE = re.compile(r"^(Player (connected|disconnected|Spawned): |Running AutoCompaction)")

# "[2024-01-01 12:00:00:123 INFO] " in front of BDS's own log lines
BDS_LINE_PREFIX = re.compile(r"^\[\d{4}-\d{2}-\d{2} [\d:]+ \w+\] ")


def _log_lines_after(instance_path: str, after: Optional[str]) -> Optional[List[Tuple[str, str]]]:
    """(docker timestamp, text) for each log line, newer than `after` if given. None if the log can't be read."""
    args = ["docker", "compose", "logs", "--no-log-prefix", "--timestamps"]
    args += ["--since", after] if after else ["--tail=1"]
    try:
        result = subprocess.run(args + ["mc"], cwd=instance_path, capture_output=True, text=True, timeout=5)
    except Exception as e:
        print(f"Couldn't read the Bedrock server log: {e}")
        return None
    if result.returncode != 0:
        return None
    lines = []
    for line in result.stdout.splitlines():
        stamp, _, text = line.partition(" ")
        if after is None or _timestamp_key(stamp) > _timestamp_key(after):
            lines.append((stamp, text))
    return lines


def _timestamp_key(stamp: str) -> str:
    """Docker trims trailing zeros from its nanosecond timestamps, so pad them before comparing."""
    base, dot, rest = stamp.rstrip("Z").partition(".")
    return f"{base}.{rest.ljust(9, '0')}" if dot else f"{base}.{'0' * 9}"


def command_reply(command: str, lines: List[str]) -> str:
    """The reply to a command, from the log lines written after it was sent."""
    reply = []
    for line in lines:
        text = BDS_LINE_PREFIX.sub("", line.rstrip())
        # The console's TTY echoes the command itself into the log
        if text and text != command.strip() and not UNRELATED_LINE.search(text):
            reply.append(text)
    return "\n".join(reply)


def run_command(instance_path: str, command: str) -> Tuple[bool, str]:
    """Send a console command and return its reply, read from the log lines that follow it.

    Bedrock has no RCON, so send-command prints nothing; the reply only reaches the log.
    Waits until the reply stops growing, or COMMAND_REPLY_WAIT if nothing shows up.
    """
    before = _log_lines_after(instance_path, None)
    ok, output = send_command(instance_path, command)
    if not ok or before is None:
        return ok, output
    # An empty log means everything written from here on is new
    marker = before[-1][0] if before else "1970-01-01T00:00:00Z"

    lines: List[Tuple[str, str]] = []
    start = last_change = time.monotonic()
    while True:
        time.sleep(COMMAND_POLL_INTERVAL)
        now = time.monotonic()
        latest = _log_lines_after(instance_path, marker)
        if latest is not None and len(latest) > len(lines):
            lines, last_change = latest, now
        if command_reply(command, [text for _, text in lines]) and now - last_change >= COMMAND_REPLY_QUIET:
            break
        if now - start >= COMMAND_REPLY_WAIT:
            break
    return True, command_reply(command, [text for _, text in lines])


# BDS finishes writing pending chunks within a few seconds of `save hold`.
SAVE_HOLD_WAIT = 5


def hold_saving(instance_path: str) -> bool:
    """Stop a running Bedrock server writing its world files, so they can be copied. False if not running."""
    ok, _ = send_command(instance_path, "save hold")
    if ok:
        time.sleep(SAVE_HOLD_WAIT)
    return ok


def resume_saving(instance_path: str) -> None:
    send_command(instance_path, "save resume")
