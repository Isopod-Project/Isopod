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

async def get_latest_version_url(client: httpx.AsyncClient, provider: str, project_id: str, mc_version: str):
    """Fetch the direct download URL for the latest compatible version of a pack."""
    try:
        if provider == "modrinth":
            # Modrinth API
            params = {
                "game_versions": json.dumps([mc_version]),
            }
            res = await client.get(f"https://api.modrinth.com/v2/project/{project_id}/version", params=params)
            if res.status_code == 200:
                data = res.json()
                if data and len(data) > 0:
                    # Find primary file or first file
                    files = data[0].get("files", [])
                    primary = next((f for f in files if f.get("primary")), files[0] if files else None)
                    if primary:
                        return primary["url"]
        
        elif provider == "curseforge":
            # CurseForge API (via proxy)
            res = await client.get(f"https://api.curse.tools/v1/cf/mods/{project_id}")
            if res.status_code == 200:
                data = res.json().get("data", {})
                for file in data.get("latestFiles", []):
                    if mc_version in file.get("gameVersions", []):
                        return file["downloadUrl"]
                        
    except Exception as e:
        print(f"Error resolving version for {project_id}: {e}")
    return None

async def download_file(client: httpx.AsyncClient, url: str, dest_path: str):
    """Download a file to a specific path."""
    async with client.stream("GET", url, follow_redirects=True) as response:
        if response.status_code == 200:
            with open(dest_path, "wb") as f:
                async for chunk in response.aiter_bytes():
                    f.write(chunk)
            return True
    return False

def merge_resource_packs(zip_paths: List[str], output_path: str):
    """Merge multiple ZIP files into one, resolving conflicts by priority (first wins)."""
    with tempfile.TemporaryDirectory() as temp_dir:
        # Unpack in REVERSE order so the first pack in the list has the final word (top priority)
        # However, usually we want the LATEST to overwrite the oldest. 
        # But for resource packs, the TOP one in the list is usually the highest priority.
        for path in reversed(zip_paths):
            if not os.path.exists(path):
                continue
            try:
                with zipfile.ZipFile(path, 'r') as zip_ref:
                    zip_ref.extractall(temp_dir)
            except Exception as e:
                print(f"Error unpacking {path}: {e}")

        # Ensure a basic pack.mcmeta exists if missing
        mcmeta_path = os.path.join(temp_dir, "pack.mcmeta")
        if not os.path.exists(mcmeta_path):
            with open(mcmeta_path, "w") as f:
                json.dump({
                    "pack": {
                        "pack_format": 34, # 1.21 default, might want to adjust based on MC version
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

async def upload_to_mcpacks(zip_path: str):
    """Upload a ZIP file to MCPacks and return (url, sha1_hash)."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        with open(zip_path, "rb") as f:
            files = {"file": ("bundle.zip", f, "application/zip")}
            res = await client.post(MCPACKS_API_URL, files=files)
            
            if res.status_code == 201 or res.status_code == 200:
                data = res.json()
                return data.get("url"), data.get("hash")
            else:
                print(f"MCPacks upload failed: {res.status_code} - {res.text}")
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
