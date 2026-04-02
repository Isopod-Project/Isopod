import os
import subprocess
import shutil
import re
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import docker
import yaml
from typing import List, Optional, Dict, Any
import httpx
import json
import time

load_dotenv()

app = FastAPI(title="Isopod Backend")

# We will need CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SERVERS_DIR = os.getenv("SERVERS_DIR", "./servers")

try:
    docker_client = docker.from_env()
except docker.errors.DockerException:
    print("Warning: Could not connect to Docker daemon.")
    docker_client = None

class InstanceConfig(BaseModel):
    image: str
    environment: Dict[str, str]

class ModResponse(BaseModel):
    id: str
    name: str
    summary: str
    icon_url: Optional[str]
    author: str
    downloads: int
    url: str

class InstanceStatus(BaseModel):
    instance_id: str
    is_running: bool
    containers: list

class CreateInstanceRequest(BaseModel):
    name: str
    template: str
    port: int
    version: Optional[str] = "latest"
    loader_version: Optional[str] = "latest"
    modrinth_id: Optional[str] = None
    cf_id: Optional[str] = None

class RenameInstanceRequest(BaseModel):
    name: str

class CommandRequest(BaseModel):
    command: str

class Instance(BaseModel):
    id: str
    name: str
    path: str
    has_compose: bool
    status: str

def get_instance_path(instance_id: str) -> str:
    # Basic sanitize
    safe_id = "".join(c for c in instance_id if c.isalnum() or c in ('-', '_'))
    path = os.path.join(SERVERS_DIR, safe_id)
    if not os.path.exists(path) or not os.path.isdir(path):
        raise HTTPException(status_code=404, detail="Instance not found")
    return path

@app.get("/api/instances", response_model=List[Instance])
def list_instances():
    """List all valid instances in the SERVERS_DIR."""
    if not os.path.exists(SERVERS_DIR):
        print(f"Directory {SERVERS_DIR} not found. Creating it.")
        os.makedirs(SERVERS_DIR, exist_ok=True)

    instances = []
    for entry in os.scandir(SERVERS_DIR):
        if entry.is_dir():
            compose_path = os.path.join(entry.path, "docker-compose.yml")
            has_compose = os.path.exists(compose_path)
            
            if has_compose:
                instances.append(Instance(
                    id=entry.name,
                    name=entry.name.replace("-", " ").title(),
                    path=entry.path,
                    has_compose=has_compose,
                    status="Valid"
                ))
                
    return instances

@app.get("/api/instances/{instance_id}/status")
def get_instance_status(instance_id: str):
    """Pull real running status of the Docker containers for an instance."""
    if not docker_client:
        raise HTTPException(status_code=500, detail="Docker client not initialized")

    project_label_value = "".join(c for c in instance_id if c.isalnum() or c in ('-', '_')).lower()
    
    filters = {"label": f"com.docker.compose.project={project_label_value}"}
    containers = docker_client.containers.list(all=True, filters=filters)
    
    if not containers:
        filters = {"label": f"com.docker.compose.project={instance_id}"}
        containers = docker_client.containers.list(all=True, filters=filters)

    is_running = any(c.status == "running" for c in containers)
    
    # Check logs for "Done" heartbeat if running
    is_ready = False
    if is_running:
        try:
            # Check most recent logs for Minecraft heartbeats
            log_result = subprocess.run(
                ["docker", "compose", "logs", "--tail=100", "mc"],
                cwd=get_instance_path(instance_id),
                capture_output=True, text=True, timeout=5
            )
            # Log heartbeats: Done (2.345s)! or Done!
            if "Done (" in log_result.stdout or "Done!" in log_result.stdout:
                is_ready = True
        except: pass

    # Get metadata like version and last active
    version = "Unknown"
    last_online = 0
    try:
        path = get_instance_path(instance_id)
        # Try to pull version from docker-compose.yml
        compose_path = os.path.join(path, "docker-compose.yml")
        if os.path.exists(compose_path):
           with open(compose_path, 'r') as f:
               cdata = yaml.safe_load(f)
               services = cdata.get("services", {})
               # Support both top-level services or nested keys
               mc_config = services.get("mc") or list(services.values())[0]
               env = mc_config.get("environment", {})
               version = env.get("VERSION", "Unknown")
        
        # Last online from docker-compose.yml mod date
        last_online = os.path.getmtime(compose_path)
    except: pass

    container_info = []
    for c in containers:
        container_info.append({
            "id": c.short_id,
            "name": c.name,
            "state": c.status,
            "image": c.image.tags[0] if c.image.tags else c.image.id,    
        })

    return {
        "instance_id": instance_id,
        "is_running": is_running,
        "is_ready": is_ready,
        "version": version,
        "last_online": last_online,
        "containers": container_info
    }

@app.post("/api/instances/{instance_id}/start")
def start_instance(instance_id: str):
    path = get_instance_path(instance_id)
    # Start all services defined in the instance's compose file
    result = subprocess.run(["docker", "compose", "up", "-d"], cwd=path, capture_output=True, text=True)
    if result.returncode != 0:
        raise HTTPException(status_code=400, detail=f"Docker Compose failed: {result.stderr}")
    return {"message": "Started"}

@app.post("/api/instances/{instance_id}/stop")
def stop_instance(instance_id: str):
    path = get_instance_path(instance_id)
    result = subprocess.run(["docker", "compose", "stop"], cwd=path, capture_output=True, text=True)
    if result.returncode != 0:
        raise HTTPException(status_code=400, detail=f"Docker Compose failed: {result.stderr}")
    return {"message": "Stopped"}

@app.get("/api/instances/{instance_id}/config")
def get_config(instance_id: str):
    path = get_instance_path(instance_id)
    compose_path = os.path.join(path, "docker-compose.yml")
    if not os.path.exists(compose_path):
        raise HTTPException(status_code=404, detail="docker-compose.yml not found")
        
    with open(compose_path, "r") as f:
        config = yaml.safe_load(f)
        
    services = config.get("services", {})
    if not services:
        return {"image": "", "environment": {}}
        
    first_service_name = list(services.keys())[0]
    service = services[first_service_name]
    
    env_vars = {}
    if "environment" in service:
        if isinstance(service["environment"], list):
            for item in service["environment"]:
                if "=" in item:
                    k, v = item.split("=", 1)
                    env_vars[k] = v
        elif isinstance(service["environment"], dict):
            env_vars = service["environment"]
            
    return {
        "image": service.get("image", ""),
        "environment": env_vars,
    }

@app.put("/api/instances/{instance_id}/config")
def update_config(instance_id: str, new_config: InstanceConfig):
    path = get_instance_path(instance_id)
    compose_path = os.path.join(path, "docker-compose.yml")
    if not os.path.exists(compose_path):
        raise HTTPException(status_code=404, detail="docker-compose.yml not found")
        
    with open(compose_path, "r") as f:
        config = yaml.safe_load(f)
        
    services = config.get("services", {})
    if services:
        first_service_name = list(services.keys())[0]
        config['services'][first_service_name]['image'] = new_config.image
        config['services'][first_service_name]['environment'] = new_config.environment
        
    with open(compose_path, "w") as f:
        yaml.dump(config, f, default_flow_style=False)
        
    return {"message": "Config updated"}

# Meta & Mod Proxy Endpoints
VERSION_MANIFEST_URL = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json"
cached_versions = {"time": 0, "data": None}
# Cache for mod metadata to avoid hitting APIs too hard
mod_metadata_cache = {} 

@app.get("/api/meta/versions")
async def get_mc_versions():
    global cached_versions
    now = time.time()
    if cached_versions["data"] and (now - cached_versions["time"] < 3600):
        return cached_versions["data"]
        
    async with httpx.AsyncClient() as client:
        res = await client.get(VERSION_MANIFEST_URL)
        data = res.json()
        cached_versions = {"time": now, "data": data}
        return data

@app.get("/api/meta/loaders/{loader}")
async def get_loader_versions(loader: str, mc_version: Optional[str] = None):
    """Fetch available versions for a specific mod loader, optionally filtered by MC version."""
    loader = loader.lower()
    print(f"DEBUG: Fetching {loader} versions for MC={mc_version}")
    try:
        async with httpx.AsyncClient() as client:
            if loader == "fabric":
                url = f"https://meta.fabricmc.net/v2/versions/loader"
                if mc_version and mc_version != "latest":
                    url = f"https://meta.fabricmc.net/v2/versions/loader/{mc_version}"
                print(f"DEBUG: Fetching Fabric from {url}")
                res = await client.get(url)
                data = res.json()
                if mc_version and mc_version != "latest":
                    return [{"id": v["loader"]["version"], "stable": v["loader"]["stable"]} for v in data]
                else:
                    return [{"id": v["version"], "stable": v["stable"]} for v in data]

            elif loader == "quilt":
                url = f"https://meta.quiltmc.org/v2/versions/loader"
                if mc_version and mc_version != "latest":
                    url = f"https://meta.quiltmc.org/v2/versions/loader/{mc_version}"
                print(f"DEBUG: Fetching Quilt from {url}")
                res = await client.get(url)
                data = res.json()
                if mc_version and mc_version != "latest":
                    return [{"id": v["loader"]["version"], "stable": v["loader"]["version"].count('-') == 0} for v in data]
                else:
                    return [{"id": v["version"], "stable": v["version"].count('-') == 0} for v in data]

            elif loader == "forge":
                url = f"https://bmclapi2.bangbang93.com/forge/minecraft/{mc_version}" if mc_version and mc_version != "latest" else "https://bmclapi2.bangbang93.com/forge/promotions"
                print(f"DEBUG: Fetching Forge from {url}")
                res = await client.get(url)
                if not res.is_success and mc_version:
                    # Fallback to promotions
                    print("DEBUG: Forge version-specific fetch failed, falling back to promotions")
                    res = await client.get("https://bmclapi2.bangbang93.com/forge/promotions")
                    data = res.json()
                    promos = data.get("promos", {})
                    return [{"id": v, "name": k, "stable": "recommended" in k} for k, v in promos.items()]
                
                data = res.json()
                if mc_version and mc_version != "latest" and isinstance(data, list):
                    return [{"id": v["version"], "stable": v["type"] == "recommended"} for v in data]
                else:
                    promos = data.get("promos", {})
                    return [{"id": v, "name": k, "stable": "recommended" in k} for k, v in promos.items()]
            
            elif loader == "neoforge":
                url = f"https://bmclapi2.bangbang93.com/neoforge/list/{mc_version}" if mc_version and mc_version != "latest" else "https://bmclapi2.bangbang93.com/neoforge/list"
                print(f"DEBUG: Fetching NeoForge from {url}")
                res = await client.get(url)
                if not res.is_success and mc_version:
                     print("DEBUG: NeoForge version-specific fetch failed, falling back to all")
                     res = await client.get("https://bmclapi2.bangbang93.com/neoforge/list")
                data = res.json()
                return [{"id": v, "stable": True} for v in data]

            elif loader == "paper":
                if not mc_version or mc_version == "latest":
                    # Paper doesn't have a global 'latest' endpoint, need to pick one?
                    # Let's just return a placeholder for latest
                    return [{"id": "latest", "stable": True}]
                
                url = f"https://api.papermc.io/v2/projects/paper/versions/{mc_version}"
                print(f"DEBUG: Fetching Paper from {url}")
                res = await client.get(url)
                if res.is_success:
                    data = res.json()
                    # Return builds? Or just the version?
                    # PaperMC API for versions returns a list of builds
                    builds_res = await client.get(f"{url}/builds")
                    if builds_res.is_success:
                        builds_data = builds_res.json()
                        builds = builds_data.get("builds", [])
                        # Return in reverse order (newest first)
                        return [{"id": str(b["build"]), "stable": b["channel"] == "default"} for b in reversed(builds)]
                return [{"id": "latest", "stable": True}]

            elif loader == "spigot":
                # Spigot is traditionally built via BuildTools, but itzg handles it
                return [{"id": "latest", "stable": True}]

    except Exception as e:
        print(f"DEBUG: Error fetching {loader} versions: {e}")
        return []

    return []

@app.get("/api/mods/search/modrinth")
async def search_modrinth(q: Optional[str] = None, mc_version: Optional[str] = None, loader: Optional[str] = None, class_type: str = "mod"):
    # Handle "undefined" literals from frontend
    q = None if q == "undefined" or not q else q
    mc_version = None if mc_version == "undefined" or not mc_version else mc_version
    loader = None if loader == "undefined" or not loader else loader
    
    # If query is empty, we browse via facets
    query_str = q if q else ""
        
    facets = [
        [f"project_type:{class_type}"],
        ["server_side:required", "server_side:optional"] # Skip "unsupported" (client-only)
    ]
    if mc_version:
        facets.append([f"versions:{mc_version}"])
    if loader:
        facets.append([f"categories:{loader.lower()}"])
        
    url = "https://api.modrinth.com/v2/search"
    params = {
        "query": q,
        "facets": json.dumps(facets),
        "limit": 20
    }
    
    async with httpx.AsyncClient() as client:
        res = await client.get(url, params=params)
        data = res.json()
        
    results = []
    for item in data.get("hits", []):
        results.append({
            "id": item["slug"], # Using slug as ID for itzg/minecraft-server
            "name": item["title"],
            "summary": item["description"],
            "icon_url": item.get("icon_url"),
            "author": item.get("author", "Unknown"),
            "downloads": item.get("downloads", 0),
            "url": f"https://modrinth.com/mod/{item['slug']}",
            "categories": item.get("categories", [])
        })
    return results

@app.get("/api/mods/search/curseforge")
async def search_curseforge(q: Optional[str] = None, mc_version: Optional[str] = None, loader: Optional[str] = None, class_type: str = "mod"):
    # Handle "undefined" literals from frontend
    q = None if q == "undefined" or not q else q
    mc_version = None if mc_version == "undefined" or not mc_version else mc_version
    loader = None if loader == "undefined" or not loader else loader
    
    # Using '6' for mods, '4471' for modpacks
    class_id = 4471 if class_type == "modpack" else 6
    
    # If query is empty, we browse via parameters
    query_str = q if q else ""
        
    # Using a known public proxy for CurseForge searches
    # itzg/minecraft-server uses the CurseForge ID (int)
    url = "https://api.curse.tools/v1/cf/mods/search"
    
    mod_loader_type = 0 # Any
    if loader:
        l = loader.lower()
        if "forge" in l: mod_loader_type = 1
        elif "cauldron" in l: mod_loader_type = 2
        elif "liteLoader" in l: mod_loader_type = 3
        elif "fabric" in l: mod_loader_type = 4
        elif "quilt" in l: mod_loader_type = 5
        
    params = {
        "gameId": 432, # Minecraft
        "searchFilter": q,
        "classId": class_id, 
        "excludeCategoryIds": "4764" if class_id == 6 else None, # Client Side only for mods
        "pageSize": 20
    }
    if mc_version:
        params["gameVersion"] = mc_version
    if mod_loader_type > 0:
        params["modLoaderType"] = mod_loader_type

    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(url, params=params)
            data = res.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"CurseForge proxy error: {str(e)}")
        
    results = []
    try:
        # CurseForge API is notoriously flaky with its data structure
        mod_list = data.get("data", [])
        if not isinstance(mod_list, list):
            mod_list = []
            
        for item in mod_list:
            authors = item.get("authors", [])
            author_name = authors[0].get("name", "Unknown") if authors and len(authors) > 0 else "Unknown"
            
            logo = item.get("logo", {})
            icon_url = logo.get("thumbnailUrl") if logo else None
            
            results.append({
                "id": str(item.get("id", "")),
                "name": item.get("name", "Unknown Modpack"),
                "summary": item.get("summary", ""),
                "icon_url": icon_url,
                "author": author_name,
                "downloads": int(item.get("downloadCount", 0)) if item.get("downloadCount") is not None else 0,
                "url": item.get("links", {}).get("websiteUrl", "") if item.get("links") else "",
                "categories": [c.get("name", "").lower() for c in item.get("categories", [])] if item.get("categories") else []
            })
    except Exception as e:
        print(f"DEBUG: Error parsing CurseForge data: {e}")
        
    return results

def generate_slug(text: str) -> str:
    slug = text.lower()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    return slug.strip('-')

@app.post("/api/instances")
def create_instance(req: CreateInstanceRequest):
    slug = generate_slug(req.name)
    path = os.path.join(SERVERS_DIR, slug)
    if os.path.exists(path):
        raise HTTPException(status_code=400, detail="Instance with similar name already exists")
        
    os.makedirs(path, exist_ok=True)
    
    # Generate the docker-compose template using itzg/minecraft-server
    compose_content = {
        "services": {
            "mc": {
                "image": "itzg/minecraft-server",
                "container_name": f"isopod_{slug}",
                "ports": [f"{req.port}:25565"],
                "environment": [
                    "EULA=TRUE",
                    f"TYPE={req.template.upper()}",
                    f"VERSION={req.version or 'latest'}",
                    f"MOTD={req.name} Hosted by Isopod",
                    "ENABLE_RCON=true",
                    "RCON_PASSWORD=isopod"
                ],
                "volumes": ["./data:/data"],
                "restart": "unless-stopped"
            }
        }
    }
    
    # Add modpack/loader if present
    env = compose_content["services"]["mc"]["environment"]
    template = req.template.upper()
    if req.loader_version and req.loader_version != "latest":
        if template == "FABRIC":
            env.append(f"FABRIC_LOADER_VERSION={req.loader_version}")
        elif template == "FORGE":
            env.append(f"FORGEVERSION={req.loader_version}")
        elif template == "NEOFORGE":
            env.append(f"NEOFORGEVERSION={req.loader_version}")
        elif template == "QUILT":
            env.append(f"QUILT_LOADER_VERSION={req.loader_version}")
        elif template == "PAPER":
            # Paper uses its own version but itzg handles TYPE=PAPER
            # If loader_version is a build number, it might not be what it expects in TYPE=PAPER
            # But we can try setting it. Normally TYPE=PAPER handles it.
            pass
        else:
            env.append(f"LOADER_VERSION={req.loader_version}")

    if req.modrinth_id:
        env.append(f"MODRINTH_PROJECTS={req.modrinth_id}")
    if req.cf_id:
        env.append(f"CF_PROJECTS={req.cf_id}")
    
    with open(os.path.join(path, "docker-compose.yml"), "w") as f:
        yaml.dump(compose_content, f, default_flow_style=False)
        
    return {"id": slug, "message": "Instance created"}

@app.delete("/api/instances/{instance_id}")
def delete_instance(instance_id: str):
    path = get_instance_path(instance_id)
    # Safely stop containers before purging
    subprocess.run(["docker", "compose", "down"], cwd=path, capture_output=True)
    shutil.rmtree(path, ignore_errors=True)
    return {"message": "Instance deleted"}

@app.post("/api/instances/{instance_id}/rename")
def rename_instance(instance_id: str, req: RenameInstanceRequest):
    old_path = get_instance_path(instance_id)
    new_slug = generate_slug(req.name)
    new_path = os.path.join(SERVERS_DIR, new_slug)
    
    if os.path.exists(new_path):
        raise HTTPException(status_code=400, detail="Instance with that name already exists")

    # Rename the directory
    try:
        os.rename(old_path, new_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    # Update docker-compose.yml
    compose_path = os.path.join(new_path, "docker-compose.yml")
    if os.path.exists(compose_path):
        try:
            with open(compose_path, "r") as f:
                config = yaml.safe_load(f)
            
            services = config.get("services", {})
            if services:
                # Assuming first or "mc" service is the primary
                service_name = "mc" if "mc" in services else list(services.keys())[0]
                service = services[service_name]
                service["container_name"] = f"isopod_{new_slug}"
                
                # Update MOTD in environment if it exists
                env = service.get("environment", [])
                if isinstance(env, list):
                    for i, item in enumerate(env):
                        if item.startswith("MOTD="):
                            env[i] = f"MOTD={req.name} Hosted by Isopod"
                            break
                elif isinstance(env, dict):
                    if "MOTD" in env:
                        env["MOTD"] = f"{req.name} Hosted by Isopod"
            
            with open(compose_path, "w") as f:
                yaml.dump(config, f, default_flow_style=False)
        except Exception as e:
            # Revert folder name if compose update radically fails?
            # Or just continue since directory rename is the main thing
            print(f"Error updating compose after rename: {e}")
            
    return {"id": new_slug, "message": "Instance renamed"}

@app.get("/api/instances/{instance_id}/logs")
def get_instance_logs(instance_id: str, tail: int = 200):
    path = get_instance_path(instance_id)
    try:
        result = subprocess.run(
            ["docker", "compose", "logs", f"--tail={tail}"],
            cwd=path,
            capture_output=True,
            text=True
        )
        return {"logs": result.stdout + result.stderr}
    except Exception as e:
        return {"logs": f"Error fetching logs: {str(e)}"}

@app.post("/api/instances/{instance_id}/command")
def execute_command(instance_id: str, req: CommandRequest):
    """Execute a command on the 'mc' service of the instance using docker compose exec."""
    path = get_instance_path(instance_id)
    # Using 'docker compose exec mc rcon-cli [command]'
    # rcon-cli is the built-in helper in itzg/minecraft-server
    cmd = ["docker", "compose", "exec", "-T", "mc", "rcon-cli", req.command]
    try:
        # Check if running
        result = subprocess.run(cmd, cwd=path, capture_output=True, text=True, timeout=10)
        return {
            "output": result.stdout + result.stderr,
            "success": result.returncode == 0
        }
    except Exception as e:
        return {"output": f"Execution error: {str(e)}", "success": False}

@app.get("/api/mods/metadata")
async def get_mods_metadata(modrinth_ids: str = "", cf_ids: str = ""):
    """Fetch metadata for multiple mods from Modrinth and CurseForge."""
    results = []
    
    m_ids = [i.strip() for i in modrinth_ids.split(",") if i.strip()]
    c_ids = [i.strip() for i in cf_ids.split(",") if i.strip()]
    
    async with httpx.AsyncClient() as client:
        # Modrinth bulk lookup
        if m_ids:
            # Check cache first
            to_fetch = [mid for mid in m_ids if mid not in mod_metadata_cache]
            if to_fetch:
                try:
                    # Modrinth supports bulk projects via /projects?ids=[...]
                    # But they recommend slugs/ids in a list
                    res = await client.get(f"https://api.modrinth.com/v2/projects", params={"ids": json.dumps(to_fetch)})
                    if res.status_code == 200:
                        for project in res.json():
                            meta = {
                                "id": project["slug"],
                                "name": project["title"],
                                "summary": project["description"],
                                "icon_url": project.get("icon_url"),
                                "author": "-", # Needs another call or deeper parsing
                                "downloads": project.get("downloads", 0),
                                "url": f"https://modrinth.com/mod/{project['slug']}",
                                "provider": "modrinth"
                            }
                            mod_metadata_cache[project["slug"]] = meta
                            mod_metadata_cache[project["id"]] = meta
                except Exception as e:
                    print(f"Modrinth bulk error: {e}")
            
            for mid in m_ids:
                if mid in mod_metadata_cache:
                    meta = mod_metadata_cache[mid].copy()
                    meta["requested_id"] = mid
                    results.append(meta)
                else:
                    results.append({"id": mid, "name": mid, "provider": "modrinth", "unknown": True, "requested_id": mid})

        # CurseForge lookup (One by one since proxy doesn't support bulk well)
        if c_ids:
            for cid in c_ids:
                if cid in mod_metadata_cache:
                    meta = mod_metadata_cache[cid].copy()
                    meta["requested_id"] = cid
                    results.append(meta)
                    continue
                try:
                    res = await client.get(f"https://api.curse.tools/v1/cf/mods/{cid}")
                    if res.status_code == 200:
                        item = res.json()["data"]
                        meta = {
                            "id": str(item["id"]),
                            "name": item["name"],
                            "summary": item["summary"],
                            "icon_url": item.get("logo", {}).get("thumbnailUrl"),
                            "author": item.get("authors", [{}])[0].get("name", "Unknown"),
                            "downloads": int(item.get("downloadCount", 0)),
                            "url": item.get("links", {}).get("websiteUrl", ""),
                            "provider": "curseforge"
                        }
                        mod_metadata_cache[cid] = meta
                        meta_copy = meta.copy()
                        meta_copy["requested_id"] = cid
                        results.append(meta_copy)
                except:
                    results.append({"id": cid, "name": cid, "provider": "curseforge", "unknown": True, "requested_id": cid})

    return results

@app.post("/api/mods/check-compatibility")
async def check_mod_compatibility(req: Dict[str, Any]):
    """
    Check if a list of mods is compatible with a target MC version and loader.
    """
    target_mc = req.get("mc_version")
    target_loader = (req.get("loader") or "VANILLA").upper()
    m_ids = req.get("modrinth_ids", [])
    c_ids = req.get("cf_ids", [])
    
    results = {
        "compatible": [],
        "incompatible": [],
    }
    
    async with httpx.AsyncClient() as client:
        # Modrinth Compatibility Check
        for mid in m_ids:
            try:
                loaders_param = json.dumps([target_loader.lower()])
                versions_param = json.dumps([target_mc])
                url = f"https://api.modrinth.com/v2/project/{mid}/version"
                res = await client.get(url, params={"loaders": loaders_param, "game_versions": versions_param})
                
                if res.status_code == 200 and len(res.json()) > 0:
                    results["compatible"].append({"id": mid, "provider": "modrinth"})
                else:
                    results["incompatible"].append({"id": mid, "provider": "modrinth"})
            except:
                results["incompatible"].append({"id": mid, "provider": "modrinth"})

        # CurseForge Compatibility Check
        mod_loader_type = 0
        if "FORGE" in target_loader: mod_loader_type = 1
        elif "FABRIC" in target_loader: mod_loader_type = 4
        elif "QUILT" in target_loader: mod_loader_type = 5
        elif "NEOFORGE" in target_loader: mod_loader_type = 6

        for cid in c_ids:
            try:
                # Use project lookup to see latest files
                res = await client.get(f"https://api.curse.tools/v1/cf/mods/{cid}")
                if res.status_code == 200:
                    data = res.json()["data"]
                    found = False
                    for file in data.get("latestFiles", []):
                        game_versions = file.get("gameVersions", [])
                        if target_mc in game_versions:
                            # if modLoaderType filter is applied, must match
                            if mod_loader_type == 0 or mod_loader_type in file.get("modLoaderTypes", []):
                                found = True
                                break
                    if found:
                        results["compatible"].append({"id": cid, "provider": "curseforge"})
                    else:
                        results["incompatible"].append({"id": cid, "provider": "curseforge"})
                else:
                    results["incompatible"].append({"id": cid, "provider": "curseforge"})
            except:
                results["incompatible"].append({"id": cid, "provider": "curseforge"})

    return results

@app.get("/api/mods/dependencies")
async def get_mod_dependencies(provider: str, project_id: str):
    """Fetch dependencies for a mod version. Defaults to latest."""
    if provider == "modrinth":
        try:
            async with httpx.AsyncClient() as client:
                res = await client.get(f"https://api.modrinth.com/v2/project/{project_id}/version")
                if res.status_code == 200:
                    versions = res.json()
                    if versions:
                        # Modrinth returns UUIDs in project_id. We want slugs for consistency with search hits.
                        dep_ids = [d["project_id"] for d in versions[0].get("dependencies", []) if d.get("dependency_type") == "required"]
                        if not dep_ids:
                            return []
                        
                        # Bulk lookup slugs
                        res_p = await client.get(f"https://api.modrinth.com/v2/projects", params={"ids": json.dumps(dep_ids)})
                        if res_p.status_code == 200:
                            return [p["slug"] for p in res_p.json()]
                        return dep_ids # Fallback
        except Exception as e:
            print(f"Modrinth dependency error: {e}")
    elif provider == "curseforge":
        try:
            async with httpx.AsyncClient() as client:
                # CurseForge dependency lookup requires hitting the mod details
                res = await client.get(f"https://api.curse.tools/v1/cf/mods/{project_id}")
                if res.status_code == 200:
                    data = res.json()["data"]
                    # CF dependencies are objects in 'latestFiles'
                    # We use the first file for simplicity
                    latest_files = data.get("latestFiles", [])
                    if latest_files:
                        return [str(d["modId"]) for d in latest_files[0].get("dependencies", []) if d.get("relationType") == 3] # 3 = Required
        except Exception as e:
            print(f"CurseForge dependency error: {e}")
    return []

@app.get("/api/mods/conflicts")
async def get_mod_conflicts(provider: str, project_id: str, current_mods: str = ""):
    """Check for obvious loader/engine conflicts."""
    return {"conflicts": []}


@app.get("/api/files")
def list_global_files(path: str = "."):
    """List files within the SERVERS_DIR."""
    base_path = os.path.abspath(SERVERS_DIR)
    target_path = os.path.abspath(os.path.join(base_path, path))
    
    if not target_path.startswith(base_path):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not os.path.exists(target_path):
        # Gracefully handle non-existent path
        if path == ".":
            os.makedirs(base_path, exist_ok=True)
        else:
            raise HTTPException(status_code=404, detail="Path not found")
        
    items = []
    for entry in os.scandir(target_path):
        st = entry.stat()
        items.append({
            "name": entry.name,
            "is_dir": entry.is_dir(),
            "size": st.st_size,
            "modified": st.st_mtime,
            "ext": os.path.splitext(entry.name)[1].lower() if entry.is_file() else ""
        })
    
    items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
    return {"path": path, "items": items}

@app.get("/api/file/content")
def get_global_file_content(path: str):
    """Get text content of a file in SERVERS_DIR."""
    base_path = os.path.abspath(SERVERS_DIR)
    target_path = os.path.abspath(os.path.join(base_path, path))
    
    if not target_path.startswith(base_path):
        raise HTTPException(status_code=403, detail="Access denied")

    if not os.path.isfile(target_path):
        raise HTTPException(status_code=400, detail="Not a file")
        
    if os.path.getsize(target_path) > 1 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large to view (Max 1MB)")
        
    try:
        with open(target_path, 'r', encoding='utf-8', errors='replace') as f:
            return {"content": f.read()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/instances/{instance_id}/files")
def list_instance_files(instance_id: str, path: str = "."):
    """List files within an instance directory."""
    base_path = get_instance_path(instance_id)
    target_path = os.path.abspath(os.path.join(base_path, path))
    
    # Security: Ensure we don't go above base
    if not target_path.startswith(os.path.abspath(base_path)):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not os.path.exists(target_path):
        raise HTTPException(status_code=404, detail="Path not found")
        
    items = []
    for entry in os.scandir(target_path):
        st = entry.stat()
        items.append({
            "name": entry.name,
            "is_dir": entry.is_dir(),
            "size": st.st_size,
            "modified": st.st_mtime,
            "ext": os.path.splitext(entry.name)[1].lower() if entry.is_file() else ""
        })
    
    # Sort folders first, then alphabetically
    items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
    return {"path": path, "items": items}

@app.get("/api/instances/{instance_id}/file/content")
def get_file_content(instance_id: str, path: str):
    """Get text content of a file."""
    base_path = get_instance_path(instance_id)
    target_path = os.path.abspath(os.path.join(base_path, path))
    
    if not target_path.startswith(os.path.abspath(base_path)):
        raise HTTPException(status_code=403, detail="Access denied")

    if not os.path.isfile(target_path):
        raise HTTPException(status_code=400, detail="Not a file")
        
    # Check size for safety
    if os.path.getsize(target_path) > 1 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large to view (Max 1MB)")
        
    try:
        with open(target_path, 'r', encoding='utf-8', errors='replace') as f:
            return {"content": f.read()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount the compiled frontend to be served statically

# Ensure '/app/frontend/dist' exists or gracefully ignore if not fully built locally
dist_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(dist_path):
    app.mount("/", StaticFiles(directory=dist_path, html=True), name="frontend")
else:
    # Docker container path
    app.mount("/", StaticFiles(directory="/app/frontend/dist", html=True), name="frontend")

