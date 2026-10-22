"""Mods bundled in a Modrinth modpack, known before the server has ever started.

itzg/minecraft-server downloads and unpacks the `.mrpack` on first container start, so until
then `data/mods` is empty. To show the pack's contents straight away, Isopod reads the pack's
`modrinth.index.json`, resolves each mod's Modrinth project, and saves the result next to the
instance's docker-compose.yml so the Mods tab works offline and without repeat API calls.
"""
import io
import json
import os
import re
import zipfile
from typing import Dict, List, Optional

import httpx

MODRINTH_API = "https://api.modrinth.com/v2"

# Saved in the instance root, keyed by modpack version so a version change refetches it.
INDEX_FILENAME = "modpack_mods.json"

# Modrinth CDN download links carry the project and version ids:
# https://cdn.modrinth.com/data/<project_id>/versions/<version_id>/<filename>
CDN_URL = re.compile(r"^https://cdn\.modrinth\.com/data/([A-Za-z0-9]+)/versions/([A-Za-z0-9]+)/")


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


def is_installed(data_dir: str, version_id: Optional[str]) -> bool:
    """Whether itzg has already installed this modpack version into the server's data folder."""
    try:
        with open(os.path.join(data_dir, ".modrinth-modpack-manifest.json"), "r") as f:
            manifest = json.load(f)
    except (OSError, ValueError):
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


async def get_mods(instance_path: str, modpack: str, version_id: Optional[str]) -> List[dict]:
    """The modpack's mod list: the saved copy if it matches, otherwise fetched from Modrinth and saved."""
    saved = load_saved(instance_path, version_id)
    if saved:
        return saved.get("mods", [])

    async with httpx.AsyncClient(timeout=30) as client:
        version = await _fetch_version(client, modpack, version_id)
        if not version:
            return []
        mrpack_url = next((f.get("url") for f in version.get("files", [])
                           if f.get("filename", "").lower().endswith(".mrpack")), None)
        if not mrpack_url:
            return []
        res = await client.get(mrpack_url, follow_redirects=True)
        if res.status_code != 200:
            return []
        with zipfile.ZipFile(io.BytesIO(res.content)) as z:
            if "modrinth.index.json" not in z.namelist():
                return []
            index_data = json.loads(z.read("modrinth.index.json").decode("utf-8"))
        mods = await build_mod_list(client, index_data)

    save(instance_path, modpack, version["id"], mods)
    return mods
