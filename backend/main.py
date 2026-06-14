import os
import subprocess
import shutil
import re
import zipfile
import tempfile
import asyncio
from fastapi import FastAPI, HTTPException, File, UploadFile, Request, BackgroundTasks, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from dotenv import load_dotenv
import docker
import yaml
from typing import List, Optional, Dict, Any
import httpx
import json
import time
from . import resource_packs as rp

load_dotenv()

app = FastAPI(title="Isopod Backend")

ISOPOD_VERSION = "v0.0.1"
GITHUB_REPO = os.getenv("GITHUB_REPO", "Tacoz234/Isopod")

# Internal state for background update checks
cached_update_info: Optional[Dict[str, Any]] = None

class SystemInfo(BaseModel):
    version: str
    is_docker: bool

class UpdateInfo(BaseModel):
    current_version: str
    latest_version: str
    has_update: bool
    release_notes: str
    published_at: Optional[str] = None


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
    group: Optional[str] = "No group"
    icon_url: Optional[str] = None
    memory: Optional[str] = "1G"
    # World settings
    seed: Optional[str] = None
    level_type: Optional[str] = "DEFAULT"
    difficulty: Optional[str] = "easy"
    gamemode: Optional[str] = "survival"
    generate_structures: Optional[bool] = True


class RenameInstanceRequest(BaseModel):
    name: str

class DuplicateInstanceRequest(BaseModel):
    name: Optional[str] = None

class CommandRequest(BaseModel):
    command: str

class Instance(BaseModel):
    id: str
    name: str
    path: str
    has_compose: bool
    status: str
    group: str = "No group"
    icon_url: Optional[str] = None

def get_instance_path(instance_id: str) -> str:
    # Basic sanitize
    safe_id = "".join(c for c in instance_id if c.isalnum() or c in ('-', '_'))
    path = os.path.join(SERVERS_DIR, safe_id)
    if not os.path.exists(path) or not os.path.isdir(path):
        raise HTTPException(status_code=404, detail="Instance not found")
    return path

def get_instance_meta(instance_path: str) -> dict:
    meta_path = os.path.join(instance_path, "isopod-meta.json")
    if os.path.exists(meta_path):
        try:
            with open(meta_path, 'r') as f:
                return json.load(f)
        except: pass
    return {"group": "No group"}

def save_instance_meta(instance_path: str, meta: dict):
    existing = get_instance_meta(instance_path)
    existing.update(meta)
    meta_path = os.path.join(instance_path, "isopod-meta.json")
    with open(meta_path, 'w') as f:
        json.dump(existing, f, indent=2)

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
                icon_path = os.path.join(entry.path, "icon.png")
                meta = get_instance_meta(entry.path)
                instances.append(Instance(
                    id=entry.name,
                    name=entry.name.replace("-", " ").title(),
                    path=entry.path,
                    has_compose=has_compose,
                    status="Valid",
                    group=meta.get("group", "No group"),
                    icon_url=f"/api/instances/{entry.name}/icon" if os.path.exists(icon_path) else None
                ))
                
    return instances

@app.get("/api/groups")
def list_groups():
    groups = set(["No group"])
    for entry in os.scandir(SERVERS_DIR):
        if entry.is_dir():
            meta = get_instance_meta(entry.path)
            groups.add(meta.get("group", "No group"))
    return sorted(list(groups))

class SetGroupRequest(BaseModel):
    group: str

class RenameGroupRequest(BaseModel):
    new_name: str

@app.post("/api/instances/{instance_id}/group")
def set_instance_group(instance_id: str, req: SetGroupRequest):
    path = get_instance_path(instance_id)
    meta = get_instance_meta(path)
    meta["group"] = req.group
    save_instance_meta(path, meta)
    return {"id": instance_id, "group": req.group}

@app.delete("/api/groups/{group_name}")
def delete_group(group_name: str):
    """Dissolve a group, moving all instances in it to 'No group'."""
    if group_name == "No group":
        raise HTTPException(status_code=400, detail="Cannot delete default group")
    
    count = 0
    if not os.path.exists(SERVERS_DIR):
        return {"message": "Groups cleared", "count": 0}

    for entry in os.scandir(SERVERS_DIR):
        if entry.is_dir():
            meta = get_instance_meta(entry.path)
            if meta.get("group") == group_name:
                meta["group"] = "No group"
                save_instance_meta(entry.path, meta)
                count += 1
    return {"message": f"Group dissolved. {count} instances moved to 'No group'.", "count": count}

@app.post("/api/groups/{group_name}/rename")
def rename_group(group_name: str, req: RenameGroupRequest):
    """Rename a group for all instances in it."""
    if group_name == "No group":
        raise HTTPException(status_code=400, detail="Cannot rename default group")
    
    count = 0
    if not os.path.exists(SERVERS_DIR):
        return {"message": "Groups updated", "count": 0}

    for entry in os.scandir(SERVERS_DIR):
        if entry.is_dir():
            meta = get_instance_meta(entry.path)
            if meta.get("group") == group_name:
                meta["group"] = req.new_name
                save_instance_meta(entry.path, meta)
                count += 1
    return {"message": f"Group renamed. {count} instances updated.", "count": count}

@app.get("/api/instances/{instance_id}/status")
async def get_instance_status(instance_id: str):
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
                ["docker", "compose", "logs", "--tail=200", "mc"],
                cwd=get_instance_path(instance_id),
                capture_output=True, text=True, timeout=5
            )
            # Log heartbeats: Done (2.345s)! or Done!
            if "Done (" in log_result.stdout or "Done!" in log_result.stdout:
                is_ready = True
        except: pass

    # Get metadata like version and last active
    version = "Unknown"
    port = 25565
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
               
               # Extract port
               ports = mc_config.get("ports", [])
               if ports:
                   p_str = ports[0].split(":")[0]
                   port = int(p_str)
        
        # Last online from docker-compose.yml mod date
        last_online = os.path.getmtime(compose_path)
    except: pass

    public_ip = await get_public_ip()

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
        "port": port,
        "public_ip": public_ip,
        "last_online": last_online,
        "containers": container_info
    }

@app.post("/api/instances/{instance_id}/start")
async def start_instance(instance_id: str):
    path = get_instance_path(instance_id)
    compose_path = os.path.join(path, "docker-compose.yml")
    
    with open(compose_path, "r") as f:
        config = yaml.safe_load(f)
    
    services = config.get("services", {})
    if not services:
        raise HTTPException(status_code=400, detail="No services found in compose file")
        
    first_service = list(services.keys())[0]
    raw_env = services[first_service].get("environment", {})
    
    # Standardize to dict for easier manipulation
    if isinstance(raw_env, list):
        env = {}
        for item in raw_env:
            if '=' in item:
                k, v = item.split('=', 1)
                env[k] = v
    else:
        env = dict(raw_env)
        
    # Ensure EULA is accepted
    changed = False
    if env.get("EULA") != "TRUE":
        env["EULA"] = "TRUE"
        changed = True
    
    if changed:
        # Save back in the format it was
        if isinstance(raw_env, list):
            services[first_service]["environment"] = [f"{k}={v}" for k, v in env.items()]
        else:
            services[first_service]["environment"] = env
            
        with open(compose_path, "w") as f:
            yaml.dump(config, f, default_flow_style=False)

    mc_version = env.get("VERSION", "1.20.4")
    
    # Resource Pack Bundling Logic
    m_ids_str = env.get("RESOURCE_PACKS_MODRINTH", "")
    c_ids_str = env.get("RESOURCE_PACKS_CF", "")
    pack_list_key = f"{m_ids_str}|{c_ids_str}|{mc_version}"
    
    if m_ids_str or c_ids_str:
        cache_dir = os.path.join(SERVERS_DIR, ".cache", "resource_packs")
        os.makedirs(cache_dir, exist_ok=True)
        hash_file = os.path.join(cache_dir, f"{instance_id}_key.txt")
        
        # Check cache
        last_key = ""
        if os.path.exists(hash_file):
            with open(hash_file, "r") as f: last_key = f.read().strip()
            
        if pack_list_key != last_key:
            print(f"--- Bundling Needed for {instance_id} ---")
            m_ids = [i.strip() for i in m_ids_str.split(",") if i.strip()]
            c_ids = [i.strip() for i in c_ids_str.split(",") if i.strip()]
            
            try:
                async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
                    downloaded_zips = []
                    for mid in m_ids:
                        url = await rp.get_latest_version_url(client, "modrinth", mid, mc_version)
                        if url:
                            z_path = os.path.join(cache_dir, f"{mid}.zip")
                            if await rp.download_file(client, url, z_path):
                                downloaded_zips.append(z_path)

                    for cid in c_ids:
                        url = await rp.get_latest_version_url(client, "curseforge", cid, mc_version)
                        if url:
                            z_path = os.path.join(cache_dir, f"{cid}.zip")
                            if await rp.download_file(client, url, z_path):
                                downloaded_zips.append(z_path)

                    if downloaded_zips:
                        bundle_path = os.path.join(cache_dir, f"bundle_{instance_id}.zip")
                        rp.merge_resource_packs(downloaded_zips, bundle_path)
                        public_url, sha1 = await rp.upload_to_mcpacks(bundle_path)
                        if public_url and sha1:
                            env["RESOURCE_PACK"] = public_url
                            env["RESOURCE_PACK_SHA1"] = sha1
                            env["RESOURCE_PACK_ID"] = "" # Clear legacy
                            # Save back to compose so it persists
                            config['services'][first_service]['environment'] = env
                            with open(compose_path, "w") as f:
                                yaml.dump(config, f, default_flow_style=False)
                            # Update cache key
                            with open(hash_file, "w") as f: f.write(pack_list_key)
            except Exception as e:
                print(f"Bundling failed during start: {e}")

    # Start all services
    result = subprocess.run(["docker", "compose", "up", "-d"], cwd=path, capture_output=True, text=True)
    if result.returncode != 0:
        raise HTTPException(status_code=400, detail=f"Docker Compose failed: {result.stderr}")
    return {"message": "Started"}

@app.post("/api/instances/{instance_id}/stop")
def stop_instance(instance_id: str):
    path = get_instance_path(instance_id)
    # Use 'down' instead of 'stop' to remove the container, which clears Docker logs
    result = subprocess.run(["docker", "compose", "down"], cwd=path, capture_output=True, text=True)
    if result.returncode != 0:
        raise HTTPException(status_code=400, detail=f"Docker Compose failed: {result.stderr}")
    return {"message": "Stopped"}

@app.post("/api/instances/{instance_id}/kill")
def kill_instance(instance_id: str):
    path = get_instance_path(instance_id)
    result = subprocess.run(["docker", "compose", "kill"], cwd=path, capture_output=True, text=True)
    if result.returncode != 0:
        raise HTTPException(status_code=400, detail=f"Docker Compose failed: {result.stderr}")
    return {"message": "Killed"}

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
    
    return {
        "image": service.get("image", ""),
        "environment": service.get("environment", {}),
    }

@app.put("/api/instances/{instance_id}/config")
async def update_config(instance_id: str, new_config: InstanceConfig):
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
        # Ensure EULA is preserved/added
        env = new_config.environment
        env["EULA"] = "TRUE"
        config['services'][first_service_name]['environment'] = env
        
    with open(compose_path, "w") as f:
        yaml.dump(config, f, default_flow_style=False)
        
    return {"message": "Config updated"}

class WhitelistUser(BaseModel):
    name: str
    uuid: Optional[str] = None
    level: int = 0
    is_op: bool = False
    whitelisted: bool = True

@app.get("/api/instances/{instance_id}/users")
def get_instance_users(instance_id: str):
    path = get_instance_path(instance_id)
    
    # Paths for files
    data_dir = os.path.join(path, "data")
    os.makedirs(data_dir, exist_ok=True)
    whitelist_path = os.path.join(data_dir, "whitelist.json")
    ops_path = os.path.join(data_dir, "ops.json")
    
    users = {}
    
    # 1. Check ops.json
    if os.path.exists(ops_path):
        try:
            with open(ops_path, "r") as f:
                ops_data = json.load(f)
                if isinstance(ops_data, list):
                    for entry in ops_data:
                        if isinstance(entry, dict) and "name" in entry:
                            name = entry["name"]
                            uuid = entry.get("uuid")
                            level = entry.get("level", 4)
                            users[name.lower()] = {
                                "name": name,
                                "uuid": uuid,
                                "level": level,
                                "is_op": True,
                                "whitelisted": False # Default to false, check whitelist.json next
                            }
        except Exception as e:
            print(f"Error reading ops.json: {e}")
            
    # 2. Check whitelist.json
    if os.path.exists(whitelist_path):
        try:
            with open(whitelist_path, "r") as f:
                wl_data = json.load(f)
                if isinstance(wl_data, list):
                    for entry in wl_data:
                        if isinstance(entry, dict) and "name" in entry:
                            name = entry["name"]
                            uuid = entry.get("uuid")
                            key = name.lower()
                            if key in users:
                                users[key]["whitelisted"] = True
                                if uuid and not users[key]["uuid"]:
                                    users[key]["uuid"] = uuid
                            else:
                                users[key] = {
                                    "name": name,
                                    "uuid": uuid,
                                    "level": 0,
                                    "is_op": False,
                                    "whitelisted": True
                                }
        except Exception as e:
            print(f"Error reading whitelist.json: {e}")
            
    # 3. If both files don't exist or are empty, fallback to environment in docker-compose.yml
    if not users:
        compose_path = os.path.join(path, "docker-compose.yml")
        if os.path.exists(compose_path):
            try:
                with open(compose_path, "r") as f:
                    config = yaml.safe_load(f)
                services = config.get("services", {})
                if services:
                    first_service_name = list(services.keys())[0]
                    service = services[first_service_name]
                    env = service.get("environment", {})
                    
                    # Convert list to dict if needed
                    env_dict = {}
                    if isinstance(env, list):
                        for item in env:
                            if "=" in item:
                                k, v = item.split("=", 1)
                                env_dict[k] = v
                    elif isinstance(env, dict):
                        env_dict = env
                        
                    whitelist_str = env_dict.get("WHITELIST", "")
                    ops_str = env_dict.get("OPS", "")
                    
                    wl_names = [n.strip() for n in whitelist_str.split(",") if n.strip()]
                    op_names = [n.strip() for n in ops_str.split(",") if n.strip()]
                    
                    for name in wl_names:
                        users[name.lower()] = {
                            "name": name,
                            "uuid": None,
                            "level": 0,
                            "is_op": False,
                            "whitelisted": True
                        }
                    for name in op_names:
                        key = name.lower()
                        if key in users:
                            users[key]["is_op"] = True
                            users[key]["level"] = 4
                        else:
                            users[key] = {
                                "name": name,
                                "uuid": None,
                                "level": 4,
                                "is_op": True,
                                "whitelisted": False
                            }
            except Exception as e:
                print(f"Error reading fallback environment from docker-compose.yml: {e}")
                
    # Return as list
    return list(users.values())

@app.put("/api/instances/{instance_id}/users")
def update_instance_users(instance_id: str, users: List[WhitelistUser]):
    path = get_instance_path(instance_id)
    
    data_dir = os.path.join(path, "data")
    os.makedirs(data_dir, exist_ok=True)
    whitelist_path = os.path.join(data_dir, "whitelist.json")
    ops_path = os.path.join(data_dir, "ops.json")
    
    whitelist_data = []
    ops_data = []
    
    whitelist_names = []
    ops_names = []
    
    for u in users:
        name = u.name
        uuid = u.uuid
        level = u.level
        is_op = u.is_op
        whitelisted = u.whitelisted
        
        if not name:
            continue
            
        if whitelisted:
            whitelist_data.append({
                "uuid": uuid or "",
                "name": name
            })
            whitelist_names.append(name)
            
        if is_op or level > 0:
            ops_data.append({
                "uuid": uuid or "",
                "name": name,
                "level": level if level > 0 else 4,
                "bypassesPlayerLimit": False
            })
            ops_names.append(name)
            
    # Write files
    try:
        with open(whitelist_path, "w") as f:
            json.dump(whitelist_data, f, indent=2)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write whitelist.json: {str(e)}")
        
    try:
        with open(ops_path, "w") as f:
            json.dump(ops_data, f, indent=2)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write ops.json: {str(e)}")
        
    # Also update environment in docker-compose.yml to keep it in sync
    compose_path = os.path.join(path, "docker-compose.yml")
    if os.path.exists(compose_path):
        try:
            with open(compose_path, "r") as f:
                config = yaml.safe_load(f)
            services = config.get("services", {})
            if services:
                first_service_name = list(services.keys())[0]
                service = services[first_service_name]
                env = service.get("environment", {})
                
                wl_str = ",".join(whitelist_names)
                ops_str = ",".join(ops_names)
                
                if isinstance(env, list):
                    new_env = []
                    found_wl = False
                    found_ops = False
                    for item in env:
                        if item.startswith("WHITELIST="):
                            new_env.append(f"WHITELIST={wl_str}")
                            found_wl = True
                        elif item.startswith("OPS="):
                            new_env.append(f"OPS={ops_str}")
                            found_ops = True
                        else:
                            new_env.append(item)
                    if not found_wl:
                        new_env.append(f"WHITELIST={wl_str}")
                    if not found_ops:
                        new_env.append(f"OPS={ops_str}")
                    service["environment"] = new_env
                elif isinstance(env, dict):
                    env["WHITELIST"] = wl_str
                    env["OPS"] = ops_str
                    service["environment"] = env
                    
            with open(compose_path, "w") as f:
                yaml.dump(config, f, default_flow_style=False)
        except Exception as e:
            print(f"Error syncing environment variables to docker-compose.yml: {e}")
            
    # If container is running, execute command to reload whitelist
    is_running = False
    if docker_client:
        try:
            c_name = f"isopod_{instance_id}"
            c = docker_client.containers.get(c_name)
            is_running = c.status == "running"
        except: pass
        
    if is_running:
        cmd = ["docker", "compose", "exec", "-T", "mc", "rcon-cli", "whitelist reload"]
        try:
            subprocess.run(cmd, cwd=path, capture_output=True, text=True, timeout=5)
        except Exception as e:
            print(f"RCON whitelist reload failed: {e}")
            
    return {"message": "Users updated successfully"}

@app.post("/api/instances/{instance_id}/icon")
async def upload_icon(instance_id: str, file: UploadFile = File(...)):
    """Upload an icon for the instance. Saves for Isopod UI and server-icon.png for Minecraft."""
    path = get_instance_path(instance_id)
    
    try:
        from PIL import Image
        import io
        
        # Read the file content
        content = await file.read()
        
        # Open the image and resize to 64x64 PNG
        img = Image.open(io.BytesIO(content))
        img = img.convert("RGBA")
        img = img.resize((64, 64), Image.Resampling.LANCZOS)
        
        # Save as icon.png in root (for Isopod)
        icon_path = os.path.join(path, "icon.png")
        img.save(icon_path, "PNG")
        
        # Save as server-icon.png in data/ (for Minecraft)
        data_dir = os.path.join(path, "data")
        os.makedirs(data_dir, exist_ok=True)
        mc_icon_path = os.path.join(data_dir, "server-icon.png")
        img.save(mc_icon_path, "PNG")
            
    except Exception as e:
        print(f"Error processing uploaded icon: {e}")
        # Fallback to copy file without resizing if PIL fails
        file.file.seek(0)
        icon_path = os.path.join(path, "icon.png")
        with open(icon_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        data_dir = os.path.join(path, "data")
        os.makedirs(data_dir, exist_ok=True)
        file.file.seek(0)
        mc_icon_path = os.path.join(data_dir, "server-icon.png")
        with open(mc_icon_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
                
    return {"message": "Icon updated", "icon_url": f"/api/instances/{instance_id}/icon"}

@app.get("/api/instances/{instance_id}/icon")
def get_icon(instance_id: str):
    """Get the instance icon."""
    path = get_instance_path(instance_id)
    icon_path = os.path.join(path, "icon.png")
    if os.path.exists(icon_path):
        return FileResponse(icon_path)
    raise HTTPException(status_code=404, detail="Icon not found")

@app.get("/api/settings")
def get_settings():
    settings_path = os.path.join(SERVERS_DIR, "isopod_settings.json")
    if os.path.exists(settings_path):
        with open(settings_path, "r") as f:
            return json.load(f)
    return {
        "language": "English",
        "theme": "Dark",
        "defaultPort": "25565",
        "defaultLoader": "VANILLA",
        "defaultMemory": "1G",
        "autoRefresh": True,
        "showSnapshots": False,
        "defaultWhitelistEnabled": False,
        "defaultWhitelistUsers": []
    }

@app.put("/api/settings")
def update_settings(new_settings: Dict[str, Any]):
    settings_path = os.path.join(SERVERS_DIR, "isopod_settings.json")
    os.makedirs(SERVERS_DIR, exist_ok=True)
    with open(settings_path, "w") as f:
        json.dump(new_settings, f, indent=4)
    return {"message": "Settings updated"}

# Meta & Mod Proxy Endpoints
VERSION_MANIFEST_URL = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json"
cached_versions = {"time": 0, "data": None}
# Cache for mod metadata to avoid hitting APIs too hard
mod_metadata_cache = {} 
cached_public_ip = {"time": 0, "ip": None}

async def get_public_ip():
    global cached_public_ip
    now = time.time()
    if cached_public_ip["ip"] and (now - cached_public_ip["time"] < 3600):
        return cached_public_ip["ip"]
    
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get("https://api64.ipify.org?format=json")
            data = res.json()
            cached_public_ip = {"time": now, "ip": data["ip"]}
            return data["ip"]
    except Exception as e:
        print(f"Error fetching public IP: {e}")
        return "127.0.0.1" # Fallback

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
    ]
    if class_type == "mod":
        facets.append(["server_side:required", "server_side:optional"])
    if mc_version:
        facets.append([f"versions:{mc_version}"])
    if loader:
        facets.append([f"categories:{loader.lower()}"])
        
    url = "https://api.modrinth.com/v2/search"
    params = {
        "query": q,
        "facets": json.dumps(facets),
        "limit": 120
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
    
    # Using '6' for mods, '4471' for modpacks, '12' for resource packs
    class_id = 6
    if class_type == "modpack":
        class_id = 4471
    elif class_type == "resourcepack":
        class_id = 12
    
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
        "pageSize": 120
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
                    f"MEMORY={req.memory or '1G'}",
                    f"MOTD={req.name} Hosted by Isopod",
                    "ENABLE_RCON=true",
                    "RCON_PASSWORD=isopod",
                    f"SEED={req.seed or ''}",
                    f"LEVEL_TYPE={req.level_type or 'DEFAULT'}",
                    f"DIFFICULTY={req.difficulty or 'easy'}",
                    f"MODE={req.gamemode or 'survival'}",
                    f"GENERATE_STRUCTURES={'true' if req.generate_structures else 'false'}",
                    "JVM_OPTS=--add-opens java.base/sun.misc=ALL-UNNAMED"
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
    
    # Save metadata
    save_instance_meta(path, {"group": req.group or "No group"})

    # Download Icon if provided
    if req.icon_url:
        try:
            from PIL import Image
            import io
            print(f"DEBUG: Attempting to download icon from {req.icon_url}")
            # Use headers to avoid being blocked by CDNs
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"}
            res = httpx.get(req.icon_url, headers=headers, timeout=15.0, follow_redirects=True)
            if res.status_code == 200:
                print(f"DEBUG: Got response: {len(res.content)} bytes, Content-Type: {res.headers.get('Content-Type')}")
                img = Image.open(io.BytesIO(res.content))
                img = img.convert("RGBA")
                img = img.resize((64, 64), Image.Resampling.LANCZOS)
                icon_save_path = os.path.join(path, "icon.png")
                img.save(icon_save_path, "PNG")
                print(f"DEBUG: Saved icon to {icon_save_path}")
                
                # Save to data/server-icon.png for Minecraft
                data_dir = os.path.join(path, "data")
                os.makedirs(data_dir, exist_ok=True)
                mc_icon_path = os.path.join(data_dir, "server-icon.png")
                img.save(mc_icon_path, "PNG")
                print(f"DEBUG: Saved server icon to {mc_icon_path}")
            else:
                print(f"DEBUG: Icon download failed with status {res.status_code}")
        except Exception as e:
            print(f"DEBUG: Failed to set instance icon: {e}")
            import traceback
            traceback.print_exc()
        
    return {"id": slug, "message": "Instance created"}

@app.delete("/api/instances/{instance_id}")
def delete_instance(instance_id: str):
    path = get_instance_path(instance_id)
    # Safely stop and remove containers and volumes before purging
    # Use --volumes to ensure bind mounts or volumes are handled, --remove-orphans for completeness
    subprocess.run(["docker", "compose", "down", "-v", "--remove-orphans", "--timeout", "5"], cwd=path, capture_output=True)
    
    # Direct fallback: Try to remove by name in case compose lost track
    if docker_client:
        try:
            # The naming convention is isopod_{slug} 
            # Note: rename_instance also updates this, but instance_id is always the current slug.
            c_name = f"isopod_{instance_id}"
            try:
                c = docker_client.containers.get(c_name)
                c.remove(force=True)
            except: pass
        except: pass

    # Try to remove the directory. On Windows, Docker might be slow to release file locks
    # even after 'down', so we retry a few times.
    for i in range(5):
        try:
            if os.path.exists(path):
                shutil.rmtree(path)
            break
        except Exception as e:
            if i == 4:
                print(f"Failed to delete {path} after multiple attempts: {e}")
                shutil.rmtree(path, ignore_errors=True)
            else:
                time.sleep(0.5)
                
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

@app.post("/api/instances/{instance_id}/duplicate")
def duplicate_instance(instance_id: str, req: DuplicateInstanceRequest):
    old_path = get_instance_path(instance_id)
    
    # Use provided name or default to "Copy of <original>"
    original_display_name = instance_id.replace('-', ' ').title()
    new_display_name = req.name or f"Copy of {original_display_name}"
    
    new_slug = generate_slug(new_display_name)
    base_slug = new_slug
    counter = 1
    while os.path.exists(os.path.join(SERVERS_DIR, new_slug)):
        new_slug = f"{base_slug}-{counter}"
        counter += 1
        
    new_path = os.path.join(SERVERS_DIR, new_slug)
    
    # Clone the entire directory
    try:
        shutil.copytree(old_path, new_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to copy directory: {str(e)}")
        
    # Update docker-compose.yml to avoid conflicts
    compose_path = os.path.join(new_path, "docker-compose.yml")
    if os.path.exists(compose_path):
        try:
            with open(compose_path, "r") as f:
                config = yaml.safe_load(f)
            
            services = config.get("services", {})
            if services:
                # Find all currently used host ports to pick a new one
                used_ports = set()
                for entry in os.scandir(SERVERS_DIR):
                    if entry.is_dir() and entry.name != new_slug:
                        try:
                            other_compose = os.path.join(entry.path, "docker-compose.yml")
                            if os.path.exists(other_compose):
                                with open(other_compose, 'r') as of:
                                    odata = yaml.safe_load(of)
                                    for _, oservice in odata.get("services", {}).items():
                                        for p in oservice.get("ports", []):
                                            used_ports.add(int(str(p).split(':')[0]))
                        except: pass

                # Pick the first service for container rename
                service_name = "mc" if "mc" in services else list(services.keys())[0]
                service = services[service_name]
                service["container_name"] = f"isopod_{new_slug}"
                
                # Update ports
                if "ports" in service:
                    try:
                        p = service["ports"][0] or "25565:25565"
                        current_port = int(str(p).split(':')[0])
                        new_port = current_port
                        # Try to find a new free port
                        while new_port in used_ports or new_port < 1024:
                            new_port += 1
                        service["ports"] = [f"{new_port}:25565"]
                    except: pass
                
                # Update MOTD in environment
                env = service.get("environment", [])
                if isinstance(env, list):
                    for i, item in enumerate(env):
                        if item.startswith("MOTD="):
                            env[i] = f"MOTD={new_display_name} Hosted by Isopod"
                            break
                elif isinstance(env, dict):
                    if "MOTD" in env:
                        env["MOTD"] = f"{new_display_name} Hosted by Isopod"
            
            with open(compose_path, "w") as f:
                yaml.dump(config, f, default_flow_style=False)
        except Exception as e:
            print(f"Error updating compose after duplication: {e}")
            
    return {"id": new_slug, "message": "Instance duplicated"}

@app.get("/api/instances/{instance_id}/export")
def export_instance(
    instance_id: str,
    world: bool = True,
    mods: bool = True,
    configs: bool = True,
    plugins: bool = True,
    logs: bool = True
):
    path = get_instance_path(instance_id)
    
    # Create a temporary zip file
    tmp_dir = tempfile.gettempdir()
    zip_filename = f"{instance_id}.zip"
    zip_path = os.path.join(tmp_dir, zip_filename)
    
    try:
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(path):
                for file in files:
                    file_path = os.path.join(root, file)
                    rel_path = os.path.relpath(file_path, path)
                    
                    # Classification logic
                    parts = rel_path.split(os.sep)
                    include = False
                    
                    if len(parts) == 1:
                        # Root files like docker-compose.yml, icon.png, metadata.json
                        if configs:
                            include = True
                    elif parts[0] == "data":
                        if len(parts) == 2:
                            # Files directly under data/, e.g. server.properties, ops.json
                            if configs:
                                include = True
                        else:
                            # Subfolders inside data/
                            subfolder = parts[1]
                            if subfolder.startswith("world"):
                                if world:
                                    include = True
                            elif subfolder == "mods":
                                if mods:
                                    include = True
                            elif subfolder == "config":
                                if configs:
                                    include = True
                            elif subfolder == "plugins":
                                if plugins:
                                    include = True
                            elif subfolder == "logs":
                                if logs:
                                    include = True
                            else:
                                # Other custom directories (e.g. mod-specific storage)
                                if configs:
                                    include = True
                    else:
                        # Other root folders
                        if configs:
                            include = True
                            
                    if include:
                        zipf.write(file_path, rel_path)
        
        return FileResponse(
            zip_path, 
            media_type='application/zip', 
            filename=zip_filename
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/instances/import")
async def import_instance(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    port: Optional[int] = Form(None),
    difficulty: Optional[str] = Form(None),
    gamemode: Optional[str] = Form(None),
    seed: Optional[str] = Form(None),
    level_type: Optional[str] = Form(None),
    generate_structures: Optional[bool] = Form(None),
    memory: Optional[str] = Form(None)
):
    if not file.filename.endswith('.zip'):
        raise HTTPException(status_code=400, detail="Only .zip files are supported")
        
    # Generate a unique slug for the new instance
    base_name = name if name else file.filename.rsplit('.', 1)[0]
    new_slug = generate_slug(base_name)
    
    # Avoid collisions
    base_slug = new_slug
    counter = 1
    while os.path.exists(os.path.join(SERVERS_DIR, new_slug)):
        new_slug = f"{base_slug}-{counter}"
        counter += 1
        
    target_path = os.path.join(SERVERS_DIR, new_slug)
    os.makedirs(target_path, exist_ok=True)
    
    # Save the file temporarily
    with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name
        
    try:
        is_server_export = False
        is_single_player_world = False
        level_dat_path = None
        compose_file_path = None
        
        with zipfile.ZipFile(tmp_path, 'r') as zipf:
            names = zipf.namelist()
            for name in names:
                if name.endswith('docker-compose.yml') or name.endswith('docker-compose.yaml'):
                    is_server_export = True
                    compose_file_path = name
                    break
            
            if not is_server_export:
                for name in names:
                    if name.lower().endswith('level.dat'):
                        is_single_player_world = True
                        level_dat_path = name
                        break
                        
        if not is_server_export and not is_single_player_world:
            raise HTTPException(
                status_code=400, 
                detail="Invalid zip structure. Must contain a docker-compose.yml (for server exports) or level.dat (for single-player worlds)."
            )
            
        if is_server_export:
            prefix = os.path.dirname(compose_file_path)
            
            with zipfile.ZipFile(tmp_path, 'r') as zipf:
                for member in zipf.infolist():
                    filename = member.filename
                    filename_normalized = filename.replace('\\', '/')
                    prefix_normalized = prefix.replace('\\', '/')
                    
                    if prefix_normalized:
                        if filename_normalized.startswith(prefix_normalized + "/"):
                            rel_path = os.path.relpath(filename_normalized, prefix_normalized)
                            if rel_path == "." or rel_path == "..":
                                continue
                            target_file = os.path.join(target_path, rel_path)
                            if member.is_dir():
                                os.makedirs(target_file, exist_ok=True)
                            else:
                                os.makedirs(os.path.dirname(target_file), exist_ok=True)
                                with zipf.open(member) as source, open(target_file, "wb") as target:
                                    shutil.copyfileobj(source, target)
                    else:
                        target_file = os.path.join(target_path, filename_normalized)
                        if member.is_dir():
                            os.makedirs(target_file, exist_ok=True)
                        else:
                            os.makedirs(os.path.dirname(target_file), exist_ok=True)
                            with zipf.open(member) as source, open(target_file, "wb") as target:
                                shutil.copyfileobj(source, target)
                                
            # Update docker-compose.yml to match the new slug and avoid port conflict
            compose_path = os.path.join(target_path, "docker-compose.yml")
            if os.path.exists(compose_path):
                try:
                    with open(compose_path, "r") as f:
                        config = yaml.safe_load(f)
                    
                    services = config.get("services", {})
                    if services:
                        # Find used ports
                        used_ports = set()
                        for entry in os.scandir(SERVERS_DIR):
                            if entry.is_dir() and entry.name != new_slug:
                                try:
                                    other_compose = os.path.join(entry.path, "docker-compose.yml")
                                    if os.path.exists(other_compose):
                                        with open(other_compose, 'r') as of:
                                            odata = yaml.safe_load(of)
                                            for _, oservice in odata.get("services", {}).items():
                                                for p in oservice.get("ports", []):
                                                    used_ports.add(int(str(p).split(':')[0]))
                                except: pass
    
                        service_name = "mc" if "mc" in services else list(services.keys())[0]
                        service = services[service_name]
                        service["container_name"] = f"isopod_{new_slug}"
                        
                        if "ports" in service:
                            try:
                                p = service["ports"][0] or "25565:25565"
                                current_port = int(str(p).split(':')[0])
                                new_port = port if port else current_port
                                while new_port in used_ports or new_port < 1024:
                                    new_port += 1
                                service["ports"] = [f"{new_port}:25565"]
                            except: pass

                        # Update other properties if provided
                        env = service.get("environment", [])
                        if isinstance(env, list):
                            def set_env_list(key, val):
                                for i, item in enumerate(env):
                                    if item.startswith(f"{key}="):
                                        env[i] = f"{key}={val}"
                                        return
                                env.append(f"{key}={val}")

                            if difficulty: set_env_list("DIFFICULTY", difficulty)
                            if gamemode: set_env_list("MODE", gamemode)
                            if seed: set_env_list("SEED", seed)
                            if level_type: set_env_list("LEVEL_TYPE", level_type)
                            if generate_structures is not None: set_env_list("GENERATE_STRUCTURES", "true" if generate_structures else "false")
                            if memory: set_env_list("MEMORY", memory)
                        elif isinstance(env, dict):
                            if difficulty: env["DIFFICULTY"] = difficulty
                            if gamemode: env["MODE"] = gamemode
                            if seed: env["SEED"] = seed
                            if level_type: env["LEVEL_TYPE"] = level_type
                            if generate_structures is not None: env["GENERATE_STRUCTURES"] = "true" if generate_structures else "false"
                            if memory: env["MEMORY"] = memory
                    
                    with open(compose_path, "w") as f:
                        yaml.dump(config, f, default_flow_style=False)
                except Exception as e:
                    print(f"Error updating compose after import: {e}")
        else:
            # Extract single player world contents to target_path/data/world
            prefix = os.path.dirname(level_dat_path)
            
            with zipfile.ZipFile(tmp_path, 'r') as zipf:
                world_dir = os.path.join(target_path, "data", "world")
                os.makedirs(world_dir, exist_ok=True)
                for member in zipf.infolist():
                    filename = member.filename
                    filename_normalized = filename.replace('\\', '/')
                    prefix_normalized = prefix.replace('\\', '/')
                    
                    if prefix_normalized:
                        if filename_normalized.startswith(prefix_normalized + "/"):
                            rel_path = os.path.relpath(filename_normalized, prefix_normalized)
                            if rel_path == "." or rel_path == "..":
                                continue
                            target_file = os.path.join(world_dir, rel_path)
                            if member.is_dir():
                                os.makedirs(target_file, exist_ok=True)
                            else:
                                os.makedirs(os.path.dirname(target_file), exist_ok=True)
                                with zipf.open(member) as source, open(target_file, "wb") as target:
                                    shutil.copyfileobj(source, target)
                    else:
                        target_file = os.path.join(world_dir, filename_normalized)
                        if member.is_dir():
                            os.makedirs(target_file, exist_ok=True)
                        else:
                            os.makedirs(os.path.dirname(target_file), exist_ok=True)
                            with zipf.open(member) as source, open(target_file, "wb") as target:
                                shutil.copyfileobj(source, target)
                                
            # Generate the default docker-compose.yml for this single player world
            used_ports = set()
            for entry in os.scandir(SERVERS_DIR):
                if entry.is_dir() and entry.name != new_slug:
                    try:
                        other_compose = os.path.join(entry.path, "docker-compose.yml")
                        if os.path.exists(other_compose):
                            with open(other_compose, 'r') as of:
                                odata = yaml.safe_load(of)
                                for _, oservice in odata.get("services", {}).items():
                                    for p in oservice.get("ports", []):
                                        used_ports.add(int(str(p).split(':')[0]))
                    except: pass
            
            new_port = port if port else 25565
            while new_port in used_ports or new_port < 1024:
                new_port += 1
                
            compose_content = {
                "services": {
                    "mc": {
                        "image": "itzg/minecraft-server",
                        "container_name": f"isopod_{new_slug}",
                        "ports": [f"{new_port}:25565"],
                        "environment": [
                            "EULA=TRUE",
                            "TYPE=VANILLA",
                            "VERSION=latest",
                            f"MEMORY={memory or '2G'}",
                            f"MOTD={base_name} Hosted by Isopod",
                            "ENABLE_RCON=true",
                            "RCON_PASSWORD=isopod",
                            f"SEED={seed or ''}",
                            f"LEVEL_TYPE={level_type or 'DEFAULT'}",
                            f"DIFFICULTY={difficulty or 'easy'}",
                            f"MODE={gamemode or 'survival'}",
                            f"GENERATE_STRUCTURES={'true' if generate_structures else 'false'}",
                            "JVM_OPTS=--add-opens java.base/sun.misc=ALL-UNNAMED"
                        ],
                        "volumes": ["./data:/data"],
                        "restart": "unless-stopped"
                    }
                }
            }
            with open(os.path.join(target_path, "docker-compose.yml"), "w") as f:
                yaml.dump(compose_content, f, default_flow_style=False)
                
            save_instance_meta(target_path, {"group": "No group"})
            
        return {"id": new_slug, "message": "Instance imported successfully"}
    except Exception as e:
        shutil.rmtree(target_path, ignore_errors=True)
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Extraction failed: {str(e)}")
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

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
                                "author": "-", 
                                "downloads": project.get("downloads", 0),
                                "url": f"https://modrinth.com/mod/{project['slug']}",
                                "provider": "modrinth",
                                "mc_versions": project.get("game_versions", [])[:3],
                                "latest_version": project.get("latest_version", "Unknown")
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

        # CurseForge lookup
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
                        latest_file = item.get("latestFiles", [{}])[0]
                        meta = {
                            "id": str(item["id"]),
                            "name": item["name"],
                            "summary": item["summary"],
                            "icon_url": item.get("logo", {}).get("thumbnailUrl"),
                            "author": item.get("authors", [{}])[0].get("name", "Unknown"),
                            "downloads": int(item.get("downloadCount", 0)),
                            "url": item.get("links", {}).get("websiteUrl", ""),
                            "provider": "curseforge",
                            "mc_versions": latest_file.get("gameVersions", [])[:3],
                            "latest_version": latest_file.get("displayName", "Unknown")
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

@app.get("/api/system/info", response_model=SystemInfo)
def get_system_info():
    return {
        "version": ISOPOD_VERSION,
        "is_docker": os.path.exists("/.dockerenv")
    }

async def get_latest_release():
    """Fetches the latest release info from GitHub API."""
    try:
        async with httpx.AsyncClient() as client:
            headers = {"Accept": "application/vnd.github.v3+json"}
            res = await client.get(f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest", headers=headers, timeout=10)
            
            if res.status_code == 200:
                data = res.json()
                latest_v = data.get("tag_name", "Unknown")
                return {
                    "current_version": ISOPOD_VERSION,
                    "latest_version": latest_v,
                    "has_update": latest_v != ISOPOD_VERSION,
                    "release_notes": data.get("body", "No release notes available."),
                    "published_at": data.get("published_at")
                }
            return None
    except Exception as e:
        print(f"Error fetching release: {e}")
        return None

async def update_check_loop():
    """Background task to check for updates every 12 hours."""
    global cached_update_info
    while True:
        info = await get_latest_release()
        if info:
            cached_update_info = info
        # Sleep for 12 hours
        await asyncio.sleep(12 * 3600)

@app.on_event("startup")
async def startup_event():
    # Start the periodic update check in the background
    asyncio.create_task(update_check_loop())

@app.get("/api/system/check-updates", response_model=UpdateInfo)
async def check_updates(force: bool = False):
    """
    Returns update information. Uses cached data unless 'force' is True 
    or no cache exists yet.
    """
    global cached_update_info
    if force or not cached_update_info:
        info = await get_latest_release()
        if info:
            cached_update_info = info
            return info
        else:
             # Fallback if GitHub is down but we want to return something valid
             return {
                "current_version": ISOPOD_VERSION,
                "latest_version": ISOPOD_VERSION,
                "has_update": False,
                "release_notes": "Could not connect to the update server."
             }
    
    return cached_update_info

@app.post("/api/system/update")
async def perform_update():
    """
    Attempts to update the launcher by pulling the latest code/images 
    and restarting the container via the mounted Docker socket.
    """
    if not os.path.exists("/var/run/docker.sock"):
        raise HTTPException(status_code=500, detail="Docker socket not found. Cannot perform self-update.")

    # In a real environment, we'd trigger a background process to pull and restart
    # Since this container will be killed when restarted, we need to run it in a way that continues
    
    # Example command to update if using compose:
    # docker compose -f isopod-compose.yml pull && docker compose -f isopod-compose.yml up -d
    
    # For now, we'll provide a response and then attempt to trigger a restart
    # We'll use a small delay so the response reaches the client
    
    async def trigger_restart():
        await asyncio.sleep(2)
        # We try to determine the compose file name.
        compose_file = "isopod-compose.yml" if os.path.exists("isopod-compose.yml") else "docker-compose.yml"
        
        # Pull (if possible) and up -d
        # If built from source, this only works if 'git pull' happened, which we haven't implemented yet.
        # But if the user uses a pre-built image, 'pull' is exactly what they need.
        try:
            # If we are in a git repository, pull the latest code first
            if os.path.exists(".git"):
                print("Git repository detected. Pulling latest code...")
                subprocess.run(["git", "pull"], check=True, timeout=30)

            # We run this in the background using subprocess.Popen to avoid being killed immediately
            subprocess.Popen(
                ["docker", "compose", "-f", compose_file, "up", "-d", "--pull", "always"],
                start_new_session=True
            )
        except Exception as e:
            print(f"Self-update trigger failed: {e}")


    asyncio.create_task(trigger_restart())
    
    return {"message": "Update sequence initiated. The application will restart automatically. Please refresh the page in a few moments."}

# Mount the compiled frontend to be served statically


# Ensure '/app/frontend/dist' exists or gracefully ignore if not fully built locally
dist_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(dist_path):
    app.mount("/", StaticFiles(directory=dist_path, html=True), name="frontend")
else:
    # Docker container path
    app.mount("/", StaticFiles(directory="/app/frontend/dist", html=True), name="frontend")

