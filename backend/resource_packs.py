import os
import shutil
import zipfile
import httpx
import json
import hashlib
import tempfile
import asyncio
from typing import List, Dict, Optional

# Constants
MCPACKS_API_URL = "https://mcpacks.dev/api/v1/packs"


async def _fetch_pack_url(client: httpx.AsyncClient, pack_id: str, provider: str, mc_version: str):
    """Try to find a download URL for a specific pack + MC version combo."""
    if provider == 'modrinth':
        try:
            # Don't filter by loader — most resource packs have no loader tag
            res = await client.get(
                f"https://api.modrinth.com/v2/project/{pack_id}/version",
                params={"game_versions": f'["{mc_version}"]'}
            )
            if res.status_code == 200:
                data = res.json()
                if data and len(data) > 0:
                    files = data[0].get("files", [])
                    primary = next((f for f in files if f.get("primary")), files[0] if files else None)
                    if primary:
                        return primary["url"]
        except Exception as e:
            print(f"  [modrinth] Error fetching {pack_id} for {mc_version}: {e}")

    elif provider == 'curseforge':
        try:
            res = await client.get(f"https://api.curse.tools/v1/cf/mods/{pack_id}")
            if res.status_code == 200:
                data = res.json().get("data", {})
                for file in data.get("latestFiles", []):
                    if mc_version in file.get("gameVersions", []):
                        return file.get("downloadUrl")
        except Exception as e:
            print(f"  [curseforge] Error fetching {pack_id} for {mc_version}: {e}")

    return None


async def get_latest_version_url(client: httpx.AsyncClient, provider: str, pack_id: str, mc_version: str):
    """
    Fetch the download URL for a pack. Tries the exact MC version first,
    then falls back through common stable versions.
    """
    # Try exact version first
    print(f"  Resolving {provider}/{pack_id} for MC {mc_version}...")
    url = await _fetch_pack_url(client, pack_id, provider, mc_version)
    if url:
        print(f"    -> Found for {mc_version}")
        return url

    # Fallback: try without version filter (get latest release)
    if provider == 'modrinth':
        try:
            res = await client.get(
                f"https://api.modrinth.com/v2/project/{pack_id}/version",
            )
            if res.status_code == 200:
                data = res.json()
                if data and len(data) > 0:
                    files = data[0].get("files", [])
                    primary = next((f for f in files if f.get("primary")), files[0] if files else None)
                    if primary:
                        print(f"    -> Using latest available version (no version filter)")
                        return primary["url"]
        except Exception as e:
            print(f"    -> Fallback failed: {e}")

    return None


async def download_file(client: httpx.AsyncClient, url: str, dest_path: str):
    """Download a file to a specific path."""
    print(f"  Downloading {url}...")
    async with client.stream("GET", url, follow_redirects=True) as response:
        if response.status_code == 200:
            with open(dest_path, "wb") as f:
                async for chunk in response.aiter_bytes():
                    f.write(chunk)
            size = os.path.getsize(dest_path)
            print(f"    -> Saved ({size} bytes)")
            return True
    print(f"    -> FAILED (status {response.status_code})")
    return False


def merge_resource_packs(zip_paths, output_path):
    """Merge multiple resource pack ZIPs into a single bundle."""
    print(f"  Merging {len(zip_paths)} packs...")
    with tempfile.TemporaryDirectory() as temp_dir:
        # Process from BACK to FRONT (lowest priority first, so high priority overwrites)
        for path in reversed(zip_paths):
            if not os.path.exists(path):
                continue
            try:
                with zipfile.ZipFile(path, 'r') as zip_ref:
                    # Some packs nest their content inside a subfolder.
                    # Detect this by looking for assets/ not at root level.
                    names = zip_ref.namelist()
                    assets_root = ""
                    for name in names:
                        if "assets/" in name and not name.startswith("assets/"):
                            # Nested pack, e.g. "PackName-v1.2/assets/..."
                            assets_root = name.split("assets/")[0]
                            break

                    if assets_root:
                        # Extract with path adjustment
                        for member in zip_ref.infolist():
                            if member.filename.startswith(assets_root):
                                rel_path = member.filename[len(assets_root):]
                                if not rel_path:
                                    continue
                                target = os.path.join(temp_dir, rel_path)
                                if member.is_dir():
                                    os.makedirs(target, exist_ok=True)
                                else:
                                    os.makedirs(os.path.dirname(target), exist_ok=True)
                                    with open(target, 'wb') as f:
                                        f.write(zip_ref.read(member))
                            # Also extract pack.mcmeta and pack.png from root
                            elif member.filename.endswith("pack.mcmeta") or member.filename.endswith("pack.png"):
                                basename = os.path.basename(member.filename)
                                target = os.path.join(temp_dir, basename)
                                with open(target, 'wb') as f:
                                    f.write(zip_ref.read(member))
                    else:
                        zip_ref.extractall(temp_dir)

                print(f"    -> Unpacked: {os.path.basename(path)}")
            except Exception as e:
                print(f"    -> Error unpacking {path}: {e}")

        # Ensure a basic pack.mcmeta exists
        mcmeta_path = os.path.join(temp_dir, "pack.mcmeta")
        if not os.path.exists(mcmeta_path):
            with open(mcmeta_path, "w") as f:
                json.dump({
                    "pack": {
                        "pack_format": 34,
                        "description": "Isopod Combined Resource Pack"
                    }
                }, f)

        # Zip it back up
        with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zip_out:
            for root, dirs, files in os.walk(temp_dir):
                for file in files:
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, temp_dir)
                    zip_out.write(full_path, rel_path)

        size = os.path.getsize(output_path)
        print(f"  Bundle created: {output_path} ({size} bytes)")


async def upload_to_mcpacks(zip_path: str):
    """Upload a ZIP file to MCPacks and return (url, sha1_hash)."""
    print(f"  Uploading bundle to MCPacks...")
    async with httpx.AsyncClient(timeout=60.0) as client:
        with open(zip_path, "rb") as f:
            files = {"file": ("bundle.zip", f, "application/zip")}
            res = await client.post(MCPACKS_API_URL, files=files)

            if res.status_code in (200, 201):
                data = res.json()
                url = data.get("url")
                sha = data.get("hash")
                print(f"  Upload OK: {url}")
                return url, sha
            else:
                print(f"  MCPacks upload FAILED: {res.status_code} - {res.text}")
                return None, None


def get_file_sha1(path: str):
    """Calculate SHA-1 hash of a file."""
    sha1 = hashlib.sha1()
    with open(path, "rb") as f:
        while True:
            data = f.read(65536)
            if not data:
                break
            sha1.update(data)
    return sha1.hexdigest()
