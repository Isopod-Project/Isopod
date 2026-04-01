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

@app.get("/api/mods/search/modrinth")
async def search_modrinth(q: Optional[str] = None, mc_version: Optional[str] = None, loader: Optional[str] = None):
    # Handle "undefined" literals from frontend
    q = None if q == "undefined" or not q else q
    mc_version = None if mc_version == "undefined" or not mc_version else mc_version
    loader = None if loader == "undefined" or not loader else loader
    
    # If query is empty, we browse via facets
    query_str = q if q else ""
        
    facets = [
        ["project_type:mod"],
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
            "url": f"https://modrinth.com/mod/{item['slug']}"
        })
    return results

@app.get("/api/mods/search/curseforge")
async def search_curseforge(q: Optional[str] = None, mc_version: Optional[str] = None, loader: Optional[str] = None):
    # Handle "undefined" literals from frontend
    q = None if q == "undefined" or not q else q
    mc_version = None if mc_version == "undefined" or not mc_version else mc_version
    loader = None if loader == "undefined" or not loader else loader
    
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
        "classId": 6, # Mods
        "excludeCategoryIds": "4764", # Client Side
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
    for item in data.get("data", []):
        results.append({
            "id": str(item["id"]),
            "name": item["name"],
            "summary": item["summary"],
            "icon_url": item.get("logo", {}).get("thumbnailUrl"),
            "author": item.get("authors", [{}])[0].get("name", "Unknown"),
            "downloads": int(item.get("downloadCount", 0)),
            "url": item.get("links", {}).get("websiteUrl", "")
        })
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
                    f"MOTD={req.name} Hosted by Isopod",
                    "ENABLE_RCON=true",
                    "RCON_PASSWORD=isopod"
                ],
                "volumes": ["./data:/data"],
                "restart": "unless-stopped"
            }
        }
    }
    
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
                    results.append(mod_metadata_cache[mid])
                else:
                    results.append({"id": mid, "name": mid, "provider": "modrinth", "unknown": True})

        # CurseForge lookup (One by one since proxy doesn't support bulk well)
        if c_ids:
            for cid in c_ids:
                if cid in mod_metadata_cache:
                    results.append(mod_metadata_cache[cid])
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
                        results.append(meta)
                except:
                    results.append({"id": cid, "name": cid, "provider": "curseforge", "unknown": True})

    return results

# Mount the compiled frontend to be served statically

# Ensure '/app/frontend/dist' exists or gracefully ignore if not fully built locally
dist_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(dist_path):
    app.mount("/", StaticFiles(directory=dist_path, html=True), name="frontend")
else:
    # Docker container path
    app.mount("/", StaticFiles(directory="/app/frontend/dist", html=True), name="frontend")

