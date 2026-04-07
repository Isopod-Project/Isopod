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



async def _fetch_pack_url(pack_id, provider, mc_version):
    async with httpx.AsyncClient(timeout=10.0) as client:
        if provider == 'modrinth':
            try:
                res = await client.get(
                    f"https://api.modrinth.com/v2/project/{pack_id}/version",
                    params={"game_versions": f'["{mc_version}"]', "loaders": '["canvas","iris","optifine"]'}
                )
                if res.status_code == 200:
                    data = res.json()
                    if data: return data[0]['files'][0]['url']
            except: pass
        return None

async def get_latest_version_url(pack_id, provider, mc_version):
    # Try current version first
    url = await _fetch_pack_url(pack_id, provider, mc_version)
    if url: return url
    
    # Fallback list for unusual versions (like 1.21 snapshots)
    fallbacks = ["1.21.1", "1.21", "1.20.4", "1.20.1"]
    for v in fallbacks:
        if v == mc_version: continue
        url = await _fetch_pack_url(pack_id, provider, v)
        if url: return url
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

def merge_resource_packs(zip_paths, output_path):
    with tempfile.TemporaryDirectory() as temp_dir:
        # Process from BACK to FRONT (lowest priority packs first, so high priority can overwrite)
        for path in reversed(zip_paths):
            if not os.path.exists(path): continue
            try:
                with zipfile.ZipFile(path, 'r') as zip_ref:
                    # Look for the 'assets' directory. If it's nested (e.g. inside a subfolder), 
                    # we need to lift it.
                    names = zip_ref.namelist()
                    assets_root = ""
                    for name in names:
                        if "assets/" in name and not name.startswith("assets/"):
                            # This pack is nested! e.g. "PackName/assets/..."
                            assets_root = name.split("assets/")[0]
                            break
                    
                    if assets_root:
                        for member in zip_ref.infolist():
                            if member.filename.startswith(assets_root):
                                rel_path = member.filename[len(assets_root):]
                                if not rel_path: continue
                                target = os.path.join(temp_dir, rel_path)
                                if member.is_dir():
                                    os.makedirs(target, exist_ok=True)
                                else:
                                    with open(target, 'wb') as f:
                                        f.write(zip_ref.read(member))
                    else:
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
