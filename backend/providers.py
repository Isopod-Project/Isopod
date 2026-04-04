from typing import List, Optional, Dict, Any
import httpx
import os
import json
import re
import asyncio
import shutil
import zipfile

class ModpackProvider:
    """Base class for Minecraft modpack providers."""
    async def search(self, q: str, mc_version: Optional[str] = None, loader: Optional[str] = None) -> List[Dict[str, Any]]:
        raise NotImplementedError()
    
    async def get_manifest(self, pack_id: str, version_id: Optional[str] = None) -> Dict[str, Any]:
        """Fetches the manifest for a specific pack version."""
        raise NotImplementedError()
    
    async def download_files(self, manifest: Dict[str, Any], dest_dir: str):
        """Downloads all files listed in the manifest to the destination directory."""
        raise NotImplementedError()

class CurseForgeProvider(ModpackProvider):
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.curseforge.com/v1"
        self.headers = {"x-api-key": self.api_key}

    async def search(self, q: str, mc_version: Optional[str] = None, loader: Optional[str] = None) -> List[Dict[str, Any]]:
        # Using '4471' for modpacks
        params = {
            "gameId": 432, # Minecraft
            "classId": 4471, # Modpacks
            "searchFilter": q,
            "pageSize": 20
        }
        if mc_version:
            params["gameVersion"] = mc_version
            
        # modLoaderType: Forge=1, Cauldron=2, LiteLoader=3, Fabric=4, Quilt=5, NeoForge=6
        if loader:
            l = loader.lower()
            if "forge" in l: params["modLoaderType"] = 1
            elif "fabric" in l: params["modLoaderType"] = 4
            elif "quilt" in l: params["modLoaderType"] = 5
            elif "neoforge" in l: params["modLoaderType"] = 6

        async with httpx.AsyncClient() as client:
            res = await client.get(f"{self.base_url}/mods/search", params=params, headers=self.headers)
            res.raise_for_status()
            data = res.json().get("data", [])
            
        results = []
        for item in data:
            results.append({
                "id": str(item["id"]),
                "slug": item.get("slug"),
                "name": item["name"],
                "summary": item["summary"],
                "icon_url": item.get("logo", {}).get("thumbnailUrl"),
                "author": item["authors"][0]["name"] if item["authors"] else "Unknown",
                "downloads": item["downloadCount"],
                "url": item.get("links", {}).get("websiteUrl", ""),
                "provider": "curseforge",
                "categories": [c["name"].lower() for c in item.get("categories", [])]
            })
        return results

    async def get_manifest(self, pack_id: str, version_id: Optional[str] = None) -> Dict[str, Any]:
        async with httpx.AsyncClient() as client:
            # 1. Fetch mod info
            mod_res = await client.get(f"{self.base_url}/mods/{pack_id}", headers=self.headers)
            mod_res.raise_for_status()
            mod_data = mod_res.json()["data"]
            
            # 2. Fetch specific version or latest from data
            file_data = None
            if version_id:
                file_res = await client.get(f"{self.base_url}/mods/{pack_id}/files/{version_id}", headers=self.headers)
                file_res.raise_for_status()
                file_data = file_res.json()["data"]
            else:
                # Use first from latestFiles if version_id is not provided
                if mod_data.get("latestFiles"):
                   file_data = mod_data["latestFiles"][0]
            
            if not file_data:
                raise Exception("No file version found for this pack.")
                
            # The "Prism" Secret: Restricted Download
            if not file_data.get("downloadUrl"):
                # Prism Action Required Flag
                return {
                    "error": "Manual Action Required",
                    "detail": "Third-Party Distribution disabled for this modpack.",
                    "id": pack_id,
                    "name": mod_data["name"]
                }
                
            return {
                "id": pack_id,
                "name": mod_data["name"],
                "version": file_data["displayName"],
                "download_url": file_data["downloadUrl"],
                "manifest_type": "curseforge",
                "file_id": file_data["id"]
            }

class FTBProvider(ModpackProvider):
    def __init__(self, cf_provider: Optional[CurseForgeProvider] = None):
        self.base_url = "https://api.feed-the-beast.com/v1/modpack"
        self.cf_provider = cf_provider

    async def search(self, q: str, mc_version: Optional[str] = None, loader: Optional[str] = None) -> List[Dict[str, Any]]:
        async with httpx.AsyncClient() as client:
            url = f"{self.base_url}/search/20"
            res = await client.get(url, params={"term": q})
            res.raise_for_status()
            data = res.json()
            
        results = []
        for item in data.get("packs", []):
            results.append({
                "id": str(item["id"]),
                "name": item["name"],
                "summary": item.get("description", ""),
                "icon_url": next((a["url"] for a in item.get("art", []) if a["type"] == "square"), None),
                "author": "Feed The Beast",
                "downloads": item.get("installs", 0),
                "url": f"https://www.feed-the-beast.com/modpack/{item['id']}",
                "provider": "ftb",
                "categories": []
            })
        return results

    async def get_manifest(self, pack_id: str, version_id: Optional[str] = None) -> Dict[str, Any]:
        """
        FTB Fetch: GET /<MODPACK_ID>/<VERSION_ID>
        Parses private-manifest.json style info and cross-references CurseForge.
        """
        async with httpx.AsyncClient() as client:
            v_id = version_id
            if not v_id:
                res_p = await client.get(f"{self.base_url}/{pack_id}")
                res_p.raise_for_status()
                pack_data = res_p.json()
                if pack_data.get("versions"):
                    # Use last (newest) version
                    v_id = pack_data["versions"][-1]["id"]
                else:
                    raise Exception("No versions found for FTB pack.")

            url = f"{self.base_url}/{pack_id}/{v_id}"
            res = await client.get(url)
            res.raise_for_status()
            manifest = res.json()
            
            # Prism Action: For each file, if provider is curseforge, switch to CF logic
            if self.cf_provider:
                files = manifest.get("files", [])
                for f in files:
                    if f.get("provider") == "curseforge":
                        try:
                            # Fetch actual CF file metadata
                            # FTB provides projectID and fileID for CF files
                            cf_file = await self.cf_provider.get_manifest(f["projectID"], f["fileID"])
                            f["resolved_url"] = cf_file.get("download_url")
                            if "error" in cf_file:
                                f["needs_manual"] = True
                        except:
                            pass
            
            return manifest

class TechnicProvider(ModpackProvider):
    def __init__(self):
        self.base_url = "https://api.technicpack.net/modpack"

    async def search(self, q: str, mc_version: Optional[str] = None, loader: Optional[str] = None) -> List[Dict[str, Any]]:
        # Technic search usually returns partial info or requires a slug
        return []

    async def get_manifest(self, slug: str, version: Optional[str] = "latest") -> Dict[str, Any]:
        url = f"{self.base_url}/{slug}"
        async with httpx.AsyncClient() as client:
            res = await client.get(url)
            res.raise_for_status()
            data = res.json()
            
            if data.get("solder"):
                solder_url = data["solder"]
                v = version if version != "latest" else data.get("version", "latest")
                s_url = f"{solder_url.rstrip('/')}/modpack/{slug}/{v}"
                solder_res = await client.get(s_url)
                solder_data = solder_res.json()
                return {
                    "type": "solder",
                    "files": solder_data.get("mods", []), 
                    "slug": slug,
                    "version": v,
                    "name": data.get("displayName", slug)
                }
            else:
                return {
                    "type": "direct",
                    "url": data["url"],
                    "slug": slug,
                    "version": data["version"],
                    "name": data.get("displayName", slug)
                }

    async def download_files(self, manifest: Dict[str, Any], dest_dir: str):
        """
        Special logic for Technic: ensure bin/modpack.jar is handled.
        """
        os.makedirs(dest_dir, exist_ok=True)
        if manifest["type"] == "direct":
            zip_url = manifest["url"]
            async with httpx.AsyncClient(follow_redirects=True) as client:
                res = await client.get(zip_url)
                zip_path = os.path.join(dest_dir, "modpack.zip")
                with open(zip_path, "wb") as f:
                    f.write(res.content)
            
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(dest_dir)
            
            # Legacy Technic structure: bin/modpack.jar
            bin_dir = os.path.join(dest_dir, "bin")
            modpack_jar = os.path.join(bin_dir, "modpack.jar")
            if os.path.exists(modpack_jar):
                # Ensure it's treated as the server JAR
                # itzg/minecraft-server can use CUSTOM_SERVER_JAR
                pass
            os.remove(zip_path)
        elif manifest["type"] == "solder":
            # Download mods from solder list
            for mod in manifest.get("files", []):
                mod_url = mod.get("url")
                if mod_url:
                    async with httpx.AsyncClient(follow_redirects=True) as client:
                        res = await client.get(mod_url)
                        # Solder mods are usually zip/jar
                        mod_name = os.path.basename(mod_url)
                        with open(os.path.join(dest_dir, mod_name), "wb") as f:
                            f.write(res.content)
