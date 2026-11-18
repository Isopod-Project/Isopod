"""Mod rollback suggestions for crash reports.

When a crash report names suspect mods, compare the installed mod jars with the ones a
snapshot recorded before the latest change. A suspect that changed since then can be
put back to the exact jar the snapshot holds, together with any required dependency or
dependent that changed alongside it. Isopod only suggests versions it recorded; with no
snapshot, or when the snapshot can't vouch for the version, it says so instead of guessing.
"""
import hashlib
import io
import json
import os
import re
import tomllib
import zipfile
from typing import Dict, Iterable, List, Optional, Tuple

import yaml

# Dependencies on the game or the loader itself, not on another mod.
PLATFORM_IDS = {
    "minecraft", "java", "fabricloader", "fabric-loader", "quilt_loader", "quilt-loader",
    "forge", "neoforge", "javafml", "lowcodefml",
}
# Folders inside a jar that hold the libraries it bundles (Fabric/Quilt, Forge, NeoForge).
NESTED_JAR_DIRS = ("META-INF/jars/", "META-INF/jarjar/")
MAX_GROUP = 10
# itzg's MODRINTH_PROJECTS accepts "slug:versionId" to hold a project at one version.
MODRINTH_PIN_RE = re.compile(r"^([^:/\s]+):([A-Za-z0-9]{8})$")
VERSION_SPLIT_RE = re.compile(r"[-_](?=[vV]?\d)")


def modrinth_entry_id(entry: str) -> str:
    """The project in a MODRINTH_PROJECTS entry, without a "slug:versionId" pin."""
    match = MODRINTH_PIN_RE.match(entry.strip())
    return match.group(1) if match else entry.strip()


# --- Reading jars --------------------------------------------------------------------

def _filename_stem(filename: str) -> str:
    name = filename[:-len(".disabled")] if filename.endswith(".disabled") else filename
    return name[:-len(".jar")] if name.lower().endswith(".jar") else name


def _id_from_filename(filename: str) -> Tuple[str, str]:
    """("some-mod", "1.2.3") for "Some-Mod-1.2.3.jar", for jars without readable metadata."""
    stem = _filename_stem(filename)
    split = VERSION_SPLIT_RE.search(stem[1:])
    if split:
        return stem[:split.start() + 1].lower(), stem[split.start() + 2:]
    return stem.lower(), ""


def _fabric_depends(depends) -> List[str]:
    if isinstance(depends, dict):
        return list(depends)
    if isinstance(depends, list):
        return [d if isinstance(d, str) else (d or {}).get("id", "") for d in depends
                if isinstance(d, str) or not (d or {}).get("optional")]
    return []


def _manifest_version(names: set, z: zipfile.ZipFile) -> str:
    if "META-INF/MANIFEST.MF" not in names:
        return ""
    text = z.read("META-INF/MANIFEST.MF").decode("utf-8", errors="ignore")
    match = re.search(r"^Implementation-Version:\s*(\S+)", text, re.MULTILINE)
    return match.group(1) if match else ""


def _forge_info(text: str, names: set, z: zipfile.ZipFile) -> dict:
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError:
        data = {}
    mods = data.get("mods") or []
    first = mods[0] if mods and isinstance(mods[0], dict) else {}
    mod_id = first.get("modId") or (re.search(r'modId\s*=\s*["\']([^"\']+)', text) or [None, None])[1]
    version = str(first.get("version") or "")
    if not version or version.startswith("${"):
        version = _manifest_version(names, z)
    depends = []
    for dep_list in (data.get("dependencies") or {}).values():
        for dep in dep_list if isinstance(dep_list, list) else []:
            required = dep.get("mandatory") is True or str(dep.get("type", "")).lower() == "required"
            if required and dep.get("modId"):
                depends.append(dep["modId"])
    return {
        "id": mod_id,
        "name": first.get("displayName"),
        "version": version,
        "depends": depends,
        "provides": [m.get("modId") for m in mods[1:] if isinstance(m, dict) and m.get("modId")],
    }


def read_jar(data: bytes, filename: str, _depth: int = 0) -> dict:
    """The mod ID, name, version, required mod dependencies, and IDs a jar provides (itself and bundled libraries)."""
    info = {"id": None, "name": None, "version": "", "depends": [], "provides": []}
    nested: List[str] = []
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            names = set(z.namelist())
            if "fabric.mod.json" in names:
                meta = json.loads(z.read("fabric.mod.json").decode("utf-8", errors="ignore"), strict=False)
                info.update(id=meta.get("id"), name=meta.get("name"), version=str(meta.get("version") or ""),
                            depends=_fabric_depends(meta.get("depends")), provides=list(meta.get("provides") or []))
            elif "quilt.mod.json" in names:
                loader = json.loads(z.read("quilt.mod.json").decode("utf-8", errors="ignore"), strict=False).get("quilt_loader") or {}
                provides = [p if isinstance(p, str) else (p or {}).get("id", "") for p in loader.get("provides") or []]
                info.update(id=loader.get("id"), name=(loader.get("metadata") or {}).get("name"),
                            version=str(loader.get("version") or ""), depends=_fabric_depends(loader.get("depends")),
                            provides=provides)
            elif "META-INF/neoforge.mods.toml" in names or "META-INF/mods.toml" in names:
                toml_name = "META-INF/neoforge.mods.toml" if "META-INF/neoforge.mods.toml" in names else "META-INF/mods.toml"
                info.update(_forge_info(z.read(toml_name).decode("utf-8", errors="ignore"), names, z))
            elif "plugin.yml" in names or "paper-plugin.yml" in names:
                meta = yaml.safe_load(z.read("paper-plugin.yml" if "paper-plugin.yml" in names else "plugin.yml")) or {}
                info.update(id=meta.get("name"), name=meta.get("name"), version=str(meta.get("version") or ""),
                            depends=list(meta.get("depend") or []))
            elif "mcmod.info" in names:
                meta = json.loads(z.read("mcmod.info").decode("utf-8", errors="ignore"), strict=False)
                item = meta[0] if isinstance(meta, list) and meta else {}
                info.update(id=item.get("modid"), name=item.get("name"), version=str(item.get("version") or ""))
            if _depth == 0:
                nested = [n for n in names if n.startswith(NESTED_JAR_DIRS) and n.endswith(".jar")]
                for n in nested:
                    inner = read_jar(z.read(n), os.path.basename(n), _depth + 1)
                    info["provides"] = list(info["provides"]) + [inner["id"]] + list(inner["provides"])
    except (zipfile.BadZipFile, ValueError, KeyError, yaml.YAMLError, OSError):
        pass
    file_id, file_version = _id_from_filename(filename)
    info["id"] = str(info["id"] or file_id).lower()
    info["name"] = info["name"] or info["id"]
    info["version"] = info["version"] or file_version
    info["depends"] = sorted({str(d).lower() for d in info["depends"] if d} - PLATFORM_IDS - {info["id"]})
    info["provides"] = sorted({str(p).lower() for p in info["provides"] if p})
    return info


# Parsed jars by (where, size, mtime or CRC), so reopening a crash report doesn't reread every jar.
_jar_cache: Dict[tuple, dict] = {}
MAX_CACHED_JARS = 5000


def _entry(key: tuple, read, filename: str) -> dict:
    cached = _jar_cache.get(key)
    if cached is None:
        data = read()
        cached = {**read_jar(data, filename), "sha1": hashlib.sha1(data).hexdigest()}
        if len(_jar_cache) >= MAX_CACHED_JARS:
            _jar_cache.clear()
        _jar_cache[key] = cached
    return {**cached, "file": filename, "enabled": not filename.endswith(".disabled")}


def _read_file(path: str) -> bytes:
    with open(path, "rb") as f:
        return f.read()


def _is_jar(name: str) -> bool:
    return name.lower().endswith((".jar", ".jar.disabled"))


def read_mods_dir(mods_dir: str) -> Dict[str, dict]:
    """Installed jars by mod ID."""
    mods: Dict[str, dict] = {}
    if not os.path.isdir(mods_dir):
        return mods
    for e in sorted(os.scandir(mods_dir), key=lambda e: e.name):
        if e.is_file() and _is_jar(e.name):
            st = e.stat()
            entry = _entry(("file", e.path, st.st_size, st.st_mtime_ns), lambda p=e.path: _read_file(p), e.name)
            mods.setdefault(entry["id"], entry)
    return mods


def read_snapshot(zip_path: str, folder: str) -> Tuple[Dict[str, dict], Dict[str, str]]:
    """The jars a snapshot recorded in folder (e.g. "data/mods") by mod ID, and the server's environment then."""
    prefix = folder.strip("/") + "/"
    mods: Dict[str, dict] = {}
    env: Dict[str, str] = {}
    with zipfile.ZipFile(zip_path) as z:
        for info in sorted(z.infolist(), key=lambda i: i.filename):
            member = info.filename
            rest = member[len(prefix):]
            if member.startswith(prefix) and rest and "/" not in rest and _is_jar(rest):
                entry = _entry(("zip", member, info.CRC, info.file_size), lambda m=member: z.read(m), rest)
                entry["member"] = member
                mods.setdefault(entry["id"], entry)
        if "docker-compose.yml" in z.namelist():
            env = compose_env(z.read("docker-compose.yml").decode("utf-8", errors="ignore"))
    return mods, env


def compose_env(text: str) -> Dict[str, str]:
    """The mc service's environment in a docker-compose.yml."""
    try:
        services = (yaml.safe_load(text) or {}).get("services") or {}
    except yaml.YAMLError:
        return {}
    service = services.get("mc") or (next(iter(services.values()), None) if services else None) or {}
    raw = service.get("environment") or {}
    if isinstance(raw, list):
        return {k: v for k, _, v in (str(item).partition("=") for item in raw)}
    return {str(k): "" if v is None else str(v) for k, v in raw.items()}


# --- Suggestions ---------------------------------------------------------------------

def _provider_of(dep: str, mods: Dict[str, dict]) -> Optional[str]:
    if dep in mods:
        return dep
    return next((mid for mid, m in mods.items() if dep in m["provides"]), None)


def match_suspect(suspect: str, mods: Dict[str, dict]) -> Optional[str]:
    """The installed mod a crash report suspect names: a jar file name, "Name (modid)", a mod ID, or a name."""
    text = suspect.strip()
    lowered = text.lower().removesuffix(".disabled")
    for mid, m in mods.items():
        if m["file"].lower().removesuffix(".disabled") == lowered:
            return mid
    paren = re.search(r"\(([^()]+)\)\s*$", text)
    candidates = [paren.group(1).strip().lower()] if paren else []
    candidates.append(lowered)
    for candidate in candidates:
        found = _provider_of(candidate, mods)
        if found:
            return found
    plain = re.sub(r"\s*\([^()]*\)\s*$", "", text).lower()
    return next((mid for mid, m in mods.items() if (m["name"] or "").lower() == plain), None)


def _changed(now: dict, then: dict) -> bool:
    if now["sha1"] == then["sha1"]:
        return False
    return now["version"] != then["version"] or not now["version"]


def mod_changes(current: Dict[str, dict], previous: Dict[str, dict]) -> List[dict]:
    """Mods added, removed, or updated since the snapshot."""
    changes = []
    for mid in sorted(set(current) | set(previous)):
        now, then = current.get(mid), previous.get(mid)
        if now and not then:
            changes.append({"id": mid, "name": now["name"], "change": "added", "current": now["version"]})
        elif then and not now:
            changes.append({"id": mid, "name": then["name"], "change": "removed", "previous": then["version"]})
        elif _changed(now, then):
            changes.append({"id": mid, "name": now["name"], "change": "updated",
                            "previous": then["version"], "current": now["version"]})
    return changes


def _rollback_group(start: str, current: Dict[str, dict], previous: Dict[str, dict]) -> Tuple[List[str], List[str]]:
    """The mods to roll back together with start, and notes on dependencies it can't account for.

    Adds each required dependency of a restored jar that changed or went missing since the
    snapshot, and each installed mod that requires a restored one and was itself updated.
    """
    group, notes, queue = [start], [], [start]
    while queue and len(group) < MAX_GROUP:
        mid = queue.pop(0)
        for dep in previous[mid]["depends"]:
            if _provider_of(dep, previous) is None or _provider_of(dep, {k: previous[k] for k in group}):
                continue
            then_id = _provider_of(dep, previous)
            now_id = _provider_of(dep, current)
            if now_id is None or (then_id in current and _changed(current[then_id], previous[then_id])):
                if then_id not in group:
                    group.append(then_id)
                    queue.append(then_id)
        for other, m in current.items():
            if other in group or mid not in m["depends"]:
                continue
            if other in previous and _changed(m, previous[other]):
                group.append(other)
                queue.append(other)
            elif other not in previous:
                notes.append(f"{m['name']} was added after the snapshot and requires {previous[mid]['name']}; "
                             "it may not work with the older version.")
    if queue:
        notes.append("More mods depend on this one than Isopod can roll back together. Restore the whole snapshot instead.")
    return group, notes


def _environment_notes(env_now: Dict[str, str], env_then: Dict[str, str]) -> Tuple[List[str], List[str]]:
    """Reasons the snapshot's jars can't be trusted on today's server, and softer warnings."""
    blockers, warnings = [], []
    if not env_then:
        blockers.append("The snapshot has no server settings, so Isopod can't confirm which Minecraft version and loader it ran on.")
        return blockers, warnings
    for key, label in (("VERSION", "Minecraft version"), ("TYPE", "server type")):
        then, now = (env_then.get(key) or "").strip(), (env_now.get(key) or "").strip()
        if then.upper() != now.upper():
            blockers.append(f"The snapshot was taken on {label} {then or 'unset'}, but the server now runs {now or 'unset'}. "
                            "The older jar was built for the old setup.")
    loader_keys = sorted(k for k in set(env_now) | set(env_then)
                         if k.endswith(("LOADER_VERSION", "FORGE_VERSION", "_BUILD")) or k == "FOLIABUILD")
    for key in loader_keys:
        if (env_then.get(key) or "") != (env_now.get(key) or ""):
            warnings.append(f"{key} changed from {env_then.get(key) or 'unset'} to {env_now.get(key) or 'unset'} since the "
                            "snapshot. The older jar ran on the old loader version.")
    return blockers, warnings


def _managed_by(mid: str, mod: dict, env: Dict[str, str], cf_records: Dict[str, dict]) -> Optional[str]:
    """"modpack", "curseforge", or "modrinth" when the server downloads this mod itself, else None."""
    if env.get("MODRINTH_MODPACK") or (env.get("TYPE") or "").upper() in ("AUTO_CURSEFORGE", "CURSEFORGE", "FTBA"):
        return "modpack"
    stem = _filename_stem(mod["file"]).lower()
    for rec in cf_records.values():
        if (rec.get("file") or "").lower() == mod["file"].lower().removesuffix(".disabled") or (rec.get("mod_id") or "").lower() == mid:
            return "curseforge"
    entries = [modrinth_entry_id(e).lower() for key in ("MODRINTH_PROJECTS", "MODRINTH_DISABLED")
               for e in (env.get(key) or "").split(",") if e.strip()]
    for entry in entries:
        if entry == mid or entry.replace("-", "").replace("_", "") == mid.replace("-", "").replace("_", "") or stem.startswith(entry):
            return "modrinth"
    return None


MANAGED_BLOCKERS = {
    "modpack": "It's part of the modpack, which the server reinstalls at the pack's version on each start. "
               "Restore the whole snapshot or change the modpack version instead.",
    "curseforge": "It was added from CurseForge, which the server downloads at the newest version on each start, "
                  "so Isopod can't hold it at an older one. Disable it until a fixed version is released, or restore the whole snapshot.",
}


def _snapshot_for(mid: str, current: Dict[str, dict], history: List[dict]) -> Tuple[Optional[dict], str]:
    """The newest snapshot in which the mod differs from today, and how: "updated" or "added".
    "unchanged" (with the oldest snapshot) when every snapshot holds the same jar."""
    for snap in history:
        then = snap["mods"].get(mid)
        if then is None:
            return snap, "added"
        if _changed(current[mid], then):
            return snap, "updated"
    return (history[-1], "unchanged") if history else (None, "")


def snapshot_info(snap: dict) -> dict:
    return {k: snap.get(k) for k in ("name", "reason", "created")}


def suggest(
    suspects: Iterable[str],
    current: Dict[str, dict],
    history: List[dict],
    env_now: Dict[str, str],
    cf_records: Optional[Dict[str, dict]] = None,
) -> List[dict]:
    """One suggestion per suspect, saying what the recorded history supports.

    history holds the snapshots taken before the crash, newest first, each as
    {"name", "reason", "created", "mods": read_snapshot's jars, "env": its environment}.
    """
    cf_records = cf_records or {}
    suggestions = []
    seen = set()
    for suspect in suspects:
        mid = match_suspect(suspect, current)
        if mid is not None and mid in seen:
            continue
        base = {"suspect": suspect, "id": mid, "available": False, "notes": [], "group": [], "snapshot": None}
        if mid is None:
            snap = next((s for s in history if match_suspect(suspect, s["mods"])), None)
            if snap:
                then = snap["mods"][match_suspect(suspect, snap["mods"])]
                suggestions.append({**base, "status": "removed", "name": then["name"], "previous": then["version"],
                                    "snapshot": snapshot_info(snap),
                                    "reason": "It was installed when the snapshot was taken but isn't any more."})
            else:
                suggestions.append({**base, "status": "unmatched", "name": suspect,
                                    "reason": "Isopod couldn't match this suspect to an installed mod file."})
            continue
        seen.add(mid)
        mod = current[mid]
        base.update(name=mod["name"], current=mod["version"], file=mod["file"])
        snap, how = _snapshot_for(mid, current, history)
        if snap is None:
            suggestions.append({**base, "status": "no_history",
                                "reason": "No snapshot was taken before the crash, so Isopod has no earlier version "
                                          "of this mod on record and won't guess one."})
            continue
        base["snapshot"] = snapshot_info(snap)
        if how == "added":
            suggestions.append({**base, "status": "added",
                                "reason": "It was installed after the snapshot, so there's no earlier version to go back to. "
                                          "Disable it in the Mods tab to test whether it causes the crash."})
            continue
        previous = snap["mods"]
        then = previous[mid]
        if how == "unchanged":
            suggestions.append({**base, "status": "unchanged", "previous": then["version"],
                                "reason": "It hasn't changed since the oldest snapshot, so rolling it back won't help. "
                                          "The crash may come from another change or from how it works with another mod."})
            continue

        group, notes = _rollback_group(mid, current, previous)
        blockers, warnings = _environment_notes(env_now, snap.get("env") or {})
        members = []
        for gid in group:
            now_mod, then_mod = current.get(gid), previous[gid]
            managed = _managed_by(gid, now_mod or then_mod, env_now, cf_records)
            if managed in MANAGED_BLOCKERS:
                blockers.append(f"{then_mod['name']}: {MANAGED_BLOCKERS[managed]}")
            members.append({
                "id": gid, "name": then_mod["name"], "previous": then_mod["version"],
                "current": now_mod["version"] if now_mod else None,
                "previous_file": then_mod["file"], "current_file": now_mod["file"] if now_mod else None,
                "modrinth": managed == "modrinth",
            })
        if any(m["modrinth"] for m in members):
            notes.append("Mods added from Modrinth are pinned to the restored version so the server doesn't download "
                         "the newest one again. Remove and re-add the mod to get updates again.")
        suggestions.append({
            **base,
            "status": "previous_version",
            "previous": then["version"],
            "previous_file": then["file"],
            "reason": f"Named as a suspect in the crash report, and it changed from {then['version'] or then['file']} "
                      f"to {mod['version'] or mod['file']} after this snapshot was taken.",
            "group": members,
            "available": not blockers,
            "blockers": blockers,
            "notes": warnings + notes,
        })
    if sum(1 for s in suggestions if s["status"] == "previous_version") > 1:
        for s in suggestions:
            if s["status"] == "previous_version":
                s["notes"].append("Several suspects changed since their snapshots. Rolling back one may not be enough.")
    return suggestions


# --- Applying a rollback -------------------------------------------------------------

def read_previous_jars(zip_path: str, members: List[dict], previous: Dict[str, dict]) -> Dict[str, bytes]:
    """The snapshot's bytes for each mod in a rollback group, read before anything changes."""
    with zipfile.ZipFile(zip_path) as z:
        return {m["id"]: z.read(previous[m["id"]]["member"]) for m in members}


def swap_jars(mods_dir: str, members: List[dict], current: Dict[str, dict], jars: Dict[str, bytes]) -> List[str]:
    """Replace each member's current jar with the recorded one, keeping it disabled if it was. Returns the files written."""
    written = []
    for m in members:
        now = current.get(m["id"])
        name = os.path.basename(m["previous_file"]).removesuffix(".disabled")
        if now and not now["enabled"]:
            name += ".disabled"
        target = os.path.join(mods_dir, name)
        tmp = target + ".isopod-rollback"
        with open(tmp, "wb") as f:
            f.write(jars[m["id"]])
        if now:
            old = os.path.join(mods_dir, now["file"])
            if os.path.exists(old) and os.path.normcase(old) != os.path.normcase(target):
                os.remove(old)
        os.replace(tmp, target)
        written.append(name)
    return written


def pin_modrinth(env: Dict[str, str], pins: Dict[str, str]) -> Dict[str, str]:
    """Pin MODRINTH_PROJECTS/MODRINTH_DISABLED entries: {slug or project ID (lowercase): version ID}."""
    env = dict(env)
    for key in ("MODRINTH_PROJECTS", "MODRINTH_DISABLED"):
        if not env.get(key):
            continue
        entries = []
        for entry in (e.strip() for e in env[key].split(",") if e.strip()):
            base = modrinth_entry_id(entry)
            entries.append(f"{base}:{pins[base.lower()]}" if base.lower() in pins else entry)
        env[key] = ",".join(entries)
    return env
