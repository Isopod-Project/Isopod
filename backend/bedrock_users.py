"""Bedrock allowlist and operators for User Management.

users.json is the source of truth, as it is on Java servers. Each save mirrors it three ways:
- ALLOW_LIST, ALLOW_LIST_USERS and OPS in docker-compose.yml. itzg's entrypoint rebuilds
  allowlist.json and permissions.json from them on every start, so a change made in the
  dashboard survives a restart.
- allowlist.json and permissions.json themselves. The entrypoint leaves a file alone when its
  variable is empty, e.g. after the last operator is removed.
- allowlist add/remove and op/deop on a running server, through send-command.

Bedrock operators are stored by XUID. A player's XUID is taken from the dashboard, from
allowlist.json (BDS fills it in when an allowlisted player joins), or looked up from the
gamertag. When none of these work, OPS gets the gamertag and the entrypoint looks it up.
"""
import json
import os
import re
import urllib.parse
import urllib.request
from typing import Dict, Iterable, List, Optional, Set, Tuple

# Gamertags are letters, digits and spaces ("Blocky Builder"); # and _ cover suffixed and
# Geyser-style names. Commas, colons, quotes and newlines are rejected: they would break the
# ALLOW_LIST_USERS list or the quoted console command.
GAMERTAG = re.compile(r"^[A-Za-z0-9_#](?:[A-Za-z0-9_# ]{0,30}[A-Za-z0-9_#])?$")

# itzg's entrypoint treats a number of 16+ digits as an XUID rather than a gamertag.
XUID = re.compile(r"^\d{16,20}$")

# Same lookup the itzg entrypoint uses for OPS gamertags.
XUID_LOOKUP = "https://mcprofile.io/api/v1/bedrock/gamertag/{}"


def is_valid_gamertag(name: Optional[str]) -> bool:
    return bool(GAMERTAG.match(name or ""))


def is_xuid(value: Optional[str]) -> bool:
    return bool(XUID.match(str(value or "")))


def split_env_list(value: Optional[str]) -> List[str]:
    """Entries of a comma or newline separated variable. Spaces inside an entry are kept."""
    return [e.strip() for e in re.split(r"[,\n]+", str(value or "")) if e.strip()]


def parse_allow_list_users(value: Optional[str]) -> List[Tuple[str, Optional[str]]]:
    """(gamertag, xuid) pairs from ALLOW_LIST_USERS, which allows "name" or "name:xuid"."""
    pairs = []
    for entry in split_env_list(value):
        name, _, xuid = entry.partition(":")
        pairs.append((name.strip(), xuid.strip() if is_xuid(xuid.strip()) else None))
    return pairs


def read_json_list(path: str) -> list:
    try:
        with open(path) as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    return data if isinstance(data, list) else []


def read_allowlist(data_dir: str) -> List[dict]:
    """[{"name", "xuid"}] from allowlist.json; empty if missing or unreadable."""
    result = []
    for e in read_json_list(os.path.join(data_dir, "allowlist.json")):
        if isinstance(e, dict) and e.get("name"):
            xuid = str(e.get("xuid") or "")
            result.append({"name": str(e["name"]), "xuid": xuid if is_xuid(xuid) else None})
    return result


def read_permissions(data_dir: str) -> List[dict]:
    """Entries of permissions.json that have an XUID and a permission."""
    return [
        e for e in read_json_list(os.path.join(data_dir, "permissions.json"))
        if isinstance(e, dict) and is_xuid(str(e.get("xuid") or "")) and e.get("permission")
    ]


def allow_list_enabled(env: dict) -> bool:
    """Whether the allowlist is enforced. The entrypoint turns it on whenever ALLOW_LIST_USERS has names."""
    return str(env.get("ALLOW_LIST", "")).lower() == "true" or bool(split_env_list(env.get("ALLOW_LIST_USERS")))


def new_user(name: str, xuid: Optional[str] = None, whitelisted: bool = True, is_op: bool = False) -> dict:
    return {"name": name, "uuid": None, "xuid": xuid, "level": 4 if is_op else 0,
            "is_op": is_op, "whitelisted": whitelisted, "active": True}


def load_users(saved: List[dict], data_dir: str, env: dict) -> Tuple[List[dict], bool]:
    """Users for the tab, from users.json plus anything only the server knows about.

    Players in ALLOW_LIST_USERS, allowlist.json or OPS that users.json is missing (a server
    created before this tab existed, or edited by hand) are added, and XUIDs BDS has written
    into allowlist.json are filled in. Returns (users, changed); changed means users.json
    should be rewritten.
    """
    users: Dict[str, dict] = {}
    for u in saved:
        if isinstance(u, dict) and u.get("name"):
            user = new_user(u["name"])
            user.update({k: v for k, v in u.items() if k in user})
            users[u["name"].lower()] = user
    changed = False

    for name, xuid in parse_allow_list_users(env.get("ALLOW_LIST_USERS")) + [(e["name"], e["xuid"]) for e in read_allowlist(data_dir)]:
        key = name.lower()
        if key not in users:
            users[key] = new_user(name, xuid)
            changed = True
        elif xuid and not users[key].get("xuid"):
            users[key]["xuid"] = xuid
            changed = True

    by_xuid = {u["xuid"]: u for u in users.values() if u.get("xuid")}
    for entry in split_env_list(env.get("OPS")):
        user = by_xuid.get(entry) if is_xuid(entry) else users.get(entry.lower())
        if user is None and not is_xuid(entry):
            # An XUID nobody is known by stays in OPS untouched (see access_env)
            user = users[entry.lower()] = new_user(entry, whitelisted=False, is_op=True)
            changed = True
        elif user is not None and not user.get("is_op"):
            user.update(is_op=True, level=4)
            changed = True

    return list(users.values()), changed


def lookup_xuid(name: str) -> Optional[str]:
    """XUID for a gamertag from mcprofile.io, or None if it can't be reached or doesn't know the name."""
    url = XUID_LOOKUP.format(urllib.parse.quote(name, safe=""))
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Isopod"})
        with urllib.request.urlopen(req, timeout=3) as response:
            xuid = str(json.loads(response.read().decode()).get("xuid") or "")
    except Exception as e:
        print(f"XUID lookup failed for {name}: {e}")
        return None
    return xuid if is_xuid(xuid) else None


def normalize(users: Iterable[dict], known: List[dict], lookup=None) -> List[dict]:
    """Validate a save and fill in XUIDs for operators. Raises ValueError for a bad gamertag.

    known is the current user list, so an XUID found earlier isn't looked up again.
    """
    known_xuids = {u["name"].lower(): u.get("xuid") for u in known if u.get("xuid")}
    result, seen = [], set()
    for u in users:
        name = u.get("name") or ""
        if not is_valid_gamertag(name):
            raise ValueError(f'"{name}" isn\'t a valid Xbox gamertag.')
        if name.lower() in seen:
            continue
        seen.add(name.lower())
        is_op = bool(u.get("is_op") or (u.get("level") or 0) > 0)
        xuid = u.get("xuid") if is_xuid(u.get("xuid")) else known_xuids.get(name.lower())
        if is_op and not xuid:
            xuid = (lookup or lookup_xuid)(name)
        result.append({
            "name": name, "uuid": None, "xuid": xuid,
            "level": 4 if is_op else 0, "is_op": is_op,
            "whitelisted": bool(u.get("whitelisted", True)), "active": u.get("active", True) is not False,
        })
    return result


def allowed(users: List[dict]) -> List[dict]:
    return [u for u in users if u.get("whitelisted") and u.get("active")]


def operators(users: List[dict]) -> List[dict]:
    return [u for u in users if u.get("is_op") and u.get("active")]


def _managed_xuids(*user_lists: List[dict]) -> Set[str]:
    return {u["xuid"] for users in user_lists for u in users if u.get("xuid")}


def access_env(users: List[dict], enabled: bool, old_env: dict, old_users: List[dict]) -> dict:
    """ALLOW_LIST, ALLOW_LIST_USERS and OPS for docker-compose.yml.

    ALLOW_LIST_USERS stays empty while the allowlist is off: the entrypoint turns the
    allowlist on whenever it has names. allowlist.json still keeps them for later.
    OPS keeps any XUID that belongs to no managed player, so a hand-added operator stays.
    """
    managed = _managed_xuids(users, old_users)
    unknown_ops = [e for e in split_env_list(old_env.get("OPS")) if is_xuid(e) and e not in managed]
    return {
        "ALLOW_LIST": "true" if enabled else "false",
        "ALLOW_LIST_USERS": ",".join(u["name"] for u in allowed(users)) if enabled else "",
        "OPS": ",".join([u.get("xuid") or u["name"] for u in operators(users)] + unknown_ops),
    }


def write_access_files(data_dir: str, users: List[dict], old_users: List[dict]) -> None:
    """Write allowlist.json and permissions.json to match users.

    permissions.json entries for XUIDs that belong to no managed player are kept.
    """
    allowlist = []
    for u in allowed(users):
        entry = {"ignoresPlayerLimit": False, "name": u["name"]}
        if u.get("xuid"):
            entry["xuid"] = u["xuid"]
        allowlist.append(entry)

    managed = _managed_xuids(users, old_users)
    permissions = [e for e in read_permissions(data_dir) if str(e["xuid"]) not in managed]
    permissions += [{"permission": "operator", "xuid": u["xuid"]} for u in operators(users) if u.get("xuid")]

    with open(os.path.join(data_dir, "allowlist.json"), "w") as f:
        json.dump(allowlist, f, indent=2)
    with open(os.path.join(data_dir, "permissions.json"), "w") as f:
        json.dump(permissions, f, indent=2)


def live_commands(old_users: List[dict], old_enabled: bool, users: List[dict], enabled: bool) -> List[str]:
    """Console commands that bring a running server in line with the saved users."""
    def names(group):
        return {u["name"].lower(): u["name"] for u in group}

    commands = []
    old_allowed, new_allowed = names(allowed(old_users)), names(allowed(users))
    commands += [f'allowlist remove "{n}"' for k, n in old_allowed.items() if k not in new_allowed]
    commands += [f'allowlist add "{n}"' for k, n in new_allowed.items() if k not in old_allowed]
    if enabled != old_enabled:
        commands.append(f"allowlist {'on' if enabled else 'off'}")

    old_ops, new_ops = names(operators(old_users)), names(operators(users))
    commands += [f'deop "{n}"' for k, n in old_ops.items() if k not in new_ops]
    commands += [f'op "{n}"' for k, n in new_ops.items() if k not in old_ops]
    return commands
