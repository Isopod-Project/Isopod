import os
import subprocess
import shutil
import re
import httpx
import json
from pathlib import Path
import aiofiles
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import docker
import yaml
from typing import List, Optional, Dict, Any

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

class InstanceStatus(BaseModel):
    instance_id: str
    is_running: bool
    containers: list

class CreateInstanceRequest(BaseModel):
    name: str
    template: str
    port: int

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
        # Return a default empty config if docker-compose.yml is not found
        return {"image": "itzg/minecraft-server", "environment": {"EULA": "TRUE", "TYPE": "VANILLA", "VERSION": "LATEST"}}
        
    with open(compose_path, "r") as f:
        config = yaml.safe_load(f)
        
    services = config.get("services", {})
    if not services:
        return {"image": "itzg/minecraft-server", "environment": {"EULA": "TRUE", "TYPE": "VANILLA", "VERSION": "LATEST"}}
        
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
        "image": service.get("image", "itzg/minecraft-server"),
        "environment": env_vars,
    }

@app.put("/api/instances/{instance_id}/config")
def update_config(instance_id: str, new_config: InstanceConfig):
    path = get_instance_path(instance_id)
    compose_path = os.path.join(path, "docker-compose.yml")

    config = {}
    if os.path.exists(compose_path):
        with open(compose_path, "r") as f:
            config = yaml.safe_load(f)
    else:
        # Create a default docker-compose.yml if it doesn't exist
        config = {
            "version": "3.8",
            "services": {
                "mc": {
                    "image": "itzg/minecraft-server",
                    "container_name": f"isopod_{instance_id}",
                    "ports": ["25565:25565"], # Default port, will be updated by UI
                    "environment": [
                        "EULA=TRUE",
                        "TYPE=VANILLA",
                        "VERSION=LATEST"
                    ],
                    "volumes": ["./data:/data"],
                    "restart": "unless-stopped"
                }
            }
        }

    services = config.get("services", {})
    if not services:
        # If for some reason services are empty in an existing config, initialize them
        config["services"] = {
            "mc": {
                "image": "itzg/minecraft-server",
                "container_name": f"isopod_{instance_id}",
                "ports": ["25565:25565"],
                "environment": [
                    "EULA=TRUE",
                    "TYPE=VANILLA",
                    "VERSION=LATEST"
                ],
                "volumes": ["./data:/data"],
                "restart": "unless-stopped"
            }
        }
    
    first_service_name = list(services.keys())[0]
    config['services'][first_service_name]['image'] = new_config.image
    config['services'][first_service_name]['environment'] = new_config.environment
        
    with open(compose_path, "w") as f:
        yaml.dump(config, f, default_flow_style=False)
        
    return {"message": "Config updated"}

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
                    f"MOTD={req.name} Hosted by Isopod"
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


MODRINTH_API_BASE_URL = "https://api.modrinth.com/v2"

@app.get("/api/mods/modrinth/search")
async def search_modrinth_mods(
    query: str = Query(..., min_length=1),
    game_version: Optional[str] = Query(None),
    mod_loader: Optional[str] = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100)
):
    facets = [["project_type:mod"]]

    if game_version:
        facets.append([f"versions:{game_version}"])
    
    if mod_loader:
        # Modrinth lumps loaders in with categories
        facets.append([f"categories:{mod_loader.lower()}"])
    
    # Always prefer server-side mods, or optional, then client-side if no other option
    facets.append(["server_side:required", "server_side:optional"])

    params = {
        "query": query,
        "facets": json.dumps(facets),
        "offset": offset,
        "limit": limit
    }

    headers = {
        "User-Agent": "Isopod/1.0 (isopod@example.com)" # Using a descriptive User-Agent
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{MODRINTH_API_BASE_URL}/search", params=params, headers=headers)
            response.raise_for_status()
            return response.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=f"Modrinth API error: {e.response.text}")
    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"Network error communicating with Modrinth API: {e}")

@app.post("/api/instances/{instance_id}/mods/modrinth/install")
async def install_modrinth_mod(
    instance_id: str,
    mod_id: str,
    game_version: str = Query(..., min_length=1),
    mod_loader: str = Query(..., min_length=1)
):
    instance_path = get_instance_path(instance_id)
    mods_dir = Path(instance_path) / "data" / "mods"
    mods_dir.mkdir(parents=True, exist_ok=True)

    # 1. Get mod details from Modrinth
    try:
        async with httpx.AsyncClient() as client:
            # Get project details to find a suitable version
            project_response = await client.get(f"{MODRINTH_API_BASE_URL}/project/{mod_id}")
            project_response.raise_for_status()
            project_data = project_response.json()

            # Get versions for the project
            versions_response = await client.get(f"{MODRINTH_API_BASE_URL}/project/{mod_id}/version")
            versions_response.raise_for_status()
            versions_data = versions_response.json()
            
            # Find the latest compatible version
            compatible_version = None
            for version in versions_data:
                if game_version in version.get("game_versions", []) and mod_loader.lower() in version.get("loaders", []):
                    compatible_version = version
                    break
            
            if not compatible_version:
                raise HTTPException(status_code=404, detail=f"No compatible version found for mod {mod_id} with game version {game_version} and loader {mod_loader}")

            # Get the download URL for the primary file
            if not compatible_version["files"]:
                raise HTTPException(status_code=404, detail=f"No files found for compatible version of mod {mod_id}")
            
            # Prioritize server-side files if available
            download_file = None
            for file in compatible_version["files"]:
                if file.get("primary", False):
                    download_file = file
                    break
            
            if not download_file: # If no primary, just take the first one
                download_file = compatible_version["files"][0]

            download_url = download_file["url"]
            filename = download_file["filename"]

            # 2. Download the mod file
            mod_file_path = mods_dir / filename
            async with client.stream("GET", download_url, follow_redirects=True) as response:
                response.raise_for_status()
                async with aiofiles.open(mod_file_path, "wb") as f:
                    async for chunk in response.aiter_bytes():
                        await f.write(chunk)
            
            return {"message": f"Mod {filename} installed successfully to instance {instance_id}", "file_path": str(mod_file_path)}

    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=f"Modrinth API error: {e.response.text}")
    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"Network error communicating with Modrinth API: {e}")


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

# Mount the compiled frontend to be served statically

# Ensure '/app/frontend/dist' exists or gracefully ignore if not fully built locally
dist_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(dist_path):
    app.mount("/", StaticFiles(directory=dist_path, html=True), name="frontend")
else:
    # Docker container path
    app.mount("/", StaticFiles(directory="/app/frontend/dist", html=True), name="frontend")

