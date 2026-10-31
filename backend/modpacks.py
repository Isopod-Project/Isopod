"""Mods bundled in a Modrinth modpack, known before the server has ever started.

itzg/minecraft-server downloads and unpacks the `.mrpack` on first container start, so until
then `data/mods` is empty. To show the pack's contents straight away, Isopod reads the pack's
`modrinth.index.json`, resolves each mod's Modrinth project, and saves the result next to the
instance's docker-compose.yml so the Mods tab works offline and without repeat API calls.

It also checks Modrinth for newer versions of a pack. Each project's version list is cached in
memory, so the dashboard's status polling can report an available update without any API calls.
"""
import io
import json
import os
import re
import time
import zipfile
from typing import Dict, List, Optional

import httpx

MODRINTH_API = "https://api.modrinth.com/v2"

# Saved in the instance root, keyed by modpack version so a version change refetches it.
INDEX_FILENAME = "modpack_mods.json"

# Modrinth CDN download links carry the project and version ids:
# https://cdn.modrinth.com/data/<project_id>/versions/<version_id>/<filename>
CDN_URL = re.compile(r"^https://cdn\.modrinth\.com/data/([A-Za-z0-9]+)/versions/([A-Za-z0-9]+)/")

# MODRINTH_MODPACK can also be a page URL or a local .mrpack, which can't be looked up by id.
PROJECT_REF = re.compile(r"^[A-Za-z0-9_+-]+(?:\.[A-Za-z0-9_+-]+)*$")

# How long a project's version list counts as current.
CHECK_INTERVAL = 3600

HEADERS = {"User-Agent": "Isopod-Project/Isopod"}

# A pack on a release isn't offered a newer beta or alpha, and a pack on a beta isn't offered an alpha.
VERSION_STABILITY = {"alpha": 0, "beta": 1, "release": 2}

# Project id or slug (lowercase) -> {"fetched": time, "project": ..., "versions": newest first}
_projects: Dict[str, dict] = {}


class ModpackError(Exception):
    """A modpack lookup failed. The message is safe to show to the user."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def is_client_only_mod(filename: str) -> bool:
    fn = filename.lower()
    if fn.endswith(".jar"):
        fn = fn[:-4]

    # Normalize: strip all non-alphanumeric chars
    norm = re.sub(r'[^a-z0-9]', '', fn)

    # Common client-side indicators
    client_indicators = [
        "sodium", "rubidium", "embeddium", "iris", "oculus", "modmenu", "continuity",
        "entityculling", "immediatelyfast", "dynamicfps", "e4mc", "controlify",
        "reesessodiumoptions", "sodiumextra", "bettergrassify", "cubeswithoutborders",
        "animatica", "skyboxify", "puzzle", "presencefootsteps", "soundphysics",
        "borderlessfullscreen", "languagereload", "morechathistory", "mainmenucredits",
        "crashassistant", "bettermounthud", "capeprovider", "zoomify", "debugify",
        "fastquit", "nochatreports", "optigui", "litematica", "minihud", "tweakeroo",
        "lambdynamiclights", "bobby", "distanthorizons", "fancymenu", "konkrete",
        "controlling", "searchables", "customskinloader", "fabrishot", "perspectivemod",
        "chunkfade", "shulboxtooltip", "itemphysics", "ambience", "visuality",
        "skinlayers", "3dskinlayers", "wavesurfer", "legendarytooltips"
    ]

    return any(norm.startswith(indicator) for indicator in client_indicators)


def client_excludes(index_data: dict) -> List[str]:
    """Filenames in a modrinth.index.json that a dedicated server shouldn't download."""
    excludes = []
    for f in index_data.get("files", []):
        filename = f.get("path", "").split("/")[-1]
        if filename and (f.get("env", {}).get("server") == "unsupported" or is_client_only_mod(filename)):
            excludes.append(filename)
    return excludes


def _index_path(instance_path: str) -> str:
    return os.path.join(instance_path, INDEX_FILENAME)


def load_saved(instance_path: str, version_id: Optional[str]) -> Optional[dict]:
    """The saved mod list for this modpack version, or None if missing or for another version."""
    try:
        with open(_index_path(instance_path), "r") as f:
            saved = json.load(f)
    except (OSError, ValueError):
        return None
    if version_id and saved.get("version_id") != version_id:
        return None
    return saved


def saved_filenames(instance_path: str) -> List[str]:
    """Filenames of the mods in the saved modpack list, whatever version it was saved for."""
    saved = load_saved(instance_path, None)
    return [m["filename"] for m in saved.get("mods", [])] if saved else []


def _installed_manifest(data_dir: str) -> Optional[dict]:
    try:
        with open(os.path.join(data_dir, ".modrinth-modpack-manifest.json"), "r") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def is_installed(data_dir: str, version_id: Optional[str]) -> bool:
    """Whether itzg has already installed this modpack version into the server's data folder."""
    manifest = _installed_manifest(data_dir)
    if manifest is None:
        return False
    return not version_id or manifest.get("versionId") == version_id


def mark_removed(instance_path: str, filename: str) -> None:
    """Hide a modpack mod the user removed, so it isn't listed as merely disabled."""
    saved = load_saved(instance_path, None)
    if not saved:
        return
    for m in saved.get("mods", []):
        if m["filename"] == filename:
            m["removed"] = True
    _write(instance_path, saved)


def mods_from_index(index_data: dict) -> List[dict]:
    """Server-side jar files listed in a modrinth.index.json."""
    mods = []
    for f in index_data.get("files", []):
        path = f.get("path", "")
        if not path.startswith("mods/") or not path.lower().endswith(".jar"):
            continue
        if f.get("env", {}).get("server") == "unsupported":
            continue
        project_id = version_id = None
        for url in f.get("downloads", []):
            m = CDN_URL.match(url)
            if m:
                project_id, version_id = m.group(1), m.group(2)
                break
        mods.append({
            "filename": path.split("/")[-1],
            "project_id": project_id,
            "version_id": version_id,
            "sha1": f.get("hashes", {}).get("sha1"),
        })
    return mods


async def _resolve_ids_by_hash(client: httpx.AsyncClient, mods: List[dict]) -> None:
    """Fill in project/version ids for files not downloaded from the Modrinth CDN."""
    hashes = [m["sha1"] for m in mods if not m["project_id"] and m["sha1"]]
    if not hashes:
        return
    res = await client.post(f"{MODRINTH_API}/version_files", json={"hashes": hashes, "algorithm": "sha1"})
    if res.status_code != 200:
        return
    by_hash = res.json()
    for m in mods:
        version = by_hash.get(m["sha1"]) if not m["project_id"] else None
        if version:
            m["project_id"] = version.get("project_id")
            m["version_id"] = version.get("id")


async def _bulk(client: httpx.AsyncClient, endpoint: str, ids: List[str]) -> Dict[str, dict]:
    """Look up many Modrinth projects or versions by id, in batches to keep URLs short."""
    found = {}
    for start in range(0, len(ids), 100):
        res = await client.get(f"{MODRINTH_API}/{endpoint}", params={"ids": json.dumps(ids[start:start + 100])})
        if res.status_code == 200:
            for item in res.json():
                found[item["id"]] = item
    return found


async def _fetch_version(client: httpx.AsyncClient, modpack: str, version_id: Optional[str]) -> Optional[dict]:
    if version_id:
        res = await client.get(f"{MODRINTH_API}/version/{version_id}")
        return res.json() if res.status_code == 200 else None
    res = await client.get(f"{MODRINTH_API}/project/{modpack}/version")
    versions = res.json() if res.status_code == 200 else []
    return versions[0] if versions else None


async def build_mod_list(client: httpx.AsyncClient, index_data: dict) -> List[dict]:
    """Mods from a modrinth.index.json, with their Modrinth project name, icon and version."""
    mods = mods_from_index(index_data)
    await _resolve_ids_by_hash(client, mods)

    project_ids = sorted({m["project_id"] for m in mods if m["project_id"]})
    version_ids = sorted({m["version_id"] for m in mods if m["version_id"]})
    projects = await _bulk(client, "projects", project_ids)
    versions = await _bulk(client, "versions", version_ids)

    for m in mods:
        project = projects.get(m["project_id"]) or {}
        version = versions.get(m["version_id"]) or {}
        m["slug"] = project.get("slug")
        m["name"] = project.get("title")
        m["summary"] = project.get("description")
        m["icon_url"] = project.get("icon_url")
        m["version_number"] = version.get("version_number")
        del m["sha1"]
    return mods


def save(instance_path: str, modpack: str, version_id: str, mods: List[dict]) -> None:
    _write(instance_path, {"modpack": modpack, "version_id": version_id, "mods": mods})


def _write(instance_path: str, saved: dict) -> None:
    with open(_index_path(instance_path), "w") as f:
        json.dump(saved, f, indent=2)


async def save_from_index(client: httpx.AsyncClient, instance_path: str, modpack: str, version_id: str, index_data: dict) -> None:
    """Resolve and save the mod list during instance creation, where the index is already downloaded."""
    save(instance_path, modpack, version_id, await build_mod_list(client, index_data))


async def _download_index(client: httpx.AsyncClient, version: dict) -> Optional[dict]:
    """The modrinth.index.json inside a version's .mrpack, or None if it can't be read."""
    mrpack_url = next((f.get("url") for f in version.get("files", [])
                       if f.get("filename", "").lower().endswith(".mrpack")), None)
    if not mrpack_url:
        return None
    res = await client.get(mrpack_url, follow_redirects=True)
    if res.status_code != 200:
        return None
    with zipfile.ZipFile(io.BytesIO(res.content)) as z:
        if "modrinth.index.json" not in z.namelist():
            return None
        return json.loads(z.read("modrinth.index.json").decode("utf-8"))


async def get_mods(instance_path: str, modpack: str, version_id: Optional[str]) -> List[dict]:
    """The modpack's mod list: the saved copy if it matches, otherwise fetched from Modrinth and saved."""
    saved = load_saved(instance_path, version_id)
    if saved:
        return saved.get("mods", [])

    async with httpx.AsyncClient(timeout=30) as client:
        version = await _fetch_version(client, modpack, version_id)
        if not version:
            return []
        index_data = await _download_index(client, version)
        if not index_data:
            return []
        mods = await build_mod_list(client, index_data)

    save(instance_path, modpack, version["id"], mods)
    return mods


async def _fetch_project(modpack: str) -> dict:
    if not PROJECT_REF.match(modpack):
        raise ModpackError("MODRINTH_MODPACK isn't a Modrinth project ID, so Isopod can't check it for updates.", 400)
    try:
        async with httpx.AsyncClient(timeout=30, headers=HEADERS) as client:
            project = await client.get(f"{MODRINTH_API}/project/{modpack}")
            versions = await client.get(f"{MODRINTH_API}/project/{modpack}/version")
        if project.status_code == 404:
            raise ModpackError(f"Modrinth has no modpack called {modpack}.", 404)
        if project.status_code != 200 or versions.status_code != 200:
            raise ModpackError(f"Modrinth returned {max(project.status_code, versions.status_code)} while looking up {modpack}.")
        return {
            "fetched": time.time(),
            "project": project.json(),
            "versions": sorted(versions.json(), key=lambda v: v.get("date_published") or "", reverse=True),
        }
    except (httpx.HTTPError, ValueError) as e:
        raise ModpackError(f"Couldn't reach Modrinth: {e}")


async def get_project(modpack: str, max_age: float = CHECK_INTERVAL) -> dict:
    """The project and its versions, newest first. If Modrinth can't be reached, an older copy will do."""
    key = modpack.lower()
    cached = _projects.get(key)
    if cached and time.time() - cached["fetched"] < max_age:
        return cached
    try:
        _projects[key] = await _fetch_project(modpack)
    except ModpackError:
        if not cached:
            raise
    return _projects[key]


def find_version(versions: List[dict], version_ref: Optional[str]) -> Optional[dict]:
    """MODRINTH_VERSION can hold a version's id or its version number."""
    if not version_ref:
        return None
    return next((v for v in versions if version_ref in (v.get("id"), v.get("version_number"))), None)


def latest_for(versions: List[dict], current: Optional[dict]) -> Optional[dict]:
    """The newest version at least as stable as the current one (versions are newest first)."""
    floor = VERSION_STABILITY.get((current or {}).get("version_type"), 0)
    return next((v for v in versions if VERSION_STABILITY.get(v.get("version_type"), 0) >= floor), None)


def _is_newer(version: Optional[dict], than: Optional[dict]) -> bool:
    if not version or not than or version.get("id") == than.get("id"):
        return False
    return (version.get("date_published") or "") > (than.get("date_published") or "")


def _current_version(versions: List[dict], data_dir: str, version_ref: Optional[str]) -> Optional[dict]:
    """The pinned version, or for an unpinned pack the one itzg installed."""
    return find_version(versions, version_ref or (_installed_manifest(data_dir) or {}).get("versionId"))


def _version_summary(version: dict) -> dict:
    game_versions = version.get("game_versions") or []
    return {
        "id": version.get("id"),
        "name": version.get("name"),
        "version_number": version.get("version_number"),
        "version_type": version.get("version_type"),
        "minecraft_version": game_versions[0] if game_versions else None,
        "loaders": version.get("loaders") or [],
        "date_published": version.get("date_published"),
        "changelog": version.get("changelog"),
    }


async def get_status(data_dir: str, modpack: str, version_ref: Optional[str], force: bool = False) -> dict:
    """Everything the Modpack tab shows: the project, the current and latest versions, and all versions."""
    entry = await get_project(modpack, 0 if force else CHECK_INTERVAL)
    project, versions = entry["project"], entry["versions"]
    current = _current_version(versions, data_dir, version_ref)
    latest = latest_for(versions, current)
    return {
        "project": {
            "title": project.get("title"),
            "summary": project.get("description"),
            "icon_url": project.get("icon_url"),
            "url": f"https://modrinth.com/modpack/{project.get('slug') or project.get('id')}",
        },
        "current": _version_summary(current) if current else None,
        "latest": _version_summary(latest) if latest else None,
        "update_available": _is_newer(latest, current),
        "versions": [_version_summary(v) for v in versions],
    }


def cached_update(data_dir: str, modpack: Optional[str], version_ref: Optional[str]) -> Optional[dict]:
    """The update available for a pack according to the cache, or None. Makes no API calls."""
    entry = _projects.get((modpack or "").strip().lower())
    if not entry:
        return None
    current = _current_version(entry["versions"], data_dir, version_ref)
    latest = latest_for(entry["versions"], current)
    if not _is_newer(latest, current):
        return None
    return {"current": current.get("version_number"), "latest": latest.get("version_number")}


async def load_target(modpack: str, version_id: str) -> dict:
    """A version to update to, checked to belong to this pack, with its index and mod list."""
    entry = await get_project(modpack, 0)
    version = find_version(entry["versions"], version_id)
    if not version:
        raise ModpackError("That version isn't part of this modpack.", 404)
    name = version.get("version_number")
    try:
        async with httpx.AsyncClient(timeout=120, headers=HEADERS) as client:
            index_data = await _download_index(client, version)
            if not index_data:
                raise ModpackError(f"Couldn't read the modpack file for {name}.")
            mods = await build_mod_list(client, index_data)
    except (httpx.HTTPError, ValueError, zipfile.BadZipFile) as e:
        raise ModpackError(f"Couldn't download {name} from Modrinth: {e}")
    game_versions = version.get("game_versions") or []
    return {
        "version": version,
        "index_data": index_data,
        "mods": mods,
        # The index says what the pack was built for; a version can list several game versions
        "minecraft_version": index_data.get("dependencies", {}).get("minecraft") or (game_versions[0] if game_versions else None),
    }


def merge_excludes(index_data: dict, previous: List[str], old_mods: List[dict], new_mods: List[dict]) -> List[str]:
    """MODRINTH_EXCLUDE_FILES for a new pack version.

    Mod filenames usually change between versions, so mods the user excluded are followed by
    Modrinth project. Filenames the new version doesn't have are dropped so the list doesn't grow
    with every update; entries that aren't filenames are partial matches the user typed, and stay.
    """
    excluded = {x.lower() for x in previous}
    excluded_projects = {m["project_id"] for m in old_mods if m.get("project_id") and m["filename"].lower() in excluded}
    pack_files = {f.get("path", "").split("/")[-1].lower() for f in index_data.get("files", [])}

    kept = [x for x in previous if not x.lower().endswith(".jar") or x.lower() in pack_files]
    followed = [m["filename"] for m in new_mods if m.get("project_id") in excluded_projects]

    merged = {}
    for name in client_excludes(index_data) + kept + followed:
        merged.setdefault(name.lower(), name)
    return list(merged.values())


def carry_removed(old_mods: List[dict], new_mods: List[dict]) -> None:
    """Keep mods the user removed hidden in the new version's mod list."""
    removed_projects = {m["project_id"] for m in old_mods if m.get("removed") and m.get("project_id")}
    for m in new_mods:
        if m.get("project_id") in removed_projects:
            m["removed"] = True
