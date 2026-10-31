import os
import subprocess
import shutil
import re
import zipfile
import tempfile
import asyncio
from fastapi import FastAPI, HTTPException, File, UploadFile, Request, BackgroundTasks, Form, Body
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from dotenv import load_dotenv
import docker
import yaml
from typing import List, Optional, Dict, Any, Union, Tuple
from datetime import datetime, timezone
import httpx
import json
import time
from . import resource_packs as rp
from . import backups
from . import resource_usage
from . import players
from . import modpacks
from . import crashes
from . import bedrock
from . import bedrock_users
from . import bedrock_addons
from . import security
from . import autopause
from . import auth
from . import self_update
import threading

load_dotenv()

app = FastAPI(title="Isopod Backend")

ISOPOD_VERSION = "v0.5.0"
GITHUB_REPO = os.getenv("GITHUB_REPO", "Isopod-Project/Isopod")

# CurseForge's official API requires a key (https://console.curseforge.com). itzg's AUTO_CURSEFORGE
# installer also reads it as CF_API_KEY, so export it for the `docker compose` subprocesses; instance
# compose files reference ${CF_API_KEY} and never contain the secret itself.
CF_API_BASE = "https://api.curseforge.com/v1"
CF_API_KEY = (os.getenv("CURSEFORGE_API_KEY") or os.getenv("CF_API_KEY") or "").strip()
if CF_API_KEY:
    os.environ["CF_API_KEY"] = CF_API_KEY

def cf_api_headers() -> Dict[str, str]:
    """Per-request headers for api.curseforge.com. Never set these as client defaults: several
    handlers share one client between Modrinth and CurseForge, and the key must only go to CurseForge."""
    headers = {"User-Agent": "Isopod/1.0", "Accept": "application/json"}
    if CF_API_KEY:
        headers["x-api-key"] = CF_API_KEY
    return headers

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
    can_self_update: bool = False
    failed_version: Optional[str] = None


class AuthorizationMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        inst_user = request.headers.get("X-Instance-User")
        inst_id = request.headers.get("X-Instance-Id")
        if inst_user and inst_id:
            try:
                access = check_instance_user_access(inst_id, inst_user)
                if not access.get("permitted", True):
                    return JSONResponse(
                        status_code=403,
                        content={"detail": access.get("reason", "Access denied"), "access": access}
                    )
            except Exception as e:
                print(f"Error in AuthorizationMiddleware: {e}")
        response = await call_next(request)
        return response

app.add_middleware(AuthorizationMiddleware)

SERVERS_DIR = os.getenv("SERVERS_DIR", "./servers")

# Middleware added last runs first: CORS, then the cross-origin guard, then the login check.
# Every /api route needs a session from the dashboard login (backend/auth.py).
auth_store = auth.AuthStore(os.path.join(SERVERS_DIR, ".isopod_auth.json"))
app.include_router(auth.create_router(auth_store))
app.add_middleware(auth.AuthMiddleware, store=auth_store)

# The frontend is served from this same origin, so cross-origin access is off unless
# ISOPOD_CORS_ORIGINS lists extra origins (e.g. the Vite dev server). See backend/security.py.
CORS_ORIGINS = security.allowed_origins_from_env()
app.add_middleware(security.OriginGuardMiddleware, allowed_origins=CORS_ORIGINS)
if CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

def get_current_version() -> str:
    # The code that's actually running. Older versions wrote .isopod_version before updating,
    # which could claim a version that never got installed, so that file is ignored.
    return ISOPOD_VERSION

def self_update_compose_file() -> Optional[str]:
    """The compose file an update can rebuild from. A standard install has none in its container."""
    for name in ("isopod-compose.yml", "docker-compose.yml"):
        if os.path.exists(name):
            return name
    return None


try:
    docker_client = docker.from_env()
except docker.errors.DockerException:
    print("Warning: Could not connect to Docker daemon.")
    docker_client = None

def get_docker_client():
    global docker_client
    if docker_client is None:
        try:
            settings_path = os.path.join(SERVERS_DIR, "isopod_settings.json")
            socket_path = None
            if os.path.exists(settings_path):
                try:
                    with open(settings_path, "r") as f:
                        cfg = json.load(f)
                        socket_path = cfg.get("dockerSocket")
                except Exception:
                    pass
            if socket_path and os.path.exists(socket_path):
                docker_client = docker.DockerClient(base_url=f"unix://{socket_path}")
            else:
                docker_client = docker.from_env()
        except Exception:
            pass
    return docker_client


class InstanceConfig(BaseModel):
    image: str
    environment: Dict[str, str]
    # always | on-failure | never; left unchanged when omitted
    restart_policy: Optional[str] = None

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
    modpack_version: Optional[str] = None
    group: Optional[str] = "No group"
    icon_url: Optional[str] = None
    memory: Optional[str] = "1G"
    # World settings
    seed: Optional[str] = None
    level_type: Optional[str] = "DEFAULT"
    difficulty: Optional[str] = "easy"
    gamemode: Optional[str] = "survival"
    generate_structures: Optional[bool] = True
    whitelist_enabled: Optional[bool] = None
    whitelist_users: Optional[List[str]] = None


class RenameInstanceRequest(BaseModel):
    name: str

class DuplicateInstanceRequest(BaseModel):
    name: Optional[str] = None

class BackupSettingsRequest(BaseModel):
    enabled: bool
    interval_hours: float
    keep: int
    snapshot_keep: int = backups.DEFAULT_SETTINGS["snapshot_keep"]

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

def instance_dir(slug: str) -> Optional[str]:
    """The folder for an instance slug inside SERVERS_DIR, or None if the slug would escape it."""
    servers_root = os.path.realpath(SERVERS_DIR)
    path = os.path.realpath(os.path.join(servers_root, slug))
    # Containment check (also what CodeQL recognizes as a path-injection sanitizer).
    # An empty slug resolves to SERVERS_DIR itself, which this rejects too.
    if not path.startswith(servers_root + os.sep):
        return None
    return path

def new_instance_dir(name: str) -> Tuple[str, str]:
    """A free slug and folder for a new instance called name, adding -1, -2... on collisions."""
    base_slug = generate_slug(name)
    slug = base_slug
    counter = 1
    while True:
        path = instance_dir(slug)
        if path is None:
            raise HTTPException(status_code=400, detail="Instance name needs at least one letter or number")
        if not os.path.exists(path):
            return slug, path
        slug = f"{base_slug}-{counter}"
        counter += 1

# An ID, slug, or version number that's safe to put in a URL path: no slashes, no "..".
URL_SEGMENT_RE = re.compile(r"[A-Za-z0-9_+-]+(?:\.[A-Za-z0-9_+-]+)*")

def url_segment(value: Optional[str], label: str) -> Optional[str]:
    """value, checked safe to put in a URL path. Empty stays None; anything else is a 400."""
    if not value:
        return None
    if URL_SEGMENT_RE.fullmatch(value):
        return value
    raise HTTPException(status_code=400, detail=f"Invalid {label}")

def get_instance_path(instance_id: str) -> str:
    # Basic sanitize
    safe_id = "".join(c for c in instance_id if c.isalnum() or c in ('-', '_'))
    path = instance_dir(safe_id)
    if path is None or not os.path.isdir(path):
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

def get_instance_memory_setting(instance_path: str) -> Optional[str]:
    """The MEMORY value from an instance's docker-compose.yml, e.g. "2G"."""
    try:
        with open(os.path.join(instance_path, "docker-compose.yml"), "r") as f:
            services = (yaml.safe_load(f) or {}).get("services", {})
        mc_config = services.get("mc") or list(services.values())[0]
        env = mc_config.get("environment", {})
        if isinstance(env, list):
            env = dict(item.split("=", 1) for item in env if "=" in item)
        return env.get("MEMORY")
    except Exception:
        return None

@app.get("/api/resources")
def get_resource_usage():
    """Live CPU and RAM usage per running instance, plus totals across all instances."""
    client = get_docker_client()
    if not client:
        raise HTTPException(status_code=500, detail="Docker client not initialized")
    instances = list_instances()
    allocated = {inst.id: resource_usage.parse_memory(get_instance_memory_setting(inst.path)) for inst in instances}
    return resource_usage.collect(client, [inst.id for inst in instances], allocated)

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
    client = get_docker_client()
    if not client:
        raise HTTPException(status_code=500, detail="Docker client not initialized")

    project_label_value = "".join(c for c in instance_id if c.isalnum() or c in ('-', '_')).lower()
    
    filters = {"label": f"com.docker.compose.project={project_label_value}"}
    containers = client.containers.list(all=True, filters=filters)
    
    if not containers:
        filters = {"label": f"com.docker.compose.project={instance_id}"}
        containers = client.containers.list(all=True, filters=filters)

    is_running = any(c.status == "running" for c in containers)
    
    # Check logs for "Done" heartbeat if running
    is_ready = False
    is_paused = False
    startup_status = "Offline"
    # 0 means no real progress to report; the dashboard shows an indeterminate bar.
    startup_percent = 0
    if is_running:
        startup_status = "Starting..."
        try:
            # Check most recent logs for Minecraft heartbeats
            log_result = subprocess.run(
                ["docker", "compose", "logs", "--tail=200", "mc"],
                cwd=get_instance_path(instance_id),
                capture_output=True, text=True, timeout=5
            )
            stdout = log_result.stdout
            lines = stdout.splitlines()
            for line in reversed(lines):
                # Check for stopping / shutdown first (most recent event)
                if any(x in line for x in ["Stopping server", "Stopping the server", "Closing Server"]):
                    is_ready = False
                    startup_status = "Stopping..."
                    break
                # Check for online / ready
                if "Done (" in line or "Done!" in line or bedrock.READY_MARKER in line:
                    is_ready = True
                    startup_status = "Online"
                    startup_percent = 100
                    break
                # Parse logs for startup state
                import re
                m = re.search(r"Preparing spawn area:\s*(\d+)%", line)
                if m:
                    pct = int(m.group(1))
                    startup_status = f"Preparing spawn area ({pct}%)"
                    startup_percent = int(45 + pct * 0.5)
                    break
                if "Preparing level" in line or "Preparing start region" in line:
                    startup_status = "Preparing level..."
                    startup_percent = 40
                    break
                if "Loading mods" in line or ("Loaded " in line and " mods" in line) or "Applying patches" in line or "Patching" in line:
                    startup_status = "Loading mods..."
                    startup_percent = 30
                    break
                if "Loading properties" in line or "Default game type:" in line:
                    startup_status = "Loading properties..."
                    startup_percent = 20
                    break
                if "Starting minecraft server version" in line or "Starting Minecraft server" in line or "Loading libraries" in line:
                    startup_status = "Starting Minecraft server..."
                    startup_percent = 15
                    break
                if any(x in line.lower() for x in ["downloading", "installing", "resolving"]):
                    startup_status = "Downloading server files..."
                    startup_percent = 10
                    break
        except: pass
        if is_ready:
            started = [autopause.parse_started_at(c.attrs.get("State", {}).get("StartedAt")) for c in containers if c.status == "running"]
            is_paused = autopause.is_sleeping(get_instance_path(instance_id), max((t for t in started if t), default=None))
            if is_paused:
                startup_status = "Sleeping"
    else:
        is_restarting = any(c.status == "restarting" for c in containers)
        if is_restarting:
            startup_status = "Restarting..."
        else:
            startup_status = "Offline"

    # Get metadata like version and last active
    version = "Unknown"
    port = 25565
    bedrock_port = None
    server_type = "VANILLA"
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
               if isinstance(env, list):
                   env_dict = {}
                   for item in env:
                       if "=" in item:
                           k, v = item.split("=", 1)
                           env_dict[k] = v
                   env = env_dict
               version = env.get("VERSION", "Unknown") if isinstance(env, dict) else "Unknown"
               server_type = (env.get("TYPE") or "VANILLA").upper() if isinstance(env, dict) else "VANILLA"
               
               # Extract port
               ports = mc_config.get("ports", [])
               if ports:
                   p_str = str(ports[0]).split(":")[0]
                   port = int(p_str)
               bedrock_port = bedrock.bedrock_port(mc_config)
        
        # Last online from docker-compose.yml mod date
        last_online = os.path.getmtime(compose_path)
    except Exception as e:
        print(f"Error parsing compose for status: {e}")

    public_ip = await get_public_ip()

    container_info = []
    for c in containers:
        container_info.append({
            "id": c.short_id,
            "name": c.name,
            "state": c.status,
            "image": c.image.tags[0] if c.image.tags else c.image.id,    
        })

    pending_snapshot = None
    crash = None
    try:
        instance_path = get_instance_path(instance_id)
        pending_snapshot = current_pending_snapshot(instance_path, containers, is_ready)
        crash = current_crash_state(instance_path, containers, is_running)
    except HTTPException:
        pass
    if crash and crash["state"] == "crashed":
        startup_status = "Out of memory" if crash.get("oom_killed") else f"Crashed (Code: {crash.get('exit_code')})"
    elif crash and crash["state"] == "halted":
        startup_status = "Crash loop stopped"
    elif crash and crash["state"] == "restarting":
        startup_status = "Restarting after crash..."

    return {
        "instance_id": instance_id,
        "is_running": is_running,
        "is_ready": is_ready,
        # Paused by auto-pause; the first player to connect wakes it
        "is_paused": is_paused,
        "pending_snapshot": pending_snapshot,
        "crash": crash,
        "version": version,
        "type": server_type,
        "port": port,
        # UDP port Bedrock players join on (the game port itself on a Bedrock server); None without cross-play
        "bedrock_port": bedrock_port,
        "public_ip": public_ip,
        "last_online": last_online,
        "containers": container_info,
        "startup_status": startup_status,
        "startup_percent": startup_percent
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
    
    m_ids_str = env.get("RESOURCE_PACKS_MODRINTH", "")
    pack_list_key = f"{m_ids_str}|{mc_version}"
    
    if m_ids_str:
        cache_dir = os.path.join(SERVERS_DIR, ".cache", "resource_packs")
        os.makedirs(cache_dir, exist_ok=True)
        cache_key = os.path.basename(path)
        hash_file = os.path.join(cache_dir, f"{cache_key}_key.txt")
        
        # Check cache
        last_key = ""
        if os.path.exists(hash_file):
            with open(hash_file, "r") as f: last_key = f.read().strip()
            
        if pack_list_key != last_key:
            print(f"--- Bundling Needed for {instance_id} ---")
            m_ids = [i.strip() for i in m_ids_str.split(",") if i.strip()]
            
            try:
                async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
                    downloaded_zips = []
                    for mid in m_ids:
                        url = await rp.get_latest_version_url(client, "modrinth", mid, mc_version)
                        if url:
                            z_path = os.path.join(cache_dir, f"{mid}.zip")
                            if await rp.download_file(client, url, z_path):
                                downloaded_zips.append(z_path)

                    if downloaded_zips:
                        bundle_path = os.path.join(cache_dir, f"bundle_{cache_key}.zip")
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

    # Sync whitelist and ops files from User Management schema before starting (Bedrock keeps its own allowlist.json)
    if not bedrock.is_bedrock(env.get("TYPE")):
        try:
            users, _ = get_instance_users_internal(instance_id)
            data_dir = os.path.join(path, "data")
            os.makedirs(data_dir, exist_ok=True)
            wl_path = os.path.join(data_dir, "whitelist.json")
            if not os.path.exists(wl_path) or os.path.getsize(wl_path) == 0:
                wl_entries = [{"uuid": u["uuid"] or "", "name": u["name"]} for u in users if u.get("whitelisted") and u.get("active")]
                with open(wl_path, "w") as f:
                    json.dump(wl_entries, f, indent=2)
            # Repair entries saved with undashed UUIDs, which Minecraft ignores
            for access_file in ("whitelist.json", "ops.json"):
                access_path = os.path.join(data_dir, access_file)
                if not os.path.exists(access_path):
                    continue
                with open(access_path, "r") as f:
                    entries = json.load(f)
                if not isinstance(entries, list):
                    continue
                changed = False
                for entry in entries:
                    if isinstance(entry, dict) and isinstance(entry.get("uuid"), str) and entry["uuid"] != format_uuid(entry["uuid"]):
                        entry["uuid"] = format_uuid(entry["uuid"])
                        changed = True
                if changed:
                    with open(access_path, "w") as f:
                        json.dump(entries, f, indent=2)
        except Exception as e:
            print(f"Error syncing user management on start: {e}")

    # Starting by hand acknowledges any crash and re-arms the watchdog
    save_instance_meta(path, {"last_crash": None, "crash_loop_halted": None})

    # Start all services
    result = subprocess.run(["docker", "compose", "up", "-d"], cwd=path, capture_output=True, text=True)
    if result.returncode != 0:
        raw_lines = [l.strip() for l in result.stderr.splitlines() if l.strip()]
        err_lines = [l for l in raw_lines if not any(k in l for k in ["Downloading", "Extracting", "Waiting", "Pulling fs layer", "Verifying Checksum", "Download complete", "Pull complete"])]
        clean_err = "\n".join(err_lines).strip() or "\n".join(raw_lines[-5:]).strip() or "Unknown error"
        raise HTTPException(status_code=400, detail=f"Docker Compose failed: {clean_err}")
    return {"message": "Started"}

@app.post("/api/instances/{instance_id}/stop")
def stop_instance(instance_id: str):
    path = get_instance_path(instance_id)
    # A paused server ignores the shutdown signal until Docker kills it, which looks like a crash
    autopause.wake(path)
    # Use 'down' instead of 'stop' to remove the container, which clears Docker logs
    result = subprocess.run(["docker", "compose", "down"], cwd=path, capture_output=True, text=True)
    if result.returncode != 0:
        clean_err = result.stderr.strip() or "Unknown error"
        raise HTTPException(status_code=400, detail=f"Docker Compose failed: {clean_err}")
    return {"message": "Stopped"}

@app.post("/api/instances/{instance_id}/kill")
def kill_instance(instance_id: str):
    path = get_instance_path(instance_id)
    # A killed container exits non-zero; this keeps it from showing as crashed
    save_instance_meta(path, {"manual_stop_at": time.time()})
    result = subprocess.run(["docker", "compose", "kill"], cwd=path, capture_output=True, text=True)
    if result.returncode != 0:
        clean_err = result.stderr.strip() or "Unknown error"
        raise HTTPException(status_code=400, detail=f"Docker Compose failed: {clean_err}")
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
    
    raw_env = service.get("environment", {})
    env = {}
    if isinstance(raw_env, list):
        for item in raw_env:
            if '=' in item:
                k, v = item.split('=', 1)
                env[k] = v
    elif isinstance(raw_env, dict):
        env = raw_env

    return {
        "image": service.get("image", ""),
        "environment": env,
        "restart_policy": crashes.policy_from_compose(service.get("restart")),
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
    snapshot = None
    if services:
        old_env = env_as_dict(list(services.values())[0].get("environment"))
        reason = describe_update(old_env, new_config.environment)
        if reason:
            snapshot = await asyncio.to_thread(take_pre_update_snapshot, path, reason)
        first_service_name = list(services.keys())[0]
        config['services'][first_service_name]['image'] = new_config.image
        if new_config.restart_policy is not None:
            if new_config.restart_policy not in crashes.RESTART_POLICIES:
                raise HTTPException(status_code=400, detail="Restart policy must be always, on-failure, or never.")
            config['services'][first_service_name]['restart'] = crashes.RESTART_POLICIES[new_config.restart_policy]
        # Ensure EULA is preserved/added
        env = new_config.environment
        env["EULA"] = "TRUE"
        is_bedrock_server = bedrock.is_bedrock(env.get("TYPE"))
        if not is_bedrock_server:
            if env.get("MODRINTH_ALLOWED_VERSION_TYPE") == "release,beta,alpha" or "MODRINTH_ALLOWED_VERSION_TYPE" not in env:
                env["MODRINTH_ALLOWED_VERSION_TYPE"] = "alpha"
            try:
                bedrock.apply_crossplay(config["services"][first_service_name], env, os.path.join(path, "data"), bedrock.crossplay_enabled(old_env))
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
            autopause.apply_settings(env)
        config['services'][first_service_name]['environment'] = env

    with open(compose_path, "w") as f:
        yaml.dump(config, f, default_flow_style=False)

    # Synchronize configured mods directly to data/mods/ immediately upon saving
    sync_result = {}
    try:
        if not bedrock.is_bedrock(new_config.environment.get("TYPE")):
            sync_result = await sync_instance_mods_to_disk(instance_id, new_config.environment) or {}
    except Exception as e:
        print(f"Error syncing mods to disk during config save: {e}")
        
    return {"message": "Config updated", "snapshot": snapshot, **sync_result}

class WhitelistUser(BaseModel):
    name: str
    uuid: Optional[str] = None
    level: int = 0
    is_op: bool = False
    whitelisted: bool = True
    active: bool = True
    # Bedrock only: the Xbox user ID that permissions.json stores operators by
    xuid: Optional[str] = None

class UpdateUsersPayload(BaseModel):
    users: List[WhitelistUser]
    whitelist_enabled: Optional[bool] = None

def get_bedrock_users(path: str, env: dict) -> Tuple[List[dict], bool]:
    """A Bedrock server's users.json, topped up from the allowlist and operators the server already has."""
    data_dir = os.path.join(path, "data")
    os.makedirs(data_dir, exist_ok=True)
    users_file = os.path.join(data_dir, "users.json")
    users, changed = bedrock_users.load_users(bedrock_users.read_json_list(users_file), data_dir, env)
    if users and (changed or not os.path.exists(users_file)):
        try:
            with open(users_file, "w") as f:
                json.dump(users, f, indent=2)
        except OSError as e:
            print(f"Error writing users.json: {e}")
    return users, bedrock_users.allow_list_enabled(env)

def get_instance_users_internal(instance_id: str) -> Tuple[List[dict], bool]:
    path = get_instance_path(instance_id)
    env = read_compose_env(path)
    if bedrock.is_bedrock(env.get("TYPE")):
        return get_bedrock_users(path, env)
    data_dir = os.path.join(path, "data")
    os.makedirs(data_dir, exist_ok=True)
    users_file = os.path.join(data_dir, "users.json")
    whitelist_path = os.path.join(data_dir, "whitelist.json")
    ops_path = os.path.join(data_dir, "ops.json")
    compose_path = os.path.join(path, "docker-compose.yml")
    
    # Check whitelist_enabled and legacy fallback values from docker-compose.yml
    whitelist_enabled = False
    legacy_whitelist_names = []
    legacy_op_names = []
    if os.path.exists(compose_path):
        try:
            with open(compose_path, "r") as f:
                config = yaml.safe_load(f)
            services = config.get("services", {})
            if services:
                first_service = list(services.keys())[0]
                env = services[first_service].get("environment", {})
                env_dict = {}
                if isinstance(env, list):
                    for item in env:
                        if "=" in item:
                            k, v = item.split("=", 1)
                            env_dict[k] = v
                elif isinstance(env, dict):
                    env_dict = env
                whitelist_enabled = env_dict.get("ENABLE_WHITELIST", "").lower() == "true"
                legacy_wl_str = env_dict.get("WHITELIST", "")
                legacy_whitelist_names = [n.strip() for n in legacy_wl_str.split(",") if n.strip()]
                legacy_ops_str = env_dict.get("OPS", "")
                legacy_op_names = [n.strip() for n in legacy_ops_str.split(",") if n.strip()]
        except Exception as e:
            print(f"Error reading docker-compose.yml for user config: {e}")
            
    users = {}
    
    # 1. Primary source of truth: users.json
    if os.path.exists(users_file):
        try:
            with open(users_file, "r") as f:
                saved_users = json.load(f)
                if isinstance(saved_users, list):
                    for u in saved_users:
                        if isinstance(u, dict) and "name" in u:
                            users[u["name"].lower()] = {
                                "name": u["name"],
                                "uuid": u.get("uuid"),
                                "level": u.get("level", 0),
                                "is_op": u.get("is_op", False),
                                "whitelisted": u.get("whitelisted", True),
                                "active": u.get("active", True)
                            }
        except Exception as e:
            print(f"Error reading users.json: {e}")
            
    # 2. Secondary source: construct from ops.json & whitelist.json if users.json absent
    if not users:
        if os.path.exists(ops_path):
            try:
                with open(ops_path, "r") as f:
                    ops_data = json.load(f)
                    if isinstance(ops_data, list):
                        for entry in ops_data:
                            if isinstance(entry, dict) and "name" in entry:
                                name = entry["name"]
                                users[name.lower()] = {
                                    "name": name,
                                    "uuid": entry.get("uuid"),
                                    "level": entry.get("level", 4),
                                    "is_op": True,
                                    "whitelisted": False,
                                    "active": True
                                }
            except Exception as e:
                print(f"Error reading ops.json: {e}")
                
        if os.path.exists(whitelist_path):
            try:
                with open(whitelist_path, "r") as f:
                    wl_data = json.load(f)
                    if isinstance(wl_data, list):
                        for entry in wl_data:
                            if isinstance(entry, dict) and "name" in entry:
                                name = entry["name"]
                                key = name.lower()
                                if key in users:
                                    users[key]["whitelisted"] = True
                                    if entry.get("uuid") and not users[key]["uuid"]:
                                        users[key]["uuid"] = entry["uuid"]
                                else:
                                    users[key] = {
                                        "name": name,
                                        "uuid": entry.get("uuid"),
                                        "level": 0,
                                        "is_op": False,
                                        "whitelisted": True,
                                        "active": True
                                    }
            except Exception as e:
                print(f"Error reading whitelist.json: {e}")
                
    # 3. Data Migration / Backward Compatibility:
    # If legacy WHITELIST environment variables exist in docker-compose.yml, migrate them into users schema
    migrated_any = False
    for name in legacy_whitelist_names:
        key = name.lower()
        if key not in users:
            users[key] = {
                "name": name,
                "uuid": None,
                "level": 0,
                "is_op": False,
                "whitelisted": True,
                "active": True
            }
            migrated_any = True
        else:
            if not users[key]["whitelisted"]:
                users[key]["whitelisted"] = True
                migrated_any = True

    for name in legacy_op_names:
        key = name.lower()
        if key not in users:
            users[key] = {
                "name": name,
                "uuid": None,
                "level": 4,
                "is_op": True,
                "whitelisted": False,
                "active": True
            }
            migrated_any = True

    user_list = list(users.values())
    
    # Persist migrated schema so future requests and active user access are guaranteed
    if (not os.path.exists(users_file) or migrated_any) and user_list:
        try:
            with open(users_file, "w") as f:
                json.dump(user_list, f, indent=2)
            if not os.path.exists(whitelist_path):
                wl_to_write = [{"uuid": u["uuid"] or "", "name": u["name"]} for u in user_list if u.get("whitelisted") and u.get("active")]
                with open(whitelist_path, "w") as f:
                    json.dump(wl_to_write, f, indent=2)
        except Exception as e:
            print(f"Error persisting users.json after migration: {e}")
            
    return user_list, whitelist_enabled


def check_instance_user_access(instance_id: str, username: str) -> Dict[str, Any]:
    """Single source of truth access evaluation based exclusively on User Management schema."""
    users, wl_enabled = get_instance_users_internal(instance_id)
    user_match = None
    for u in users:
        if u.get("name", "").lower() == username.lower():
            user_match = u
            break
            
    is_active = user_match.get("active", True) if user_match else True
    is_whitelisted = user_match.get("whitelisted", False) if user_match else False
    is_op = user_match.get("is_op", False) if user_match else False
    
    # Deactivated users in User Management are rejected regardless
    if user_match and not is_active:
        return {
            "permitted": False,
            "username": username,
            "whitelist_enabled": wl_enabled,
            "whitelisted": is_whitelisted,
            "active": False,
            "is_op": is_op,
            "reason": "User is deactivated in User Management"
        }
        
    if wl_enabled:
        permitted = bool(user_match and is_whitelisted and is_active)
        return {
            "permitted": permitted,
            "username": username,
            "whitelist_enabled": True,
            "whitelisted": is_whitelisted,
            "active": is_active,
            "is_op": is_op,
            "reason": "User is explicitly whitelisted" if permitted else "Whitelist gating active: user is not whitelisted"
        }
    else:
        return {
            "permitted": True,
            "username": username,
            "whitelist_enabled": False,
            "whitelisted": is_whitelisted,
            "active": is_active,
            "is_op": is_op,
            "reason": "Standard user access rules apply without whitelist gating"
        }


@app.get("/api/instances/{instance_id}/users")
def get_instance_users(instance_id: str, response: Response = None):
    users, wl_enabled = get_instance_users_internal(instance_id)
    if response:
        response.headers["X-Whitelist-Enabled"] = "true" if wl_enabled else "false"
    return users


def format_uuid(raw_uuid: str) -> str:
    if len(raw_uuid) == 32:
        return f"{raw_uuid[:8]}-{raw_uuid[8:12]}-{raw_uuid[12:16]}-{raw_uuid[16:20]}-{raw_uuid[20:]}"
    return raw_uuid

def get_minecraft_uuid(username: str) -> str:
    import urllib.request
    import urllib.parse
    import hashlib
    import json
    
    url = f"https://api.mojang.com/users/profiles/minecraft/{urllib.parse.quote(username, safe='')}"
    try:
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        with urllib.request.urlopen(req, timeout=3) as response:
            if response.status == 200:
                data = json.loads(response.read().decode())
                raw_id = data.get("id")
                if raw_id:
                    return format_uuid(raw_id)
    except Exception as e:
        print(f"Error fetching UUID from Mojang API: {e}")
        
    # Fallback to offline UUID generation (MD5-based offline UUID)
    # Minecraft's offline-mode UUID scheme, not a security use of MD5
    hash_bytes = hashlib.md5(f"OfflinePlayer:{username}".encode('utf-8'), usedforsecurity=False).digest()
    hash_list = list(hash_bytes)
    hash_list[6] = (hash_list[6] & 0x0f) | 0x30  # Version 3 UUID
    hash_list[8] = (hash_list[8] & 0x3f) | 0x80  # Variant 1
    hex_str = ''.join(f'{b:02x}' for b in hash_list)
    return f"{hex_str[:8]}-{hex_str[8:12]}-{hex_str[12:16]}-{hex_str[16:20]}-{hex_str[20:]}"


@app.put("/api/instances/{instance_id}/users")
def update_instance_users(
    instance_id: str, 
    payload: Union[UpdateUsersPayload, List[WhitelistUser]] = Body(...),
    whitelist_enabled: Optional[bool] = None,
    response: Response = None
):
    if isinstance(payload, UpdateUsersPayload):
        users = payload.users
        wl_enabled = payload.whitelist_enabled if payload.whitelist_enabled is not None else whitelist_enabled
    else:
        users = payload
        wl_enabled = whitelist_enabled

    path = get_instance_path(instance_id)
    if bedrock.is_bedrock(read_compose_env(path).get("TYPE")):
        return update_bedrock_users(path, users, wl_enabled, response)
    data_dir = os.path.join(path, "data")
    os.makedirs(data_dir, exist_ok=True)
    users_file = os.path.join(data_dir, "users.json")
    whitelist_path = os.path.join(data_dir, "whitelist.json")
    ops_path = os.path.join(data_dir, "ops.json")
    
    # Read existing ops to know who was previously opped
    old_ops = set()
    if os.path.exists(ops_path):
        try:
            with open(ops_path, "r") as f:
                ops_data_old = json.load(f)
                if isinstance(ops_data_old, list):
                    for entry in ops_data_old:
                        if isinstance(entry, dict) and "name" in entry:
                            old_ops.add(entry["name"].lower())
        except Exception as e:
            print(f"Error reading existing ops.json: {e}")
            
    whitelist_data = []
    ops_data = []
    full_users_data = []
    
    whitelist_names = []
    ops_names = []
    
    for u in users:
        name = u.name
        uuid = u.uuid
        level = u.level
        is_op = u.is_op
        whitelisted = u.whitelisted
        active = u.active
        
        if not name:
            continue
            
        # Minecraft silently drops whitelist/ops entries whose UUID lacks dashes
        uuid = format_uuid(uuid) if uuid else get_minecraft_uuid(name)
            
        full_users_data.append({
            "name": name,
            "uuid": uuid,
            "level": level,
            "is_op": is_op,
            "whitelisted": whitelisted,
            "active": active
        })
            
        # Only active users are written to access files
        if active and whitelisted:
            whitelist_data.append({
                "uuid": uuid or "",
                "name": name
            })
            whitelist_names.append(name)
            
        if active and (is_op or level > 0):
            ops_data.append({
                "uuid": uuid or "",
                "name": name,
                "level": level if level > 0 else 4,
                "bypassesPlayerLimit": False
            })
            ops_names.append(name)
            
    # Write users.json (Single source of truth)
    try:
        with open(users_file, "w") as f:
            json.dump(full_users_data, f, indent=2)
    except Exception as e:
        print(f"Error writing users.json: {e}")

    # Write whitelist.json
    try:
        with open(whitelist_path, "w") as f:
            json.dump(whitelist_data, f, indent=2)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write whitelist.json: {str(e)}")
        
    # Write ops.json
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
                
                # The server image turns the whitelist on whenever WHITELIST is non-empty, even
                # with ENABLE_WHITELIST=false, so leave it empty while the whitelist is off.
                # whitelist.json and users.json still hold the names.
                wl_str = "" if wl_enabled is False else ",".join(whitelist_names)
                ops_str = ",".join(ops_names)
                wl_val = "true" if wl_enabled else "false"
                
                if isinstance(env, list):
                    new_env = []
                    found_wl = False
                    found_ops = False
                    found_enable = False
                    for item in env:
                        if item.startswith("WHITELIST="):
                            new_env.append(f"WHITELIST={wl_str}")
                            found_wl = True
                        elif item.startswith("OPS="):
                            new_env.append(f"OPS={ops_str}")
                            found_ops = True
                        elif item.startswith("ENABLE_WHITELIST=") and wl_enabled is not None:
                            new_env.append(f"ENABLE_WHITELIST={wl_val}")
                            found_enable = True
                        else:
                            new_env.append(item)
                    if not found_wl:
                        new_env.append(f"WHITELIST={wl_str}")
                    if not found_ops:
                        new_env.append(f"OPS={ops_str}")
                    if not found_enable and wl_enabled is not None:
                        new_env.append(f"ENABLE_WHITELIST={wl_val}")
                    service["environment"] = new_env
                elif isinstance(env, dict):
                    env["WHITELIST"] = wl_str
                    env["OPS"] = ops_str
                    if wl_enabled is not None:
                        env["ENABLE_WHITELIST"] = wl_val
                    service["environment"] = env
                    
            with open(compose_path, "w") as f:
                yaml.dump(config, f, default_flow_style=False)
        except Exception as e:
            print(f"Error syncing environment variables to docker-compose.yml: {e}")
            
    # If container is running, execute commands to sync whitelist and ops
    is_running = False
    client = get_docker_client()
    if client:
        try:
            c_name = f"isopod_{instance_id}"
            c = client.containers.get(c_name)
            is_running = c.status == "running"
        except: pass
        
    if is_running:
        # Toggle whitelist mode in live server if changed
        if wl_enabled is not None:
            cmd_toggle = ["docker", "compose", "exec", "-T", "mc", "rcon-cli", f"whitelist {'on' if wl_enabled else 'off'}"]
            try:
                subprocess.run(cmd_toggle, cwd=path, capture_output=True, text=True, timeout=5)
            except Exception as e:
                print(f"RCON whitelist toggle failed: {e}")
                
        # 1. Reload Whitelist. Skipped while the whitelist is off: with enforce-whitelist set,
        # vanilla's reload kicks everyone missing from whitelist.json even when it isn't in use.
        if wl_enabled is not False:
            cmd_wl = ["docker", "compose", "exec", "-T", "mc", "rcon-cli", "whitelist reload"]
            try:
                subprocess.run(cmd_wl, cwd=path, capture_output=True, text=True, timeout=5)
            except Exception as e:
                print(f"RCON whitelist reload failed: {e}")
            
        # 2. Deop players who are no longer ops
        new_ops_lower = {n.lower() for n in ops_names}
        for name in old_ops:
            if name not in new_ops_lower:
                cmd_deop = ["docker", "compose", "exec", "-T", "mc", "rcon-cli", f"deop {name}"]
                try:
                    subprocess.run(cmd_deop, cwd=path, capture_output=True, text=True, timeout=5)
                except Exception as e:
                    print(f"RCON deop failed for {name}: {e}")
                    
        # 3. Op players who are now ops
        for name in ops_names:
            cmd_op = ["docker", "compose", "exec", "-T", "mc", "rcon-cli", f"op {name}"]
            try:
                subprocess.run(cmd_op, cwd=path, capture_output=True, text=True, timeout=5)
            except Exception as e:
                print(f"RCON op failed for {name}: {e}")
            
    if response and wl_enabled is not None:
        response.headers["X-Whitelist-Enabled"] = "true" if wl_enabled else "false"

    return {"message": "Users updated successfully", "whitelist_enabled": wl_enabled}


def update_bedrock_users(path: str, users: List[WhitelistUser], wl_enabled: Optional[bool], response: Optional[Response]):
    """Save a Bedrock server's allowlist and operators. bedrock_users explains where each copy goes."""
    data_dir = os.path.join(path, "data")
    env = read_compose_env(path)
    old_users, old_enabled = get_bedrock_users(path, env)
    enabled = old_enabled if wl_enabled is None else wl_enabled
    try:
        new_users = bedrock_users.normalize([u.model_dump() for u in users], old_users)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        with open(os.path.join(data_dir, "users.json"), "w") as f:
            json.dump(new_users, f, indent=2)
        bedrock_users.write_access_files(data_dir, new_users, old_users)
    except OSError as e:
        print(f"Error writing Bedrock access files: {e}")
        raise HTTPException(status_code=500, detail="Couldn't save the allowlist files.")

    env_updates = bedrock_users.access_env(new_users, enabled, env, old_users)
    set_compose_env(path, env_updates)

    # Players who aren't online can't be opped live; OPS applies to them on the next start
    commands = bedrock_users.live_commands(old_users, old_enabled, new_users, enabled)
    if commands and is_instance_running(path):
        for command in commands:
            ok, output = bedrock.send_command(path, command)
            if not ok:
                print(f"Bedrock command '{command}' failed: {output}")

    if response:
        response.headers["X-Whitelist-Enabled"] = "true" if enabled else "false"
    return {"message": "Users updated successfully", "whitelist_enabled": enabled, "environment": env_updates}


# ==========================================
# Legacy Access Control Whitelist Deprecated Endpoints
# ==========================================
@app.get("/api/instances/{instance_id}/whitelist")
@app.get("/api/instances/{instance_id}/access-control/whitelist")
def get_legacy_whitelist(instance_id: str, response: Response):
    response.headers["Deprecation"] = "true"
    response.headers["X-Deprecated"] = "This endpoint is deprecated. Use /api/instances/{instance_id}/users instead."
    users, _ = get_instance_users_internal(instance_id)
    return [u for u in users if u.get("whitelisted", True) and u.get("active", True)]


@app.put("/api/instances/{instance_id}/whitelist")
@app.post("/api/instances/{instance_id}/whitelist")
def update_legacy_whitelist(instance_id: str, legacy_users: List[Union[str, dict]], response: Response):
    response.headers["Deprecation"] = "true"
    response.headers["X-Deprecated"] = "This endpoint is deprecated. Use /api/instances/{instance_id}/users instead."
    current_users, _ = get_instance_users_internal(instance_id)
    current_map = {u["name"].lower(): u for u in current_users}
    for item in legacy_users:
        name = item if isinstance(item, str) else item.get("name")
        if not name:
            continue
        key = name.lower()
        if key in current_map:
            current_map[key]["whitelisted"] = True
            current_map[key]["active"] = True
        else:
            current_map[key] = {
                "name": name,
                "uuid": None if isinstance(item, str) else item.get("uuid"),
                "level": 0,
                "is_op": False,
                "whitelisted": True,
                "active": True
            }
    user_models = [WhitelistUser(**u) for u in current_map.values()]
    update_instance_users(instance_id, user_models)
    return {"message": "Legacy whitelist migrated and updated in User Management", "users": list(current_map.values())}


@app.delete("/api/instances/{instance_id}/whitelist/{user_name}")
def delete_legacy_whitelist_user(instance_id: str, user_name: str, response: Response):
    response.headers["Deprecation"] = "true"
    response.headers["X-Deprecated"] = "This endpoint is deprecated. Use /api/instances/{instance_id}/users instead."
    current_users, _ = get_instance_users_internal(instance_id)
    updated = []
    for u in current_users:
        if u["name"].lower() == user_name.lower():
            u["whitelisted"] = False
        updated.append(WhitelistUser(**u))
    update_instance_users(instance_id, updated)
    return {"message": f"User {user_name} unwhitelisted in User Management"}


@app.get("/api/instances/{instance_id}/access/check")
def check_access_endpoint(instance_id: str, username: str):
    return check_instance_user_access(instance_id, username)

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

DEFAULT_SETTINGS = {
    "language": "English",
    "theme": "Dark",
    "defaultPort": "25565",
    "defaultLoader": "VANILLA",
    "defaultMemory": "1G",
    "autoRefresh": True,
    "showSnapshots": False,
    "defaultWhitelistEnabled": False,
    "defaultWhitelistUsers": [],
    "dockerSocket": "/var/run/docker.sock",
    "backupsPath": ""
}

def get_backup_root() -> Optional[str]:
    """Global backup folder from settings; empty means backups stay inside each instance."""
    root = (get_settings().get("backupsPath") or "").strip()
    return root if root and os.path.isabs(root) else None

backups.set_backup_root_provider(get_backup_root)

@app.get("/api/health")
def health():
    """Cheap liveness check the dashboard polls to notice a lost connection."""
    return {"ok": True}

@app.get("/api/settings")
def get_settings():
    settings_path = os.path.join(SERVERS_DIR, "isopod_settings.json")
    if os.path.exists(settings_path):
        try:
            with open(settings_path, "r") as f:
                saved = json.load(f)
                return {**DEFAULT_SETTINGS, **saved}
        except Exception:
            return DEFAULT_SETTINGS.copy()
    return DEFAULT_SETTINGS.copy()

@app.put("/api/settings")
def update_settings(new_settings: Dict[str, Any]):
    backups_path = (new_settings.get("backupsPath") or "").strip()
    if backups_path and not os.path.isabs(backups_path):
        raise HTTPException(status_code=400, detail="Backup folder must be an absolute path.")
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
async def get_loader_versions(loader: str, mc_version: Optional[str] = None, game_version: Optional[str] = None):
    """Fetch available versions for a specific mod loader, optionally filtered by MC version."""
    loader = loader.lower()
    mc_version = url_segment(mc_version or game_version, "Minecraft version")
    print(f"DEBUG: Fetching {loader} versions for MC={mc_version}")
    headers = {"User-Agent": "Isopod-Server-Manager/1.0 (https://github.com/Isopod-Project/Isopod)"}
    try:
        async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=10.0) as client:
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
                url = f"https://meta.quiltmc.org/v3/versions/loader"
                if mc_version and mc_version != "latest":
                    url = f"https://meta.quiltmc.org/v3/versions/loader/{mc_version}"
                print(f"DEBUG: Fetching Quilt from {url}")
                try:
                    res = await client.get(url)
                    if res.is_success:
                        data = res.json()
                        if mc_version and mc_version != "latest":
                            return [{"id": v["loader"]["version"], "stable": "-" not in v["loader"]["version"]} for v in data]
                        else:
                            return [{"id": v["version"], "stable": "-" not in v["version"]} for v in data]
                except Exception as qe:
                    print(f"DEBUG: Quilt meta fetch failed ({qe}), trying Prism meta fallback")
                # Fallback to Prism Launcher meta
                try:
                    prism_res = await client.get("https://meta.prismlauncher.org/v1/org.quiltmc.quilt-loader/index.json")
                    if prism_res.is_success:
                        pdata = prism_res.json()
                        return [{"id": v["version"], "stable": v.get("type") == "release"} for v in pdata.get("versions", [])]
                except Exception:
                    pass
                return []

            elif loader == "forge":
                # Primary source: Prism Launcher meta (reliable, pre-filtered with Minecraft version dependencies)
                try:
                    res = await client.get("https://meta.prismlauncher.org/v1/net.minecraftforge/index.json")
                    if res.is_success:
                        data = res.json()
                        versions = data.get("versions", [])
                        if mc_version and mc_version != "latest":
                            matching = [
                                {"id": v["version"], "stable": v.get("recommended", False)}
                                for v in versions
                                if any(req.get("equals") == mc_version for req in v.get("requires", []))
                            ]
                            if matching:
                                return matching
                        else:
                            return [{"id": v["version"], "stable": v.get("recommended", False)} for v in versions[:100]]
                except Exception as fe:
                    print(f"DEBUG: Prism meta fetch for Forge failed ({fe}), trying BMCLAPI fallback")

                # Fallback: BMCLAPI
                url = f"https://bmclapi2.bangbang93.com/forge/minecraft/{mc_version}" if mc_version and mc_version != "latest" else "https://bmclapi2.bangbang93.com/forge/promotions"
                res = await client.get(url)
                if res.is_success:
                    data = res.json()
                    if mc_version and mc_version != "latest" and isinstance(data, list):
                        return [{"id": v["version"], "stable": v.get("type") == "recommended"} for v in reversed(data)]
                    elif isinstance(data, dict):
                        promos = data.get("promos", {})
                        return [{"id": v, "name": k, "stable": "recommended" in k} for k, v in promos.items()]
                return []

            elif loader == "neoforge":
                # Primary source: Prism Launcher meta
                try:
                    res = await client.get("https://meta.prismlauncher.org/v1/net.neoforged/index.json")
                    if res.is_success:
                        data = res.json()
                        versions = data.get("versions", [])
                        if mc_version and mc_version != "latest":
                            matching = [
                                {"id": v["version"], "stable": v.get("recommended", False) or v.get("type") == "release"}
                                for v in versions
                                if any(req.get("equals") == mc_version for req in v.get("requires", []))
                            ]
                            if matching:
                                return matching
                        else:
                            return [{"id": v["version"], "stable": v.get("type") == "release"} for v in versions[:100]]
                except Exception as ne:
                    print(f"DEBUG: Prism meta fetch for NeoForge failed ({ne}), trying BMCLAPI fallback")

                # Fallback: BMCLAPI
                url = f"https://bmclapi2.bangbang93.com/neoforge/list/{mc_version}" if mc_version and mc_version != "latest" else "https://bmclapi2.bangbang93.com/neoforge/list"
                res = await client.get(url)
                if res.is_success:
                    data = res.json()
                    if isinstance(data, list):
                        return [{"id": v.get("version", v.get("rawVersion")), "stable": True} for v in reversed(data)]
                return []

            elif loader in ("paper", "folia"):
                target_ver = mc_version
                if not target_ver or target_ver == "latest":
                    # The project lists its versions newest first
                    try:
                        p_res = await client.get(f"https://fill.papermc.io/v3/projects/{loader}")
                        if p_res.is_success:
                            all_vers = [v for v_list in p_res.json().get("versions", {}).values() for v in v_list]
                            if all_vers:
                                target_ver = all_vers[0]
                    except Exception:
                        target_ver = "1.20.1"

                url = f"https://fill.papermc.io/v3/projects/{loader}/versions/{target_ver}/builds"
                print(f"DEBUG: Fetching {loader} from {url}")
                res = await client.get(url)
                if res.is_success:
                    builds_data = res.json()
                    if isinstance(builds_data, list):
                        return [{"id": str(b["id"]), "stable": b.get("channel", "STABLE") == "STABLE"} for b in builds_data]
                # Folia only has builds for some versions; offering "latest" would fail at start
                return [] if loader == "folia" else [{"id": "latest", "stable": True}]

            elif loader == "purpur":
                target_ver = mc_version
                if not target_ver or target_ver == "latest":
                    p_res = await client.get("https://api.purpurmc.org/v2/purpur")
                    if not p_res.is_success:
                        return []
                    target_ver = p_res.json().get("metadata", {}).get("current")
                res = await client.get(f"https://api.purpurmc.org/v2/purpur/{target_ver}")
                if res.is_success:
                    builds = res.json().get("builds", {}).get("all", [])
                    # Oldest first in the API; newest first here like the other loaders
                    return [{"id": str(b), "stable": True} for b in reversed(builds)]
                return []

    except Exception as e:
        print(f"DEBUG: Error fetching {loader} versions: {e}")
        return []

    return []

def get_java_tag_for_mc_version(mc_version: str) -> str:
    if not mc_version:
        return "java21"
    
    parts = mc_version.split(".")
    try:
        if len(parts) >= 1:
            major = int(parts[0])
            if major == 1:
                if len(parts) >= 2:
                    minor = int(parts[1])
                    if minor >= 21:
                        return "java21"
                    elif minor >= 20:
                        if len(parts) >= 3 and int(parts[2]) >= 5:
                            return "java21"
                        return "java17"
                    elif minor >= 18:
                        return "java17"
                    elif minor >= 17:
                        return "java17"
                    else:
                        return "java8"
            else:
                if major >= 25:
                    return "java25"
                elif major >= 21:
                    return "java21"
                elif major >= 17:
                    return "java17"
                else:
                    return "java8"
    except Exception as e:
        print(f"Error parsing MC version '{mc_version}' for Java mapping: {e}")
    
    if "1.21" in mc_version or "1.20.5" in mc_version or "1.20.6" in mc_version or "26." in mc_version:
        return "java21"
    if "1.20" in mc_version or "1.19" in mc_version or "1.18" in mc_version:
        return "java17"
    
    return "java21"

def is_client_only_mod(filename: str) -> bool:
    fn = filename.lower()
    if fn.endswith(".jar"):
        fn = fn[:-4]
    
    # Normalize: strip all non-alphanumeric chars
    import re
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
    
    for indicator in client_indicators:
        if norm.startswith(indicator):
            return True
            
    return False

@app.get("/api/mods/modrinth/{project_id}/versions")
async def get_modrinth_project_versions(project_id: str):
    project_id = url_segment(project_id, "project ID")
    url = f"https://api.modrinth.com/v2/project/{project_id}/version"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(url)
            if res.status_code == 200:
                versions = res.json()
                results = []
                for v in versions:
                    results.append({
                        "id": v["id"],
                        "version_number": v["version_number"],
                        "name": v["name"],
                        "game_versions": v["game_versions"],
                        "loaders": v["loaders"],
                        "version_type": v["version_type"]
                    })
                return results
            else:
                raise HTTPException(status_code=res.status_code, detail="Failed to fetch Modrinth versions")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Modrinth API error: {str(e)}")


MODPACK_SERVER_TYPES = {"modrinth", "auto_curseforge", "curseforge", "ftba"}

# Plugin server TYPEs -> the Modrinth loader categories whose plugins they can run.
# Purpur is a Paper fork and runs Paper/Spigot/Bukkit plugins; Folia only runs plugins built for it.
PLUGIN_SERVER_LOADERS = {
    "PAPER": ["paper", "spigot", "bukkit"],
    "PURPUR": ["purpur", "paper", "spigot", "bukkit"],
    "FOLIA": ["folia"],
}

# Server TYPE -> the itzg variable that pins its loader version or build (Folia's has no underscore).
LOADER_VERSION_ENV = {
    "FABRIC": "FABRIC_LOADER_VERSION",
    "FORGE": "FORGE_VERSION",
    "NEOFORGE": "NEOFORGE_VERSION",
    "QUILT": "QUILT_LOADER_VERSION",
    "PAPER": "PAPER_BUILD",
    "PURPUR": "PURPUR_BUILD",
    "FOLIA": "FOLIABUILD",
}

def is_plugin_server(server_type: Optional[str]) -> bool:
    return (server_type or "").upper() in PLUGIN_SERVER_LOADERS

# modrinth.index.json dependency keys -> itzg TYPE loader names
MRPACK_LOADER_DEPENDENCIES = {
    "neoforge": "NEOFORGE",
    "forge": "FORGE",
    "fabric-loader": "FABRIC",
    "quilt-loader": "QUILT",
}

@app.get("/api/mods/curseforge/{project_id}/versions")
async def get_curseforge_project_versions(project_id: str):
    if not project_id.isdigit():
        raise HTTPException(status_code=400, detail="Invalid CurseForge project ID")
    url = f"{CF_API_BASE}/mods/{project_id}/files"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(url, params={"pageSize": 50}, headers=cf_api_headers(), timeout=20.0)
            if res.status_code == 200:
                files = res.json().get("data", [])
                results = []
                for f in files:
                    game_versions = []
                    loaders = []
                    for ver in f.get("gameVersions", []):
                        ver_lower = ver.lower()
                        if ver_lower in ["fabric", "forge", "quilt", "neoforge"]:
                            loaders.append(ver_lower)
                        elif ver and ver[0].isdigit():
                            game_versions.append(ver)
                    
                    results.append({
                        "id": str(f["id"]),
                        "version_number": f.get("displayName", f.get("fileName", "Unknown")),
                        "name": f.get("displayName", f.get("fileName", "Unknown")),
                        "game_versions": game_versions,
                        "loaders": loaders,
                        "version_type": "release" if f.get("releaseType") == 1 else ("beta" if f.get("releaseType") == 2 else "alpha")
                    })
                return results
            else:
                raise HTTPException(status_code=res.status_code, detail="Failed to fetch CurseForge versions")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"CurseForge API error: {str(e)}")

MODPACK_SERVER_TYPES = {"modrinth", "auto_curseforge", "curseforge", "ftba"}

# Plugin server TYPEs -> the Modrinth loader categories whose plugins they can run.
# Purpur is a Paper fork and runs Paper/Spigot/Bukkit plugins; Folia only runs plugins built for it.
PLUGIN_SERVER_LOADERS = {
    "PAPER": ["paper", "spigot", "bukkit"],
    "PURPUR": ["purpur", "paper", "spigot", "bukkit"],
    "FOLIA": ["folia"],
}

# Server TYPE -> the itzg variable that pins its loader version or build (Folia's has no underscore).
LOADER_VERSION_ENV = {
    "FABRIC": "FABRIC_LOADER_VERSION",
    "FORGE": "FORGE_VERSION",
    "NEOFORGE": "NEOFORGE_VERSION",
    "QUILT": "QUILT_LOADER_VERSION",
    "PAPER": "PAPER_BUILD",
    "PURPUR": "PURPUR_BUILD",
    "FOLIA": "FOLIABUILD",
}

def is_plugin_server(server_type: Optional[str]) -> bool:
    return (server_type or "").upper() in PLUGIN_SERVER_LOADERS

# modrinth.index.json dependency keys -> itzg TYPE loader names
MRPACK_LOADER_DEPENDENCIES = {
    "neoforge": "NEOFORGE",
    "forge": "FORGE",
    "fabric-loader": "FABRIC",
    "quilt-loader": "QUILT",
}

@app.get("/api/mods/search/modrinth")
async def search_modrinth(q: Optional[str] = None, mc_version: Optional[str] = None, loader: Optional[str] = None, class_type: str = "mod", only_server_side: bool = True):
    # Handle "undefined" literals from frontend
    q = None if q == "undefined" or not q else q
    mc_version = None if mc_version == "undefined" or not mc_version else mc_version
    loader = None if loader == "undefined" or not loader else loader
    # Modpack server types (e.g. TYPE=MODRINTH) aren't Modrinth loader categories and would match 0 hits
    if loader and loader.lower() in MODPACK_SERVER_TYPES:
        loader = None

    # If query is empty, we browse via facets
    query_str = q if q else ""
        
    # Plugin servers run plugins, not mods
    plugin_loaders = PLUGIN_SERVER_LOADERS.get(loader.upper()) if loader and class_type == "mod" else None
    if plugin_loaders:
        class_type = "plugin"

    facets = [
        [f"project_type:{class_type}"],
    ]
    if class_type == "mod" or (class_type == "modpack" and only_server_side):
        facets.append(["server_side:required", "server_side:optional"])
    if mc_version:
        facets.append([f"versions:{mc_version}"])
    if plugin_loaders:
        facets.append([f"categories:{c}" for c in plugin_loaders])
    elif loader:
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
        meta_dict = {
            "id": item["slug"], # Using slug as ID for itzg/minecraft-server
            "name": item["title"],
            "summary": item["description"],
            "icon_url": item.get("icon_url"),
            "author": item.get("author", "Unknown"),
            "downloads": item.get("downloads", 0),
            "url": f"https://modrinth.com/{'plugin' if plugin_loaders else 'mod'}/{item['slug']}",
            "categories": item.get("categories", []),
            "provider": "modrinth"
        }
        mod_metadata_cache[item["slug"].lower()] = meta_dict
        if "project_id" in item:
            mod_metadata_cache[item["project_id"].lower()] = meta_dict
        mod_metadata_cache[item["title"].lower()] = meta_dict
        results.append(meta_dict)
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
        
    # itzg/minecraft-server uses the CurseForge ID (int)
    url = f"{CF_API_BASE}/mods/search"
    
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
        "sortField": 2, # Popularity
        "sortOrder": "desc",
        "pageSize": 50 # the CurseForge API rejects anything above 50
    }
    if mc_version:
        params["gameVersion"] = mc_version
    if mod_loader_type > 0 and class_id != 12: # resource packs have no loader
        params["modLoaderType"] = mod_loader_type
    params = {k: v for k, v in params.items() if v is not None}

    try:
        if not CF_API_KEY:
            raise HTTPException(status_code=503, detail="CURSEFORGE_API_KEY is not set")
        async with httpx.AsyncClient() as client:
            res = await client.get(url, params=params, headers=cf_api_headers(), timeout=20.0)
        if res.status_code != 200:
            raise HTTPException(status_code=502, detail=f"CurseForge API returned {res.status_code}")
        data = res.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"CurseForge API error: {str(e)}")
        
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
            
            cf_meta = {
                "id": str(item.get("id", "")),
                "name": item.get("name", "Unknown Mod"),
                "summary": item.get("summary", ""),
                "icon_url": icon_url,
                "author": author_name,
                "downloads": int(item.get("downloadCount", 0)) if item.get("downloadCount") is not None else 0,
                "url": item.get("links", {}).get("websiteUrl", "") if item.get("links") else "",
                "categories": [c.get("name", "").lower() for c in item.get("categories", [])] if item.get("categories") else [],
                "provider": "curseforge"
            }
            mod_metadata_cache[str(item.get("id", "")).lower()] = cf_meta
            if item.get("name"):
                mod_metadata_cache[item["name"].lower()] = cf_meta
            results.append(cf_meta)
    except Exception as e:
        print(f"DEBUG: Error parsing CurseForge data: {e}")
        
    return results

def generate_slug(text: str) -> str:
    slug = text.lower()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    return slug.strip('-')

ICON_URL_RE = re.compile(r"https://(?:cdn\.modrinth\.com|media\.forgecdn\.net)/[A-Za-z0-9._~%/+-]+")

@app.post("/api/instances")
async def create_instance(req: CreateInstanceRequest):
    slug = generate_slug(req.name)
    path = instance_dir(slug)
    if path is None:
        raise HTTPException(status_code=400, detail="Instance name needs at least one letter or number")
    if os.path.exists(path):
        raise HTTPException(status_code=400, detail="Instance with similar name already exists")
        
    os.makedirs(path, exist_ok=True)

    # Check default whitelist settings if not passed in request
    settings = get_settings()
    w_enabled = req.whitelist_enabled if req.whitelist_enabled is not None else settings.get("defaultWhitelistEnabled", False)
    w_users = req.whitelist_users if req.whitelist_users is not None else settings.get("defaultWhitelistUsers", [])

    if bedrock.is_bedrock(req.template):
        service = bedrock.compose_service(
            slug, req.name, req.port, req.version, req.seed, req.level_type,
            req.difficulty, req.gamemode, bool(w_enabled), w_users or [],
        )
        with open(os.path.join(path, "docker-compose.yml"), "w") as f:
            yaml.dump({"services": {"mc": service}}, f, default_flow_style=False)
        save_instance_meta(path, {"group": req.group or "No group"})
        return {"id": slug, "message": "Instance created"}

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
                    "JVM_OPTS=--add-opens java.base/sun.misc=ALL-UNNAMED",
                    "MODRINTH_ALLOWED_VERSION_TYPE=alpha"
                ],
                "volumes": ["./data:/data"],
                "dns": ["8.8.8.8", "1.1.1.1"],
                "restart": "unless-stopped"
            }
        }
    }
    
    env = compose_content["services"]["mc"]["environment"]
    if w_enabled:
        env.append("ENABLE_WHITELIST=true")
        if w_users:
            env.append(f"WHITELIST={','.join(w_users)}")
    elif w_users:
        env.append("ENABLE_WHITELIST=false")
        env.append(f"WHITELIST={','.join(w_users)}")

    template = req.template.upper()
    if req.loader_version and req.loader_version != "latest":
        env.append(f"{LOADER_VERSION_ENV.get(template, 'LOADER_VERSION')}={req.loader_version}")

    mc_version = None

    if req.modrinth_id:
        # Resolve Modrinth version metadata for Java version & Minecraft version
        try:
            async with httpx.AsyncClient() as client:
                vdata = None
                modpack_version = url_segment(req.modpack_version, "modpack version")
                if modpack_version:
                    res = await client.get(f"https://api.modrinth.com/v2/version/{modpack_version}")
                    if res.status_code == 200:
                        vdata = res.json()
                else:
                    modrinth_id = url_segment(req.modrinth_id, "modpack ID")
                    res = await client.get(f"https://api.modrinth.com/v2/project/{modrinth_id}/version")
                    if res.status_code == 200:
                        versions = res.json()
                        if versions:
                            vdata = versions[0]
                            req.modpack_version = vdata["id"]
                
                if vdata:
                    if vdata.get("game_versions"):
                        mc_version = vdata["game_versions"][0]
                    
                    # Find mrpack file download link and parse index for client-side only mods
                    mrpack_url = None
                    for file_info in vdata.get("files", []):
                        if file_info.get("filename", "").lower().endswith(".mrpack"):
                            mrpack_url = file_info.get("url")
                            break
                    
                    if mrpack_url:
                        mrpack_res = await client.get(mrpack_url, follow_redirects=True)
                        if mrpack_res.status_code == 200:
                            import zipfile
                            import io
                            with zipfile.ZipFile(io.BytesIO(mrpack_res.content)) as z:
                                if "modrinth.index.json" in z.namelist():
                                    index_data = json.loads(z.read("modrinth.index.json").decode("utf-8"))
                                    # Record the pack's underlying mod loader so mod searches can filter by it
                                    pack_deps = index_data.get("dependencies", {})
                                    for dep_key, loader_type in MRPACK_LOADER_DEPENDENCIES.items():
                                        if dep_key in pack_deps:
                                            env.append(f"ISOPOD_MODPACK_LOADER={loader_type}")
                                            break
                                    excludes = []
                                    for f in index_data.get("files", []):
                                        env_cfg = f.get("env", {})
                                        filename = f.get("path", "").split("/")[-1]
                                        if filename:
                                            if env_cfg.get("server") == "unsupported" or is_client_only_mod(filename):
                                                excludes.append(filename)
                                    
                                    if excludes:
                                        exclude_str = ",".join(excludes)
                                        env.append(f"MODRINTH_EXCLUDE_FILES={exclude_str}")
                                        env.append("MODRINTH_FORCE_SYNCHRONIZE=true")

                                    # Save the pack's mod list now so the Mods tab can show it before first start
                                    try:
                                        await modpacks.save_from_index(client, path, req.modrinth_id, vdata["id"], index_data)
                                    except Exception as e:
                                        print(f"Error saving modpack mod list: {e}")
        except Exception as e:
            print(f"Error fetching Modrinth version details: {e}")

        # Replace TYPE=... with TYPE=MODRINTH for Modrinth modpack
        for i, val in enumerate(env):
            if val.startswith("TYPE="):
                env[i] = "TYPE=MODRINTH"
                break
        env.append(f"MODRINTH_MODPACK={req.modrinth_id}")
        if req.modpack_version:
            env.append(f"MODRINTH_VERSION={req.modpack_version}")


    if req.cf_id:
        file_id = None
        if not str(req.cf_id).isdigit():
            shutil.rmtree(path, ignore_errors=True)
            raise HTTPException(status_code=400, detail="Invalid CurseForge project ID")
        cf_slug = str(req.cf_id)
        # If curseforge, req.modpack_version is the file ID
        try:
            async with httpx.AsyncClient() as client:
                # itzg's CF_SLUG needs the slug, but the frontend sends the numeric project ID
                res = await client.get(f"{CF_API_BASE}/mods/{req.cf_id}", headers=cf_api_headers(), timeout=20.0)
                if res.status_code != 200:
                    raise HTTPException(status_code=502, detail=f"CurseForge API returned {res.status_code} while resolving modpack {req.cf_id}")
                cf_slug = res.json().get("data", {}).get("slug") or cf_slug
                if req.modpack_version:
                    file_id = req.modpack_version
                else:
                    res = await client.get(f"{CF_API_BASE}/mods/{req.cf_id}", headers=cf_api_headers(), timeout=20.0)
                    if res.status_code == 200:
                        data = res.json().get("data", {})
                        latest_files = data.get("latestFiles", [])
                        if latest_files:
                            file_id = str(latest_files[0]["id"])
                            req.modpack_version = file_id
                            for ver in latest_files[0].get("gameVersions", []):
                                if ver and ver[0].isdigit():
                                    mc_version = ver
                                    break
                
                if file_id and not mc_version:
                    res = await client.get(f"{CF_API_BASE}/mods/{req.cf_id}/files/{file_id}", headers=cf_api_headers(), timeout=20.0)
                    if res.status_code == 200:
                        fdata = res.json().get("data", {})
                        for ver in fdata.get("gameVersions", []):
                             if ver and ver[0].isdigit():
                                 mc_version = ver
                                 break
        except HTTPException:
            shutil.rmtree(path, ignore_errors=True)
            raise
        except Exception as e:
            print(f"Error fetching CurseForge version details: {e}")

        # Replace TYPE=... with TYPE=AUTO_CURSEFORGE for CurseForge modpack
        for i, val in enumerate(env):
            if val.startswith("TYPE="):
                env[i] = "TYPE=AUTO_CURSEFORGE"
                break
        env.append(f"CF_SLUG={cf_slug}")
        env.append("CF_API_KEY=${CF_API_KEY}")
        if req.modpack_version:
            env.append(f"CF_FILE_ID={req.modpack_version}")
        
        # Exclude common client-only mods from CurseForge downloads
        cf_excludes = [
            "sodium", "rubidium", "embeddium", "iris-shaders", "oculus", "modmenu", "continuity",
            "entityculling", "immediatelyfast", "dynamic-fps", "e4mc", "controlify",
            "reeses-sodium-options", "sodium-extra", "bettergrassify", "cubes-without-borders",
            "animatica", "skyboxify", "puzzle", "presence-footsteps", "sound-physics-remastered",
            "borderlessfullscreen", "language-reload", "morechathistory", "mainmenucredits",
            "crashassistant", "better-mount-hud", "cape-provider", "zoomify", "debugify",
            "fastquit", "no-chat-reports", "optigui", "litematica", "minihud", "tweakeroo",
            "lambdynamiclights", "bobby", "distant-horizons", "fancymenu", "konkrete",
            "controlling", "searchables", "custom-skin-loader", "fabrishot", "perspectivemod",
            "chunk-fade", "shulbox-tooltip", "itemphysics-lite", "ambience", "visuality",
            "skinlayers-3d", "wavesurfer", "legendary-tooltips"
        ]
        env.append(f"CF_EXCLUDE_MODS={','.join(cf_excludes)}")

    # Set correct java version and Minecraft version based on resolved version
    if mc_version:
        java_tag = get_java_tag_for_mc_version(mc_version)
        compose_content["services"]["mc"]["image"] = f"itzg/minecraft-server:{java_tag}"
        for i, val in enumerate(env):
            if val.startswith("VERSION="):
                env[i] = f"VERSION={mc_version}"
                break
    
    with open(os.path.join(path, "docker-compose.yml"), "w") as f:
        yaml.dump(compose_content, f, default_flow_style=False)
    
    # Pre-initialize users.json and whitelist.json if whitelist users are provided
    if w_users:
        data_dir = os.path.join(path, "data")
        os.makedirs(data_dir, exist_ok=True)
        users_path = os.path.join(data_dir, "users.json")
        wl_path = os.path.join(data_dir, "whitelist.json")
        try:
            users_data = [{"name": u, "uuid": "", "level": 0, "is_op": False, "whitelisted": True, "active": True} for u in w_users]
            with open(users_path, "w") as uf:
                json.dump(users_data, uf, indent=2)
            wl_data = [{"name": u, "uuid": ""} for u in w_users]
            with open(wl_path, "w") as wf:
                json.dump(wl_data, wf, indent=2)
        except Exception as e:
            print(f"Error initializing users.json and whitelist.json: {e}")

    # Save metadata
    save_instance_meta(path, {"group": req.group or "No group"})

    # Download Icon if provided. Only from the mod sites' image CDNs, so a request can't
    # point the server at an internal address.
    icon_url = req.icon_url or ""
    if ICON_URL_RE.fullmatch(icon_url):
        try:
            from PIL import Image
            import io
            print(f"DEBUG: Attempting to download icon from {icon_url}")
            # Use headers to avoid being blocked by CDNs
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"}
            res = httpx.get(icon_url, headers=headers, timeout=15.0, follow_redirects=False)
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
    client = get_docker_client()
    if client:
        try:
            # The naming convention is isopod_{slug} 
            # Note: rename_instance also updates this, but instance_id is always the current slug.
            c_name = f"isopod_{instance_id}"
            try:
                c = client.containers.get(c_name)
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
    new_path = instance_dir(new_slug)
    if new_path is None:
        raise HTTPException(status_code=400, detail="Instance name needs at least one letter or number")
    if os.path.exists(new_path):
        raise HTTPException(status_code=400, detail="Instance with that name already exists")

    # Rename the directory
    old_backups = backups.backups_dir(old_path)
    try:
        os.rename(old_path, new_path)
    except Exception as e:
        print(f"Failed to rename instance folder: {e}")
        raise HTTPException(status_code=500, detail="Couldn't rename the instance folder.")

    # Backups kept in a global folder are keyed by instance id, so move them along
    new_backups = backups.backups_dir(new_path)
    if not old_backups.startswith(old_path + os.sep) and os.path.isdir(old_backups) and not os.path.exists(new_backups):
        try:
            shutil.move(old_backups, new_backups)
        except Exception as e:
            print(f"Failed to move backups for renamed instance: {e}")
    
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
                        for key in ("MOTD", "SERVER_NAME"):
                            if item.startswith(f"{key}="):
                                env[i] = f"{key}={req.name} Hosted by Isopod"
                elif isinstance(env, dict):
                    for key in ("MOTD", "SERVER_NAME"):
                        if key in env:
                            env[key] = f"{req.name} Hosted by Isopod"
            
            with open(compose_path, "w") as f:
                yaml.dump(config, f, default_flow_style=False)
        except Exception as e:
            # Revert folder name if compose update radically fails?
            # Or just continue since directory rename is the main thing
            print(f"Error updating compose after rename: {e}")
            
    return {"id": new_slug, "message": "Instance renamed"}

def sync_bedrock_port_env(service: dict) -> None:
    """After ports move, point ISOPOD_BEDROCK_PORT at the cross-play port's new host side."""
    port = bedrock.bedrock_port(service)
    env = service.get("environment")
    if port is None or not env:
        return
    if isinstance(env, list):
        for i, item in enumerate(env):
            if str(item).startswith(f"{bedrock.BEDROCK_PORT_ENV}="):
                env[i] = f"{bedrock.BEDROCK_PORT_ENV}={port}"
    elif bedrock.BEDROCK_PORT_ENV in env:
        env[bedrock.BEDROCK_PORT_ENV] = str(port)

@app.post("/api/instances/{instance_id}/duplicate")
def duplicate_instance(instance_id: str, req: DuplicateInstanceRequest):
    old_path = get_instance_path(instance_id)
    
    # Use provided name or default to "Copy of <original>"
    original_display_name = instance_id.replace('-', ' ').title()
    new_display_name = req.name or f"Copy of {original_display_name}"
    
    new_slug, new_path = new_instance_dir(new_display_name)
    
    # Clone the entire directory
    try:
        shutil.copytree(old_path, new_path, ignore=shutil.ignore_patterns(backups.BACKUPS_DIR_NAME))
    except Exception as e:
        print(f"Failed to copy instance folder: {e}")
        raise HTTPException(status_code=500, detail="Couldn't copy the instance folder.")
        
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
                
                # Move every published port (game port, cross-play UDP port) to a free one
                bedrock.reassign_ports(service, used_ports)
                sync_bedrock_port_env(service)

                # Update MOTD in environment
                env = service.get("environment", [])
                if isinstance(env, list):
                    for i, item in enumerate(env):
                        for key in ("MOTD", "SERVER_NAME"):
                            if item.startswith(f"{key}="):
                                env[i] = f"{key}={new_display_name} Hosted by Isopod"
                elif isinstance(env, dict):
                    for key in ("MOTD", "SERVER_NAME"):
                        if key in env:
                            env[key] = f"{new_display_name} Hosted by Isopod"
            
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
                    
                    if parts[0] == backups.BACKUPS_DIR_NAME:
                        # Stored backups would bloat the export; they stay with the original instance.
                        include = False
                    elif len(parts) == 1:
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
    port: Optional[str] = Form(None),
    difficulty: Optional[str] = Form(None),
    gamemode: Optional[str] = Form(None),
    seed: Optional[str] = Form(None),
    level_type: Optional[str] = Form(None),
    generate_structures: Optional[str] = Form(None),
    memory: Optional[str] = Form(None),
    group: Optional[str] = Form(None)
):
    if not file.filename.endswith('.zip'):
        raise HTTPException(status_code=400, detail="Only .zip files are supported")
        
    # Generate a unique slug for the new instance
    base_name = name if name else file.filename.rsplit('.', 1)[0]
    new_slug, target_path = new_instance_dir(base_name)
    os.makedirs(target_path, exist_ok=True)
    
    # Save the file temporarily
    with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name
        
    try:
        port_val = None
        if port:
            try:
                port_val = int(port)
            except ValueError:
                pass
                
        gen_struct_bool = True
        if generate_structures is not None:
            gen_struct_bool = generate_structures.lower() == 'true'

        temp_extract_dir = os.path.join(target_path, "temp_extract")
        os.makedirs(temp_extract_dir, exist_ok=True)
        extract_root = os.path.realpath(temp_extract_dir)
        
        with zipfile.ZipFile(tmp_path, 'r') as zipf:
            for member in zipf.infolist():
                filename_normalized = member.filename.replace('\\', '/').lstrip('/')
                target_file = os.path.realpath(os.path.join(extract_root, filename_normalized))
                # Skip entries that would land outside the extract folder (zip slip)
                if not target_file.startswith(extract_root + os.sep):
                    continue
                if member.is_dir():
                    os.makedirs(target_file, exist_ok=True)
                else:
                    os.makedirs(os.path.dirname(target_file), exist_ok=True)
                    with zipf.open(member) as source, open(target_file, "wb") as target:
                        shutil.copyfileobj(source, target)
                        
        compose_file_found = None
        level_dat_found = None
        for root, dirs, files in os.walk(temp_extract_dir):
            for file in files:
                if file.lower() in ('docker-compose.yml', 'docker-compose.yaml'):
                    compose_file_found = os.path.join(root, file)
                    break
                elif file.lower() == 'level.dat':
                    level_dat_found = os.path.join(root, file)
            if compose_file_found:
                break
                
        if not compose_file_found and not level_dat_found:
            raise HTTPException(
                status_code=400, 
                detail="Invalid zip structure. Must contain a docker-compose.yml (for server exports) or level.dat (for single-player worlds)."
            )
            
        if compose_file_found:
            src_dir = os.path.dirname(compose_file_found)
            for item in os.listdir(src_dir):
                src_item = os.path.join(src_dir, item)
                dst_item = os.path.join(target_path, item)
                if item != "temp_extract":
                    shutil.move(src_item, dst_item)
                    
            if os.path.exists(temp_extract_dir):
                shutil.rmtree(temp_extract_dir)
                
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
                        
                        bedrock.reassign_ports(service, used_ports, port_val)
                        sync_bedrock_port_env(service)

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
                            if generate_structures is not None: set_env_list("GENERATE_STRUCTURES", "true" if gen_struct_bool else "false")
                            if memory: set_env_list("MEMORY", memory)
                        elif isinstance(env, dict):
                            if difficulty: env["DIFFICULTY"] = difficulty
                            if gamemode: env["MODE"] = gamemode
                            if seed: env["SEED"] = seed
                            if level_type: env["LEVEL_TYPE"] = level_type
                            if generate_structures is not None: env["GENERATE_STRUCTURES"] = "true" if gen_struct_bool else "false"
                            if memory: env["MEMORY"] = memory
                    
                    with open(compose_path, "w") as f:
                        yaml.dump(config, f, default_flow_style=False)
                except Exception as e:
                    print(f"Error updating compose after import: {e}")
        else:
            src_dir = os.path.dirname(level_dat_found)
            world_dir = os.path.join(target_path, "data", "world")
            os.makedirs(world_dir, exist_ok=True)
            for item in os.listdir(src_dir):
                src_item = os.path.join(src_dir, item)
                dst_item = os.path.join(world_dir, item)
                shutil.move(src_item, dst_item)
                
            if os.path.exists(temp_extract_dir):
                shutil.rmtree(temp_extract_dir)
                                
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
            
            new_port = port_val if port_val else 25565
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
                            f"GENERATE_STRUCTURES={'true' if gen_struct_bool else 'false'}",
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

        # Server exports bring their own meta; an explicit group from the import form wins
        if group and group != "No group":
            save_instance_meta(target_path, {"group": group})

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
        print(f"Failed to fetch logs for {instance_id}: {e}")
        return {"logs": "Couldn't fetch the server logs."}

@app.post("/api/instances/{instance_id}/command")
def execute_command(instance_id: str, req: CommandRequest):
    """Execute a command on the 'mc' service of the instance using docker compose exec."""
    path = get_instance_path(instance_id)
    if bedrock.is_bedrock(read_compose_env(path).get("TYPE")):
        # Bedrock has no RCON; the reply is read back from the server log
        ok, output = bedrock.run_command(path, req.command)
        return {"output": output, "success": ok}
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
        print(f"Failed to run command on {instance_id}: {e}")
        return {"output": "Couldn't run the command on the server.", "success": False}

class PlayerActionRequest(BaseModel):
    action: str
    reason: Optional[str] = None
    message: Optional[str] = None
    target: Optional[str] = None

@app.get("/api/instances/{instance_id}/players")
def get_online_players(instance_id: str):
    """Who is online right now, from RCON `list` (Bedrock: the server log). Only meaningful while the server is Online."""
    path = get_instance_path(instance_id)
    return players.online_players(instance_id, path, bedrock.is_bedrock(read_compose_env(path).get("TYPE")))

@app.get("/api/instances/{instance_id}/bans")
def get_banned_players(instance_id: str):
    """Banned players, read from banned-players.json. Works whether or not the server is running."""
    return players.read_bans(os.path.join(get_instance_path(instance_id), "data"))

@app.post("/api/instances/{instance_id}/players/{name}/action")
def player_action(instance_id: str, name: str, req: PlayerActionRequest):
    """Kick, ban, unban, op/deop, whitelist, message or teleport one player.

    Op and whitelist changes go through User Management so they survive a restart (the
    access files are rebuilt from users.json); the rest are plain RCON commands.
    """
    path = get_instance_path(instance_id)
    if req.action not in players.ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown action: {req.action}")
    if not players.is_valid_name(name):
        raise HTTPException(status_code=400, detail="Invalid player name")

    if req.action in ("op", "deop", "whitelist_add", "whitelist_remove"):
        users, wl_enabled = get_instance_users_internal(instance_id)
        user = next((u for u in users if u.get("name", "").lower() == name.lower()), None)
        if user is None:
            user = {"name": name, "uuid": None, "level": 0, "is_op": False, "whitelisted": False, "active": True}
            users.append(user)
        if req.action in ("op", "deop"):
            user["is_op"] = req.action == "op"
            user["level"] = 4 if req.action == "op" else 0
        else:
            user["whitelisted"] = req.action == "whitelist_add"
        # Pass the whitelist setting through: with it unset, the WHITELIST env var written here
        # makes the server image turn whitelist enforcement on at the next restart.
        update_instance_users(instance_id, [WhitelistUser(**u) for u in users], whitelist_enabled=wl_enabled)
        return {"message": f"{name}: {req.action.replace('_', ' ')} saved"}

    if not is_instance_running(path):
        if req.action != "pardon":
            raise HTTPException(status_code=409, detail="Start the server first; this action runs on the live server.")
        # Stopped: edit the ban list directly so a player can be unbanned without a restart
        if not players.remove_ban(os.path.join(path, "data"), name):
            raise HTTPException(status_code=400, detail=f"{name} isn't banned")
        return {"message": f"Unbanned {name}"}

    try:
        command = players.build_command(req.action, name, req.reason or "", req.message or "", req.target or "")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    ok, output = players.rcon(path, command)
    players.forget(instance_id)
    if not ok:
        raise HTTPException(status_code=400, detail=output or "RCON command failed")
    return {"message": output or "Done", "command": command}

def is_instance_running(path: str) -> bool:
    result = subprocess.run(
        ["docker", "compose", "ps", "--status", "running", "-q"],
        cwd=path, capture_output=True, text=True, timeout=10
    )
    return bool(result.stdout.strip())

@app.get("/api/instances/{instance_id}/backups")
def get_backups(instance_id: str):
    path = get_instance_path(instance_id)
    return {
        "settings": backups.get_settings(get_instance_meta(path)),
        "backups": backups.list_backups(path),
        "snapshots": backups.list_snapshots(path),
        "pending_snapshot": get_instance_meta(path).get("pending_snapshot"),
        "worlds": backups.find_world_dirs(path),
        "location": backups.backups_dir(path),
    }

@app.put("/api/instances/{instance_id}/backups/settings")
def update_backup_settings(instance_id: str, req: BackupSettingsRequest):
    path = get_instance_path(instance_id)
    try:
        settings = backups.validate_settings(req.enabled, req.interval_hours, req.keep, req.snapshot_keep)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    save_instance_meta(path, {"backups": settings})
    if settings["snapshot_keep"]:
        backups.prune_snapshots(path, settings["snapshot_keep"])
    return settings

@app.post("/api/instances/{instance_id}/backups")
async def create_backup(instance_id: str):
    path = get_instance_path(instance_id)
    try:
        backup = await asyncio.to_thread(backups.create_backup, path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    backups.prune_backups(path, backups.get_settings(get_instance_meta(path))["keep"])
    return backup

@app.get("/api/instances/{instance_id}/backups/{name}")
def download_backup(instance_id: str, name: str):
    path = get_instance_path(instance_id)
    try:
        file_path = backups.backup_file_path(path, name)
    except (ValueError, FileNotFoundError):
        raise HTTPException(status_code=404, detail="Backup not found")
    return FileResponse(file_path, media_type="application/zip", filename=f"{instance_id}-{name}")

@app.delete("/api/instances/{instance_id}/backups/{name}")
def delete_backup(instance_id: str, name: str):
    path = get_instance_path(instance_id)
    try:
        os.remove(backups.backup_file_path(path, name))
    except (ValueError, FileNotFoundError):
        raise HTTPException(status_code=404, detail="Backup not found")
    clear_pending_snapshot(path, name)
    return {"deleted": name}

@app.delete("/api/instances/{instance_id}/snapshots/pending")
def dismiss_pending_snapshot(instance_id: str):
    path = get_instance_path(instance_id)
    clear_pending_snapshot(path)
    return {"dismissed": True}

@app.post("/api/instances/{instance_id}/backups/{name}/restore")
async def restore_backup(instance_id: str, name: str):
    path = get_instance_path(instance_id)
    if is_instance_running(path):
        raise HTTPException(status_code=409, detail="Stop the server before restoring a backup.")
    try:
        worlds = await asyncio.to_thread(backups.restore_backup, path, name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Backup not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    clear_pending_snapshot(path, name)
    return {"restored": worlds}

# Compose settings that change what the server runs. Changing any of them takes a snapshot first.
UPDATE_ENV_KEYS = {
    "VERSION": "Minecraft version",
    "TYPE": "server type",
    "FABRIC_LOADER_VERSION": "Fabric loader version",
    "FORGE_VERSION": "Forge version",
    "NEOFORGE_VERSION": "NeoForge version",
    "QUILT_LOADER_VERSION": "Quilt loader version",
    "PAPER_BUILD": "Paper build",
    "PURPUR_BUILD": "Purpur build",
    "FOLIABUILD": "Folia build",
    "LOADER_VERSION": "loader version",
    "MODRINTH_MODPACK": "modpack",
    "MODRINTH_VERSION": "modpack version",
    "MODRINTH_PROJECTS": "mods",
    "MODRINTH_DISABLED": "mods",
    "ISOPOD_CROSSPLAY": "Bedrock cross-play",
}
UPDATE_ENV_PREFIXES = ("CF_",)

def env_as_dict(env) -> dict:
    if isinstance(env, dict):
        return {k: "" if v is None else str(v) for k, v in env.items()}
    result = {}
    for item in env or []:
        if "=" in str(item):
            k, v = str(item).split("=", 1)
            result[k] = v
    return result

def describe_update(old_env: dict, new_env: dict) -> Optional[str]:
    """Describe the update-relevant changes between two compose environments, or None if there are none."""
    new_env = env_as_dict(new_env)
    keys = set(UPDATE_ENV_KEYS) | {k for k in set(old_env) | set(new_env) if k.startswith(UPDATE_ENV_PREFIXES)}
    changed = sorted(k for k in keys if (old_env.get(k) or "") != (new_env.get(k) or ""))
    if not changed:
        return None
    for key in ("VERSION", "TYPE"):
        if key in changed and old_env.get(key) and new_env.get(key):
            return f"Before changing {UPDATE_ENV_KEYS[key]} {old_env[key]} \u2192 {new_env[key]}"
    labels = []
    for key in changed:
        label = UPDATE_ENV_KEYS.get(key, "CurseForge settings")
        if label not in labels:
            labels.append(label)
    return "Before changing " + ", ".join(labels)

def take_pre_update_snapshot(path: str, reason: str) -> Optional[dict]:
    """Snapshot the instance before an update, unless snapshots are off or one was just taken."""
    keep = backups.get_settings(get_instance_meta(path))["snapshot_keep"]
    if keep <= 0:
        return None
    snapshot = backups.recent_snapshot(path)
    if not snapshot:
        try:
            snapshot = backups.create_snapshot(path, reason)
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Couldn't take a snapshot before the change, so nothing was changed: {e}. "
                       "To skip snapshots, set Snapshots to keep to 0 in the Backups tab.",
            )
        backups.prune_snapshots(path, keep)
    # 'changed' is when this change happened; the offer stays until the server starts fine after it.
    save_instance_meta(path, {"pending_snapshot": {
        "name": snapshot["name"], "reason": snapshot.get("reason") or reason, "changed": time.time(),
    }})
    return snapshot

def clear_pending_snapshot(path: str, name: Optional[str] = None) -> None:
    pending = get_instance_meta(path).get("pending_snapshot")
    if pending and (name is None or pending.get("name") == name):
        save_instance_meta(path, {"pending_snapshot": None})

def _container_started_at(container) -> float:
    return _docker_time((container.attrs.get("State") or {}).get("StartedAt"))

def current_pending_snapshot(path: str, containers, is_ready: bool) -> Optional[dict]:
    """The snapshot to offer for rollback. Cleared once the server has started fine after the change."""
    pending = get_instance_meta(path).get("pending_snapshot")
    if not pending:
        return None
    try:
        backups.backup_file_path(path, pending.get("name", ""))
    except (ValueError, FileNotFoundError):
        clear_pending_snapshot(path)
        return None
    if is_ready and any(_container_started_at(c) > pending.get("changed", 0) for c in containers):
        clear_pending_snapshot(path)
        return None
    return pending

def _docker_time(value: Optional[str]) -> float:
    try:
        return datetime.strptime((value or "")[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        return 0

def current_crash_state(path: str, containers, is_running: bool) -> Optional[dict]:
    """What the dashboard should say about crashes: crashed, restarting, halted, recovered, or nothing."""
    meta = get_instance_meta(path)
    last = meta.get("last_crash")
    halted = meta.get("crash_loop_halted")
    if is_running:
        return {"state": "recovered", **last} if last else None
    if halted:
        return {"state": "halted", **(last or {}), "count": halted.get("count")}
    for c in containers:
        state = c.attrs.get("State") or {}
        if state.get("Restarting") and last:
            return {"state": "restarting", **last}
        # Covers crashes the watchdog missed, e.g. while Isopod was down
        if state.get("Status") == "exited" and (state.get("ExitCode") or state.get("OOMKilled")):
            finished = _docker_time(state.get("FinishedAt"))
            if finished > (meta.get("manual_stop_at") or 0):
                return {
                    "state": "crashed",
                    "time": finished,
                    "exit_code": state.get("ExitCode"),
                    "oom_killed": bool(state.get("OOMKilled")),
                }
    return None

@app.delete("/api/instances/{instance_id}/crash")
def dismiss_crash(instance_id: str):
    path = get_instance_path(instance_id)
    save_instance_meta(path, {"last_crash": None, "crash_loop_halted": None})
    return {"dismissed": True}

@app.get("/api/instances/{instance_id}/crash-report")
def get_crash_report(instance_id: str):
    path = get_instance_path(instance_id)
    mods_dir = get_instance_mods_dir(instance_id)
    mod_files = [e.name for e in os.scandir(mods_dir) if e.is_file()] if os.path.isdir(mods_dir) else []
    report = crashes.latest_crash_report(path, mod_files)
    # Out-of-memory kills, port conflicts and the like leave no report; the log tail shows those
    log_tail = ""
    try:
        result = subprocess.run(
            ["docker", "compose", "logs", "--no-log-prefix", "--tail=80", "mc"],
            cwd=path, capture_output=True, text=True, timeout=10,
        )
        log_tail = result.stdout
    except Exception as e:
        print(f"Error reading logs for crash report: {e}")
    return {"report": report, "log_tail": log_tail}

def _instance_path_for_project(project: str) -> Optional[str]:
    """Compose project names are the instance folder name, lowercased."""
    if not os.path.isdir(SERVERS_DIR):
        return None
    for entry in os.scandir(SERVERS_DIR):
        if entry.is_dir() and entry.name.lower() == project.lower() and os.path.exists(os.path.join(entry.path, "docker-compose.yml")):
            return entry.path
    return None

def _instance_restart_policy(path: str) -> str:
    try:
        with open(os.path.join(path, "docker-compose.yml"), "r") as f:
            services = (yaml.safe_load(f) or {}).get("services") or {}
        service = services.get("mc") or (list(services.values())[0] if services else {})
        return crashes.policy_from_compose(service.get("restart"))
    except Exception:
        return crashes.DEFAULT_RESTART_POLICY

def _halt_crash_loop(path: str) -> None:
    result = subprocess.run(["docker", "compose", "stop"], cwd=path, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        print(f"[watchdog] Failed to stop {os.path.basename(path)}: {result.stderr.strip()}")

crash_watchdog = crashes.CrashWatchdog(
    resolve_instance=_instance_path_for_project,
    save_meta=save_instance_meta,
    get_policy=_instance_restart_policy,
    halt=_halt_crash_loop,
)

async def backup_schedule_loop():
    """Background task that runs due scheduled backups once a minute."""
    while True:
        try:
            await asyncio.to_thread(backups.run_due_backups, SERVERS_DIR, get_instance_meta)
        except Exception as e:
            print(f"Backup scheduler error: {e}")
        await asyncio.sleep(60)

@app.get("/api/mods/metadata")
async def get_mods_metadata(modrinth_ids: str = "", cf_ids: str = "", modrinth_modpack: str = "", cf_modpack: str = ""):
    """Fetch metadata for multiple mods from Modrinth."""
    results = []
    
    m_ids = [i.strip() for i in modrinth_ids.split(",") if i.strip()]
    
    async with httpx.AsyncClient() as client:
        # If modrinth_modpack is specified, fetch its dependencies (constituent mods)
        if modrinth_modpack:
            try:
                modrinth_modpack = url_segment(modrinth_modpack, "modpack ID")
                res = await client.get(f"https://api.modrinth.com/v2/project/{modrinth_modpack}/version")
                if res.status_code == 200:
                    versions = res.json()
                    if versions:
                        # Grab dependencies from the latest version of the modpack
                        deps = versions[0].get("dependencies", [])
                        for d in deps:
                            p_id = d.get("project_id")
                            if p_id and p_id not in m_ids:
                                m_ids.append(p_id)
            except Exception as e:
                print(f"Error resolving Modrinth modpack dependencies: {e}")

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
                                "latest_version": project.get("latest_version", "Unknown"),
                                "is_client_only": project.get("server_side") == "unsupported"
                            }
                            mod_metadata_cache[project["slug"]] = meta
                            mod_metadata_cache[project["id"]] = meta
                except Exception as e:
                    print(f"Modrinth bulk error: {e}")
            
            for mid in m_ids:
                if mid in mod_metadata_cache:
                    meta = mod_metadata_cache[mid]
                    if meta.get("is_client_only"):
                        continue
                    meta_copy = meta.copy()
                    meta_copy["requested_id"] = mid
                    results.append(meta_copy)
                else:
                    results.append({"id": mid, "name": mid, "provider": "modrinth", "unknown": True, "requested_id": mid})

    return results

@app.post("/api/mods/check-compatibility")
async def check_mod_compatibility(req: Dict[str, Any]):
    """
    Check if a list of mods is compatible with a target MC version and loader.
    """
    target_mc = req.get("mc_version")
    target_loader = (req.get("loader") or "VANILLA").upper()
    m_ids = req.get("modrinth_ids", [])
    
    results = {
        "compatible": [],
        "incompatible": [],
    }
    
    async with httpx.AsyncClient() as client:
        # Modrinth Compatibility Check
        for mid in m_ids:
            try:
                loaders_param = json.dumps(PLUGIN_SERVER_LOADERS.get(target_loader, [target_loader.lower()]))
                versions_param = json.dumps([target_mc])
                mid = url_segment(str(mid), "mod ID")
                url = f"https://api.modrinth.com/v2/project/{mid}/version"
                res = await client.get(url, params={"loaders": loaders_param, "game_versions": versions_param})
                
                if res.status_code == 200 and len(res.json()) > 0:
                    results["compatible"].append({"id": mid, "provider": "modrinth"})
                else:
                    results["incompatible"].append({"id": mid, "provider": "modrinth"})
            except:
                results["incompatible"].append({"id": mid, "provider": "modrinth"})

    return results

@app.get("/api/mods/dependencies")
async def get_mod_dependencies(provider: str, project_id: str):
    """Fetch dependencies for a mod version. Defaults to latest."""
    if provider == "modrinth":
        try:
            async with httpx.AsyncClient() as client:
                project_id = url_segment(project_id, "project ID")
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
    return []

@app.get("/api/mods/conflicts")
async def get_mod_conflicts(provider: str, project_id: str, current_mods: str = ""):
    """Check for obvious loader/engine conflicts."""
    return {"conflicts": []}


# ==========================================
# Instance Mods Management (Prism Launcher Style)
# ==========================================

def set_compose_env(instance_path: str, values: dict) -> None:
    """Set variables on the mc service in docker-compose.yml, keeping its list or mapping form."""
    compose_path = os.path.join(instance_path, "docker-compose.yml")
    with open(compose_path, "r") as f:
        cdata = yaml.safe_load(f) or {}
    services = cdata.get("services") or {}
    if not services:
        return
    service = services.get("mc") or list(services.values())[0]
    env = service.get("environment") or []
    if isinstance(env, dict):
        env.update(values)
    else:
        env = [item for item in env if str(item).split("=", 1)[0] not in values]
        env += [f"{k}={v}" for k, v in values.items()]
    service["environment"] = env
    with open(compose_path, "w") as f:
        yaml.dump(cdata, f, default_flow_style=False)

def read_compose_env(instance_path: str) -> dict:
    """The mc service's environment from docker-compose.yml, as a dict ({} if unreadable)."""
    try:
        with open(os.path.join(instance_path, "docker-compose.yml"), "r") as f:
            cdata = yaml.safe_load(f) or {}
        services = cdata.get("services") or {}
        service = services.get("mc") or (list(services.values())[0] if services else {})
        return env_as_dict(service.get("environment"))
    except Exception:
        return {}

def get_instance_mods_dir(instance_id: str) -> str:
    base = get_instance_path(instance_id)
    if is_plugin_server(read_compose_env(base).get("TYPE")):
        plugins_dir = os.path.join(base, "data", "plugins")
        os.makedirs(plugins_dir, exist_ok=True)
        return plugins_dir
    # Check data/mods first (standard Docker mount)
    data_mods = os.path.join(base, "data", "mods")
    if os.path.exists(data_mods):
        return data_mods
    # Fallback to base/mods
    plain_mods = os.path.join(base, "mods")
    if os.path.exists(plain_mods):
        return plain_mods
    # Default to data/mods
    os.makedirs(data_mods, exist_ok=True)
    return data_mods


def parse_mod_jar_metadata(jar_path: str) -> dict:
    import base64
    meta = {
        "id": None,
        "name": None,
        "version": None,
        "summary": None,
        "url": None,
        "icon_url": None,
    }
    icon_file = None
    try:
        with zipfile.ZipFile(jar_path, 'r') as z:
            names = set(z.namelist())
            if "fabric.mod.json" in names:
                data = json.loads(z.read("fabric.mod.json").decode('utf-8', errors='ignore'))
                meta["id"] = data.get("id")
                meta["name"] = data.get("name") or data.get("id")
                meta["version"] = str(data.get("version", ""))
                meta["summary"] = data.get("description")
                contact = data.get("contact", {})
                meta["url"] = contact.get("homepage") or contact.get("sources")
                icon_field = data.get("icon")
                if isinstance(icon_field, str):
                    icon_file = icon_field
                elif isinstance(icon_field, dict):
                    icon_file = icon_field.get("128") or icon_field.get("64") or next(iter(icon_field.values()), None)
            elif "quilt.mod.json" in names:
                data = json.loads(z.read("quilt.mod.json").decode('utf-8', errors='ignore'))
                q_meta = data.get("quilt_loader", {}).get("metadata", {})
                meta["id"] = data.get("quilt_loader", {}).get("id")
                meta["name"] = q_meta.get("name") or meta["id"]
                meta["version"] = str(data.get("quilt_loader", {}).get("version", ""))
                meta["summary"] = q_meta.get("description")
                icon_field = q_meta.get("icon")
                if isinstance(icon_field, str):
                    icon_file = icon_field
                elif isinstance(icon_field, dict):
                    icon_file = icon_field.get("128") or icon_field.get("64") or next(iter(icon_field.values()), None)
            elif "META-INF/mods.toml" in names:
                content = z.read("META-INF/mods.toml").decode('utf-8', errors='ignore')
                import re
                m_id = re.search(r'modId\s*=\s*["\']([^"\']+)["\']', content)
                m_name = re.search(r'displayName\s*=\s*["\']([^"\']+)["\']', content)
                m_ver = re.search(r'version\s*=\s*["\']([^"\']+)["\']', content)
                m_desc = re.search(r'description\s*=\s*["\']([^"\']+)["\']', content)
                m_logo = re.search(r'logoFile\s*=\s*["\']([^"\']+)["\']', content)
                if m_id: meta["id"] = m_id.group(1)
                if m_name: meta["name"] = m_name.group(1)
                if m_ver: meta["version"] = m_ver.group(1)
                if m_desc: meta["summary"] = m_desc.group(1)
                if m_logo: icon_file = m_logo.group(1)
            elif "mcmod.info" in names:
                data = json.loads(z.read("mcmod.info").decode('utf-8', errors='ignore'))
                if isinstance(data, list) and data:
                    item = data[0]
                    meta["id"] = item.get("modid")
                    meta["name"] = item.get("name") or item.get("modid")
                    meta["version"] = str(item.get("version", ""))
                    meta["summary"] = item.get("description")
                    meta["url"] = item.get("url")
                    if item.get("logoFile"):
                        icon_file = item.get("logoFile")

            if not icon_file:
                for candidate in ["icon.png", "logo.png", "pack.png"]:
                    if candidate in names:
                        icon_file = candidate
                        break
                if not icon_file:
                    for n in names:
                        if n.endswith("/icon.png") or n.endswith("/logo.png"):
                            icon_file = n
                            break

            if icon_file and icon_file in names:
                try:
                    img_bytes = z.read(icon_file)
                    ext = "png"
                    if icon_file.lower().endswith(".jpg") or icon_file.lower().endswith(".jpeg"):
                        ext = "jpeg"
                    elif icon_file.lower().endswith(".webp"):
                        ext = "webp"
                    meta["icon_url"] = f"data:image/{ext};base64,{base64.b64encode(img_bytes).decode('ascii')}"
                except Exception:
                    pass
    except Exception:
        pass

    filename = os.path.basename(jar_path)
    clean_name = filename
    if clean_name.endswith(".disabled"):
        clean_name = clean_name[:-9]
    if clean_name.endswith(".jar"):
        clean_name = clean_name[:-4]

    import re
    if not meta["name"]:
        # "Some-Mod_1.2.3" -> name "Some Mod", version "1.2.3": split at the first - or _ before a version
        split = re.search(r"[-_](?=[vV]?\d)", clean_name[1:])
        prefix = clean_name[:split.start() + 1] if split else ""
        if prefix and re.fullmatch(r"[A-Za-z0-9_\s+-]+", prefix):
            meta["name"] = prefix.replace("-", " ").replace("_", " ").title()
            if not meta["version"]:
                meta["version"] = clean_name[len(prefix) + 1:]
        else:
            meta["name"] = clean_name.replace("-", " ").replace("_", " ").title()
    else:
        # Strip trailing version suffixes from mod name
        meta["name"] = re.sub(r'[-_vV]?\d+(\.\d+)+.*$', '', meta["name"]).strip()
        meta["name"] = re.sub(r'[-_]\d+.*$', '', meta["name"]).strip()
        if not meta["name"]:
            meta["name"] = clean_name.replace("-", " ").replace("_", " ").title()

    if not meta["id"]:
        meta["id"] = clean_name.lower().replace(" ", "-")

    return meta


@app.get("/api/instances/{instance_id}/mods")
async def list_instance_mods(instance_id: str):
    """List all mods installed in an instance with enable/disable state and file metadata."""
    from datetime import datetime
    mods = []
    seen_ids = set()
    mods_dir = get_instance_mods_dir(instance_id)

    # 1. Physical mod files on disk
    if os.path.exists(mods_dir):
        for entry in os.scandir(mods_dir):
            if not entry.is_file():
                continue
            fname = entry.name
            is_enabled = False
            if fname.lower().endswith(".jar"):
                is_enabled = True
            elif fname.lower().endswith(".jar.disabled"):
                is_enabled = False
            else:
                continue

            try:
                st = entry.stat()
                mtime_str = datetime.fromtimestamp(st.st_mtime).strftime("%m/%d/%y %H:%M")
                jar_meta = parse_mod_jar_metadata(entry.path)

                mod_id = jar_meta["id"] or fname
                seen_ids.add(mod_id.lower())
                seen_ids.add(fname.lower())

                clean_stem = fname.replace(".disabled", "").replace(".jar", "").lower()
                cached = mod_metadata_cache.get(mod_id.lower()) or mod_metadata_cache.get(clean_stem)
                icon_url = jar_meta.get("icon_url") or (cached.get("icon_url") if cached else None)
                url = jar_meta.get("url") or (cached.get("url") if cached else None)
                summary = jar_meta.get("summary") or (cached.get("summary") if cached else None)

                import re
                mod_display_name = (cached.get("name") if cached else None) or jar_meta["name"] or fname
                mod_display_name = re.sub(r'[-_vV]?\d+(\.\d+)+.*$', '', mod_display_name).strip()
                mod_display_name = re.sub(r'[-_]\d+.*$', '', mod_display_name).strip()
                if not mod_display_name:
                    mod_display_name = jar_meta["name"] or fname

                version_str = jar_meta.get("version")
                if not version_str or version_str == "-":
                    vm = re.search(r'[-_vV](\d+(\.\d+).*)$', clean_stem)
                    if vm:
                        version_str = vm.group(1)
                    elif cached and cached.get("latest_version"):
                        version_str = cached.get("latest_version")
                    else:
                        version_str = "-"

                mods.append({
                    "filename": fname,
                    "id": mod_id,
                    "name": mod_display_name,
                    "version": version_str,
                    "enabled": is_enabled,
                    "size": st.st_size,
                    "modified": st.st_mtime,
                    "modified_str": mtime_str,
                    "icon_url": icon_url,
                    "summary": summary,
                    "url": url,
                    "provider": cached.get("provider", "local") if cached else "local",
                    "source": "file"
                })
            except Exception as e:
                print(f"Error reading mod file {fname}: {e}")

    # 2. Correlate with docker-compose.yml environment mods (Modrinth)
    try:
        base_path = get_instance_path(instance_id)
        compose_path = os.path.join(base_path, "docker-compose.yml")
        if os.path.exists(compose_path):
            with open(compose_path, 'r') as f:
                cdata = yaml.safe_load(f) or {}
            env = cdata.get("services", {}).get("mc", {}).get("environment", {})
            env_dict = {}
            if isinstance(env, list):
                for item in env:
                    if "=" in item:
                        k, v = item.split("=", 1)
                        env_dict[k] = v
            elif isinstance(env, dict):
                env_dict = env

            # Modrinth projects
            m_enabled = [x.strip() for x in env_dict.get("MODRINTH_PROJECTS", "").split(",") if x.strip()]
            m_disabled = [x.strip() for x in env_dict.get("MODRINTH_DISABLED", "").split(",") if x.strip()]
            for mid in m_enabled + m_disabled:
                if mid.lower() not in seen_ids:
                    seen_ids.add(mid.lower())
                    cached = mod_metadata_cache.get(mid.lower())
                    name = cached.get("name", mid) if cached else mid
                    version = cached.get("latest_version", "-") if cached else "-"
                    icon_url = cached.get("icon_url") if cached else None
                    url = cached.get("url", f"https://modrinth.com/mod/{mid}") if cached else f"https://modrinth.com/mod/{mid}"
                    summary = cached.get("summary") if cached else None
                    is_en = mid in m_enabled
                    mods.append({
                        "filename": f"{mid}.jar" if is_en else f"{mid}.jar.disabled",
                        "id": mid,
                        "name": name,
                        "version": version,
                        "enabled": is_en,
                        "size": 0,
                        "modified": 0,
                        "modified_str": "Configured",
                        "icon_url": icon_url,
                        "summary": summary,
                        "url": url,
                        "provider": "modrinth",
                        "source": "env"
                    })

        # 3. Mods bundled in a Modrinth modpack that itzg hasn't downloaded yet (before first start)
        modpack = env_dict.get("MODRINTH_MODPACK", "").strip()
        if modpack and "/" not in modpack:
            excluded = {x.strip().lower() for x in env_dict.get("MODRINTH_EXCLUDE_FILES", "").split(",") if x.strip()}
            pack_version = env_dict.get("MODRINTH_VERSION") or None
            pack_mods = await modpacks.get_mods(base_path, modpack, pack_version)
            # Once installed, a pack mod missing from disk was skipped by itzg (e.g. its built-in
            # client-only exclusions) and won't appear; only list the ones the user excluded.
            installed = modpacks.is_installed(os.path.join(base_path, "data"), pack_version)
            for pm in pack_mods:
                if pm.get("removed"):
                    continue
                fname = pm["filename"]
                mod_id = pm.get("slug") or pm.get("project_id") or fname
                if {fname.lower(), f"{fname}.disabled".lower(), mod_id.lower()} & seen_ids:
                    continue
                is_en = fname.lower() not in excluded
                if installed and is_en:
                    continue
                seen_ids.add(fname.lower())
                mods.append({
                    "filename": fname if is_en else f"{fname}.disabled",
                    "id": mod_id,
                    "name": pm.get("name") or fname,
                    "version": pm.get("version_number") or "-",
                    "enabled": is_en,
                    "size": 0,
                    "modified": 0,
                    "modified_str": "Installs on start",
                    "icon_url": pm.get("icon_url"),
                    "summary": pm.get("summary"),
                    "url": f"https://modrinth.com/mod/{mod_id}" if pm.get("project_id") else None,
                    "provider": "modrinth" if pm.get("project_id") else "local",
                    "source": "modpack"
                })

    except Exception as e:
        print(f"Error checking compose env mods: {e}")

    mods.sort(key=lambda x: x["name"].lower())
    return mods


def set_modpack_mod_excluded(instance_id: str, filename: Optional[str], excluded: bool) -> bool:
    """Exclude (or re-include) a not-yet-downloaded modpack mod via MODRINTH_EXCLUDE_FILES.

    Returns False if the file isn't one of the instance's modpack mods.
    """
    if not filename:
        return False
    base_path = get_instance_path(instance_id)
    fname = filename[:-len(".disabled")] if filename.endswith(".disabled") else filename
    if fname not in modpacks.saved_filenames(base_path):
        return False

    compose_path = os.path.join(base_path, "docker-compose.yml")
    with open(compose_path, 'r') as f:
        cdata = yaml.safe_load(f) or {}
    service = cdata.get("services", {}).get("mc", {})
    env = service.get("environment") or []
    env_map = dict(item.split("=", 1) for item in env if "=" in item) if isinstance(env, list) else dict(env)

    items = [x.strip() for x in env_map.get("MODRINTH_EXCLUDE_FILES", "").split(",") if x.strip()]
    items = [x for x in items if x.lower() != fname.lower()]
    if excluded:
        items.append(fname)
    env_map["MODRINTH_EXCLUDE_FILES"] = ",".join(items)
    env_map["MODRINTH_FORCE_SYNCHRONIZE"] = "true"

    service["environment"] = [f"{k}={v}" for k, v in env_map.items()] if isinstance(env, list) else env_map
    with open(compose_path, 'w') as f:
        yaml.dump(cdata, f, default_flow_style=False, sort_keys=False)
    return True


def mod_file_path(mods_dir: str, filename: str) -> Optional[str]:
    """The path of a file directly inside mods_dir, or None if filename points anywhere else."""
    root = os.path.realpath(mods_dir)
    path = os.path.realpath(os.path.join(root, filename))
    if not path.startswith(root + os.sep) or os.path.dirname(path) != root:
        return None
    return path


class ToggleModRequest(BaseModel):
    filename: Optional[str] = None
    mod_id: Optional[str] = None
    enabled: bool


@app.post("/api/instances/{instance_id}/mods/toggle")
def toggle_instance_mod(instance_id: str, req: ToggleModRequest):
    """Toggle a mod between enabled (.jar) and disabled (.jar.disabled) state."""
    mods_dir = get_instance_mods_dir(instance_id)
    take_pre_update_snapshot(get_instance_path(instance_id), "Before changing mods")
    target_file = None
    new_filename = None

    # Check disk file
    if req.filename:
        full_path = mod_file_path(mods_dir, req.filename)
        if full_path and os.path.exists(full_path):
            target_file = full_path

    # If filename didn't match directly, try by mod_id or stem
    if not target_file and os.path.exists(mods_dir):
        for entry in os.scandir(mods_dir):
            stem = entry.name.replace(".disabled", "").replace(".jar", "")
            if req.filename and stem.lower() in req.filename.lower():
                target_file = entry.path
                break
            if req.mod_id and stem.lower() == req.mod_id.lower():
                target_file = entry.path
                break

    if target_file:
        cur_name = os.path.basename(target_file)
        if req.enabled:
            # Enabling: remove .disabled
            if cur_name.endswith(".disabled"):
                new_name = cur_name[:-9]
                dest = os.path.join(mods_dir, new_name)
                os.rename(target_file, dest)
                new_filename = new_name
            else:
                new_filename = cur_name
        else:
            # Disabling: add .disabled
            if not cur_name.endswith(".disabled"):
                new_name = cur_name + ".disabled"
                dest = os.path.join(mods_dir, new_name)
                os.rename(target_file, dest)
                new_filename = new_name
            else:
                new_filename = cur_name

    # A modpack mod that itzg hasn't downloaded yet is toggled through the pack's exclude list
    if not target_file:
        try:
            if set_modpack_mod_excluded(instance_id, req.filename, not req.enabled):
                new_filename = req.filename.replace(".disabled", "") + ("" if req.enabled else ".disabled")
        except Exception as e:
            print(f"Error updating modpack excludes for mod toggle: {e}")

    # Also update compose environment variables if tracked there
    try:
        base_path = get_instance_path(instance_id)
        compose_path = os.path.join(base_path, "docker-compose.yml")
        if os.path.exists(compose_path):
            with open(compose_path, 'r') as f:
                cdata = yaml.safe_load(f) or {}
            service = cdata.get("services", {}).get("mc", {})
            env = service.get("environment")

            # Helper to update comma lists in env
            def move_in_env(enabled_key, disabled_key, target_id):
                nonlocal env
                is_list = isinstance(env, list)
                env_map = {}
                if is_list:
                    for item in env:
                        if "=" in item:
                            k, v = item.split("=", 1)
                            env_map[k] = v
                elif isinstance(env, dict):
                    env_map = env

                en_list = [x.strip() for x in env_map.get(enabled_key, "").split(",") if x.strip()]
                dis_list = [x.strip() for x in env_map.get(disabled_key, "").split(",") if x.strip()]

                matched = None
                for candidate in en_list + dis_list:
                    if candidate.lower() == target_id.lower():
                        matched = candidate
                        break

                if matched:
                    if req.enabled:
                        dis_list = [x for x in dis_list if x != matched]
                        if matched not in en_list:
                            en_list.append(matched)
                    else:
                        en_list = [x for x in en_list if x != matched]
                        if matched not in dis_list:
                            dis_list.append(matched)

                    env_map[enabled_key] = ",".join(en_list)
                    env_map[disabled_key] = ",".join(dis_list)

                    if is_list:
                        new_env_list = []
                        for k, v in env_map.items():
                            new_env_list.append(f"{k}={v}")
                        service["environment"] = new_env_list
                    else:
                        service["environment"] = env_map

            target_identifier = req.mod_id or (req.filename.replace(".disabled", "").replace(".jar", "") if req.filename else "")
            if target_identifier:
                move_in_env("MODRINTH_PROJECTS", "MODRINTH_DISABLED", target_identifier)

            with open(compose_path, 'w') as f:
                yaml.dump(cdata, f, default_flow_style=False, sort_keys=False)
    except Exception as e:
        print(f"Error updating compose for mod toggle: {e}")

    return {"message": "Mod state updated successfully", "filename": new_filename, "enabled": req.enabled}


class DeleteModRequest(BaseModel):
    filename: Optional[str] = None
    mod_id: Optional[str] = None


@app.post("/api/instances/{instance_id}/mods/delete")
@app.delete("/api/instances/{instance_id}/mods")
def delete_instance_mod(instance_id: str, req: DeleteModRequest):
    """Delete a mod file from an instance and remove it from compose configuration."""
    mods_dir = get_instance_mods_dir(instance_id)
    take_pre_update_snapshot(get_instance_path(instance_id), "Before changing mods")
    deleted = False

    # Check file
    if req.filename:
        for fname in [req.filename, req.filename + ".disabled", req.filename.replace(".disabled", "")]:
            p = mod_file_path(mods_dir, fname)
            if p and os.path.isfile(p):
                os.remove(p)
                deleted = True
                break

    if not deleted and req.mod_id and os.path.exists(mods_dir):
        for entry in os.scandir(mods_dir):
            stem = entry.name.replace(".disabled", "").replace(".jar", "")
            if stem.lower() == req.mod_id.lower():
                os.remove(entry.path)
                deleted = True
                break

    # A modpack mod that itzg hasn't downloaded yet is removed by excluding it from the pack
    if not deleted:
        try:
            if set_modpack_mod_excluded(instance_id, req.filename, True):
                modpacks.mark_removed(get_instance_path(instance_id), req.filename.replace(".disabled", ""))
                deleted = True
        except Exception as e:
            print(f"Error updating modpack excludes for mod delete: {e}")

    # Remove from docker-compose.yml
    try:
        base_path = get_instance_path(instance_id)
        compose_path = os.path.join(base_path, "docker-compose.yml")
        if os.path.exists(compose_path):
            with open(compose_path, 'r') as f:
                cdata = yaml.safe_load(f) or {}
            service = cdata.get("services", {}).get("mc", {})
            env = service.get("environment")

            is_list = isinstance(env, list)
            env_map = {}
            if is_list:
                for item in env:
                    if "=" in item:
                        k, v = item.split("=", 1)
                        env_map[k] = v
            elif isinstance(env, dict):
                env_map = env

            target = (req.mod_id or req.filename or "").replace(".disabled", "").replace(".jar", "").lower()

            for key in ["MODRINTH_PROJECTS", "MODRINTH_DISABLED"]:
                if key in env_map:
                    items = [x.strip() for x in env_map[key].split(",") if x.strip()]
                    items = [x for x in items if x.lower() != target]
                    env_map[key] = ",".join(items)

            if is_list:
                new_env = [f"{k}={v}" for k, v in env_map.items()]
                service["environment"] = new_env
            else:
                service["environment"] = env_map

            with open(compose_path, 'w') as f:
                yaml.dump(cdata, f, default_flow_style=False, sort_keys=False)
            deleted = True
    except Exception as e:
        print(f"Error removing mod from compose: {e}")

    return {"message": "Mod deleted successfully", "deleted": deleted}


@app.post("/api/instances/{instance_id}/mods/upload")
async def upload_instance_mod(instance_id: str, file: UploadFile = File(...)):
    """Upload a custom mod jar or zip to the instance mods directory."""
    if not file.filename.lower().endswith((".jar", ".zip", ".disabled")):
        raise HTTPException(status_code=400, detail="Only .jar or .zip mod files are allowed")

    mods_dir = get_instance_mods_dir(instance_id)
    await asyncio.to_thread(take_pre_update_snapshot, get_instance_path(instance_id), "Before changing mods")
    dest_path = os.path.join(mods_dir, file.filename)

    with open(dest_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    meta = parse_mod_jar_metadata(dest_path)
    return {
        "message": f"Mod {file.filename} uploaded successfully",
        "filename": file.filename,
        "name": meta["name"],
        "version": meta["version"]
    }


def bedrock_addon_context(instance_id: str) -> Tuple[str, str, dict]:
    """(instance path, data dir, compose env) for a Bedrock instance; 400 for a Java one."""
    path = get_instance_path(instance_id)
    env = read_compose_env(path)
    if not bedrock.is_bedrock(env.get("TYPE")):
        raise HTTPException(status_code=400, detail="Add-ons are only for Bedrock servers.")
    return path, os.path.join(path, "data"), env


@app.get("/api/instances/{instance_id}/addons")
def list_bedrock_addons(instance_id: str):
    """Behavior and resource packs installed on a Bedrock server, and which the world has on."""
    _, data_dir, env = bedrock_addon_context(instance_id)
    try:
        return bedrock_addons.list_addons(data_dir, env)
    except bedrock_addons.AddonError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/instances/{instance_id}/addons/upload")
def upload_bedrock_addon(instance_id: str, file: UploadFile = File(...), type: Optional[str] = Form(None)):
    """Install a .mcpack or .mcaddon and turn its packs on for the world.

    type="resource" is the Resource Packs tab: only a .mcpack holding resource packs is installed.
    """
    path, data_dir, env = bedrock_addon_context(instance_id)
    filename = os.path.basename(file.filename or "")
    if type not in (None, "resource"):
        raise HTTPException(status_code=400, detail="type must be resource or left out.")
    extensions = bedrock_addons.RESOURCE_PACK_EXTENSIONS if type == "resource" else bedrock_addons.ADDON_EXTENSIONS
    if not filename.lower().endswith(extensions):
        detail = "Only .mcpack files can be installed as resource packs." if type == "resource" else "Only .mcpack and .mcaddon files can be installed."
        raise HTTPException(status_code=400, detail=detail)
    take_pre_update_snapshot(path, "Before changing add-ons")
    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
        shutil.copyfileobj(file.file, tmp)
    try:
        installed = bedrock_addons.install_addon(data_dir, tmp.name, filename, env, kind=type)
    except bedrock_addons.AddonError as e:
        raise HTTPException(status_code=400, detail=f"{filename} wasn't installed. {e}")
    finally:
        os.remove(tmp.name)
    return {"message": f"Installed {filename}", "installed": installed}


class AddonRequest(BaseModel):
    uuid: str
    enabled: Optional[bool] = None


@app.post("/api/instances/{instance_id}/addons/toggle")
def toggle_bedrock_addon(instance_id: str, req: AddonRequest):
    """Turn an installed pack on or off for the world, keeping its files."""
    path, data_dir, env = bedrock_addon_context(instance_id)
    if req.enabled is None:
        raise HTTPException(status_code=400, detail="enabled is required")
    take_pre_update_snapshot(path, "Before changing add-ons")
    try:
        bedrock_addons.toggle_addon(data_dir, req.uuid, req.enabled, env)
    except bedrock_addons.AddonError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"message": "Add-on enabled" if req.enabled else "Add-on disabled"}


@app.post("/api/instances/{instance_id}/addons/delete")
def delete_bedrock_addon(instance_id: str, req: AddonRequest):
    """Turn a pack off for the world and delete its files."""
    path, data_dir, env = bedrock_addon_context(instance_id)
    take_pre_update_snapshot(path, "Before changing add-ons")
    try:
        bedrock_addons.remove_addon(data_dir, req.uuid, env)
    except bedrock_addons.AddonError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"message": "Add-on removed"}


async def sync_instance_mods_to_disk(instance_id: str, env: Optional[dict] = None):
    """
    Download missing configured mod jar files for an instance directly into data/mods/ 
    so they exist immediately when configured/saved rather than waiting for server boot.
    Returns the mod ids it downloaded and the ones it could not.
    """
    path = get_instance_path(instance_id)
    mods_dir = get_instance_mods_dir(instance_id)
    os.makedirs(mods_dir, exist_ok=True)

    if env is None:
        compose_path = os.path.join(path, "docker-compose.yml")
        if not os.path.exists(compose_path):
            return {"downloaded": [], "failed": []}
        with open(compose_path, "r") as f:
            cdata = yaml.safe_load(f) or {}
        env_raw = cdata.get("services", {}).get("mc", {}).get("environment", {})
        env = {}
        if isinstance(env_raw, list):
            for item in env_raw:
                if "=" in item:
                    k, v = item.split("=", 1)
                    env[k] = v
        elif isinstance(env_raw, dict):
            env = env_raw

    mc_version = env.get("VERSION", "").strip()
    raw_loader = env.get("TYPE", "VANILLA").strip().lower()
    if is_plugin_server(raw_loader):
        mod_loaders = PLUGIN_SERVER_LOADERS[raw_loader.upper()]
    elif raw_loader == "fabric":
        mod_loaders = ["fabric", "quilt"]
    elif raw_loader == "quilt":
        mod_loaders = ["quilt", "fabric"]
    elif raw_loader == "neoforge":
        mod_loaders = ["neoforge", "forge"]
    elif raw_loader == "forge":
        mod_loaders = ["forge"]
    else:
        mod_loaders = [raw_loader] if raw_loader != "vanilla" else []

    # Collect existing mod files and parsed stems on disk
    existing_stems = set()
    existing_ids = set()
    if os.path.exists(mods_dir):
        for entry in os.scandir(mods_dir):
            if entry.is_file() and (entry.name.lower().endswith(".jar") or entry.name.lower().endswith(".jar.disabled")):
                stem = entry.name.lower().replace(".disabled", "").replace(".jar", "")
                existing_stems.add(stem)
                try:
                    meta = parse_mod_jar_metadata(entry.path)
                    if meta.get("id"):
                        existing_ids.add(meta["id"].lower())
                except:
                    pass

    def is_mod_on_disk(mid: str) -> bool:
        clean = mid.lower().strip()
        clean_no_hyphen = clean.replace("-", "").replace("_", "")
        if clean in existing_ids:
            return True
        for stem in existing_stems:
            stem_no_hyphen = stem.replace("-", "").replace("_", "")
            if clean == stem or clean_no_hyphen == stem_no_hyphen or clean in stem or stem in clean:
                return True
        return False

    m_enabled = [x.strip() for x in env.get("MODRINTH_PROJECTS", "").split(",") if x.strip()]
    m_disabled = [x.strip() for x in env.get("MODRINTH_DISABLED", "").split(",") if x.strip()]
    downloaded, failed = [], []

    async with httpx.AsyncClient(timeout=45.0, follow_redirects=True) as client:
        # 1. Modrinth
        for mid in m_enabled + m_disabled:
            if is_mod_on_disk(mid):
                continue
            is_disabled = mid in m_disabled
            try:
                versions = []
                params = {}
                if mod_loaders:
                    params["loaders"] = json.dumps(mod_loaders)
                if mc_version:
                    params["game_versions"] = json.dumps([mc_version])

                res = await client.get(f"https://api.modrinth.com/v2/project/{mid}/version", params=params)
                if res.status_code == 200:
                    versions = res.json()

                if not versions and mod_loaders:
                    res_fb = await client.get(f"https://api.modrinth.com/v2/project/{mid}/version", params={"loaders": json.dumps(mod_loaders)})
                    if res_fb.status_code == 200:
                        versions = res_fb.json()

                if not versions:
                    res_fb = await client.get(f"https://api.modrinth.com/v2/project/{mid}/version")
                    if res_fb.status_code == 200:
                        versions = res_fb.json()

                if versions and isinstance(versions, list) and len(versions) > 0:
                    chosen = versions[0]
                    files = chosen.get("files", [])
                    primary = next((f for f in files if f.get("primary")), files[0] if files else None)
                    if primary and primary.get("url"):
                        target_fname = primary.get("filename") or f"{mid}.jar"
                        if is_disabled and not target_fname.endswith(".disabled"):
                            target_fname += ".disabled"
                        dest_path = os.path.join(mods_dir, target_fname)
                        async with client.stream("GET", primary["url"]) as dl_res:
                            if dl_res.status_code == 200:
                                with open(dest_path, "wb") as f_out:
                                    async for chunk in dl_res.aiter_bytes():
                                        f_out.write(chunk)
                                existing_stems.add(target_fname.lower().replace(".disabled", "").replace(".jar", ""))
                                existing_ids.add(mid.lower())
                                downloaded.append(mid)
                                print(f"Synced Modrinth mod {mid} -> {target_fname} ({os.path.getsize(dest_path)} bytes)")
                                continue
                failed.append(mid)
            except Exception as e:
                failed.append(mid)
                print(f"Error syncing Modrinth mod {mid}: {e}")

    return {"downloaded": downloaded, "failed": failed}



@app.post("/api/instances/{instance_id}/mods/sync")
async def sync_instance_mods(instance_id: str):
    """Explicitly synchronize missing mods to data/mods on disk."""
    try:
        result = await sync_instance_mods_to_disk(instance_id)
        return {"message": "Mods synchronized successfully", **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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

class FileCreateRequest(BaseModel):
    path: str = "."
    name: str
    is_dir: bool = False

class FileRenameRequest(BaseModel):
    path: str
    new_name: str

class FileMoveCopyRequest(BaseModel):
    source_paths: List[str]
    destination_dir: str = "."
    collision_strategy: str = "fail"  # "fail", "overwrite", "rename_new"

class FileDeleteRequest(BaseModel):
    paths: List[str]

def get_safe_target_path(base_path: str, rel_path: str) -> str:
    base = os.path.realpath(base_path)
    clean_rel = rel_path.lstrip("/\\")
    target = os.path.realpath(os.path.join(base, clean_rel))
    if target == base:
        return base
    if not target.startswith(base + os.sep):
        raise HTTPException(status_code=403, detail="Access denied: Path traversal detected")
    return target

def get_unique_name(target_dir: str, name: str) -> str:
    base_name, ext = os.path.splitext(name)
    counter = 1
    new_name = name
    while os.path.exists(os.path.join(target_dir, new_name)):
        if ext:
            new_name = f"{base_name} ({counter}){ext}"
        else:
            new_name = f"{base_name} ({counter})"
        counter += 1
    return new_name

def cleanup_temp_file(path: str):
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception:
        pass

def core_create_file_or_dir(base_path: str, req: FileCreateRequest):
    target_dir = get_safe_target_path(base_path, req.path)
    if not os.path.exists(target_dir):
        os.makedirs(target_dir, exist_ok=True)
    target = get_safe_target_path(target_dir, req.name)
    if os.path.exists(target):
        raise HTTPException(status_code=409, detail="An item with that name already exists")
    if req.is_dir:
        os.makedirs(target, exist_ok=True)
    else:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, 'w', encoding='utf-8') as f:
            pass
    return {"success": True, "name": req.name, "is_dir": req.is_dir}

def core_rename_file_or_dir(base_path: str, req: FileRenameRequest):
    src = get_safe_target_path(base_path, req.path)
    if not os.path.exists(src):
        raise HTTPException(status_code=404, detail="Item not found")
    parent_dir = os.path.dirname(src)
    dst = get_safe_target_path(parent_dir, req.new_name)
    if os.path.exists(dst):
        raise HTTPException(status_code=409, detail="An item with that name already exists")
    os.rename(src, dst)
    return {"success": True, "name": req.new_name}

def core_move_files(base_path: str, req: FileMoveCopyRequest):
    dst_dir = get_safe_target_path(base_path, req.destination_dir)
    if not os.path.isdir(dst_dir):
        raise HTTPException(status_code=400, detail="Destination must be a directory")
    
    if req.collision_strategy == "fail":
        conflicts = [
            os.path.basename(p.rstrip("/\\"))
            for p in req.source_paths
            if os.path.exists(get_safe_target_path(dst_dir, os.path.basename(p.rstrip("/\\"))))
        ]
        if conflicts:
            raise HTTPException(status_code=409, detail=f"Conflicts detected: {', '.join(conflicts)}")

    moved = []
    for p in req.source_paths:
        src = get_safe_target_path(base_path, p)
        if not os.path.exists(src):
            continue
        if os.path.isdir(src) and (dst_dir == src or dst_dir.startswith(src + os.sep)):
            continue
        name = os.path.basename(src)
        final_name = name
        target = os.path.join(dst_dir, final_name)
        if os.path.exists(target):
            if req.collision_strategy == "rename_new":
                final_name = get_unique_name(dst_dir, name)
                target = os.path.join(dst_dir, final_name)
            elif req.collision_strategy == "overwrite":
                if os.path.isdir(target):
                    shutil.rmtree(target)
                else:
                    os.remove(target)
        shutil.move(src, target)
        moved.append(final_name)
    return {"success": True, "moved": moved}

def core_copy_files(base_path: str, req: FileMoveCopyRequest):
    dst_dir = get_safe_target_path(base_path, req.destination_dir)
    if not os.path.isdir(dst_dir):
        raise HTTPException(status_code=400, detail="Destination must be a directory")

    if req.collision_strategy == "fail":
        conflicts = [
            os.path.basename(p.rstrip("/\\"))
            for p in req.source_paths
            if os.path.exists(get_safe_target_path(dst_dir, os.path.basename(p.rstrip("/\\"))))
        ]
        if conflicts:
            raise HTTPException(status_code=409, detail=f"Conflicts detected: {', '.join(conflicts)}")

    copied = []
    for p in req.source_paths:
        src = get_safe_target_path(base_path, p)
        if not os.path.exists(src):
            continue
        name = os.path.basename(src)
        final_name = name
        target = os.path.join(dst_dir, final_name)
        if os.path.exists(target):
            if req.collision_strategy == "rename_new":
                final_name = get_unique_name(dst_dir, name)
                target = os.path.join(dst_dir, final_name)
            elif req.collision_strategy == "overwrite":
                if os.path.isdir(target):
                    shutil.rmtree(target)
                else:
                    os.remove(target)
        if os.path.isdir(src):
            shutil.copytree(src, target)
        else:
            shutil.copy2(src, target)
        copied.append(final_name)
    return {"success": True, "copied": copied}

def core_delete_files(base_path: str, req: FileDeleteRequest):
    deleted = []
    for p in req.paths:
        target = get_safe_target_path(base_path, p)
        if os.path.isdir(target):
            shutil.rmtree(target)
            deleted.append(p)
        elif os.path.isfile(target):
            os.remove(target)
            deleted.append(p)
    return {"success": True, "deleted": deleted}

def core_upload_files(base_path: str, files: List[UploadFile], path: str = ".", collision_strategy: str = "overwrite"):
    dst_dir = get_safe_target_path(base_path, path)
    os.makedirs(dst_dir, exist_ok=True)
    uploaded = []
    for f in files:
        filename = os.path.basename(f.filename or "uploaded_file")
        if collision_strategy == "rename_new" and os.path.exists(os.path.join(dst_dir, filename)):
            filename = get_unique_name(dst_dir, filename)
        target = os.path.join(dst_dir, filename)
        with open(target, "wb") as out:
            shutil.copyfileobj(f.file, out)
        uploaded.append(filename)
    return {"success": True, "uploaded": uploaded}

def core_download_files(base_path: str, background_tasks: BackgroundTasks, path: str = ".", paths: Optional[str] = None):
    if paths:
        path_list = [p.strip() for p in paths.split(",") if p.strip()]
        if not path_list:
            raise HTTPException(status_code=400, detail="No paths specified")
        
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        tmp.close()
        with zipfile.ZipFile(tmp.name, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for p in path_list:
                item_target = get_safe_target_path(base_path, p)
                if not os.path.exists(item_target):
                    continue
                if os.path.isfile(item_target):
                    zipf.write(item_target, arcname=os.path.basename(item_target))
                elif os.path.isdir(item_target):
                    base_dir_name = os.path.basename(item_target.rstrip("/\\"))
                    for root, _, flist in os.walk(item_target):
                        for f in flist:
                            full_f = os.path.join(root, f)
                            rel_f = os.path.relpath(full_f, os.path.dirname(item_target))
                            zipf.write(full_f, arcname=rel_f)
        background_tasks.add_task(cleanup_temp_file, tmp.name)
        return FileResponse(tmp.name, media_type="application/zip", filename="archive.zip")

    target = get_safe_target_path(base_path, path)
    if not os.path.exists(target):
        raise HTTPException(status_code=404, detail="File or folder not found")
    
    if os.path.isfile(target):
        return FileResponse(target, filename=os.path.basename(target))
    
    # Directory download as zip
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp.close()
    folder_name = os.path.basename(target.rstrip("/\\")) or "folder"
    with zipfile.ZipFile(tmp.name, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, _, flist in os.walk(target):
            for f in flist:
                full_f = os.path.join(root, f)
                rel_f = os.path.relpath(full_f, target)
                zipf.write(full_f, arcname=rel_f)
    background_tasks.add_task(cleanup_temp_file, tmp.name)
    return FileResponse(tmp.name, media_type="application/zip", filename=f"{folder_name}.zip")

# Instance file operations
@app.post("/api/instances/{instance_id}/files/create")
def instance_create_file(instance_id: str, req: FileCreateRequest):
    base_path = get_instance_path(instance_id)
    return core_create_file_or_dir(base_path, req)

@app.post("/api/instances/{instance_id}/files/rename")
def instance_rename_file(instance_id: str, req: FileRenameRequest):
    base_path = get_instance_path(instance_id)
    return core_rename_file_or_dir(base_path, req)

@app.post("/api/instances/{instance_id}/files/move")
def instance_move_files(instance_id: str, req: FileMoveCopyRequest):
    base_path = get_instance_path(instance_id)
    return core_move_files(base_path, req)

@app.post("/api/instances/{instance_id}/files/copy")
def instance_copy_files(instance_id: str, req: FileMoveCopyRequest):
    base_path = get_instance_path(instance_id)
    return core_copy_files(base_path, req)

@app.post("/api/instances/{instance_id}/files/delete")
def instance_delete_files(instance_id: str, req: FileDeleteRequest):
    base_path = get_instance_path(instance_id)
    return core_delete_files(base_path, req)

@app.post("/api/instances/{instance_id}/files/upload")
def instance_upload_files(
    instance_id: str,
    files: List[UploadFile] = File(...),
    path: str = Form("."),
    collision_strategy: str = Form("overwrite")
):
    base_path = get_instance_path(instance_id)
    return core_upload_files(base_path, files, path, collision_strategy)

@app.get("/api/instances/{instance_id}/files/download")
def instance_download_files(
    instance_id: str,
    background_tasks: BackgroundTasks,
    path: str = ".",
    paths: Optional[str] = None
):
    base_path = get_instance_path(instance_id)
    return core_download_files(base_path, background_tasks, path, paths)

# Global file operations
@app.post("/api/files/create")
def global_create_file(req: FileCreateRequest):
    base_path = os.path.abspath(SERVERS_DIR)
    return core_create_file_or_dir(base_path, req)

@app.post("/api/files/rename")
def global_rename_file(req: FileRenameRequest):
    base_path = os.path.abspath(SERVERS_DIR)
    return core_rename_file_or_dir(base_path, req)

@app.post("/api/files/move")
def global_move_files(req: FileMoveCopyRequest):
    base_path = os.path.abspath(SERVERS_DIR)
    return core_move_files(base_path, req)

@app.post("/api/files/copy")
def global_copy_files(req: FileMoveCopyRequest):
    base_path = os.path.abspath(SERVERS_DIR)
    return core_copy_files(base_path, req)

@app.post("/api/files/delete")
def global_delete_files(req: FileDeleteRequest):
    base_path = os.path.abspath(SERVERS_DIR)
    return core_delete_files(base_path, req)

@app.post("/api/files/upload")
def global_upload_files(
    files: List[UploadFile] = File(...),
    path: str = Form("."),
    collision_strategy: str = Form("overwrite")
):
    base_path = os.path.abspath(SERVERS_DIR)
    return core_upload_files(base_path, files, path, collision_strategy)

@app.get("/api/files/download")
def global_download_files(
    background_tasks: BackgroundTasks,
    path: str = ".",
    paths: Optional[str] = None
):
    base_path = os.path.abspath(SERVERS_DIR)
    return core_download_files(base_path, background_tasks, path, paths)

@app.get("/api/system/info", response_model=SystemInfo)
def get_system_info():
    return {
        "version": get_current_version(),
        "is_docker": os.path.exists("/.dockerenv")
    }

async def get_latest_release():
    """Fetches the latest release info from GitHub API."""
    curr_v = get_current_version()
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            headers = {"Accept": "application/vnd.github.v3+json"}
            res = await client.get(f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest", headers=headers, timeout=10)
            
            if res.status_code == 200:
                data = res.json()
                latest_v = data.get("tag_name", "Unknown")
                return {
                    "current_version": curr_v,
                    "latest_version": latest_v,
                    "has_update": latest_v != curr_v,
                    "release_notes": data.get("body", "No release notes available."),
                    "published_at": data.get("published_at"),
                    "can_self_update": self_update_compose_file() is not None or self_update.can_install(data, GITHUB_REPO),
                    "failed_version": self_update.failed_version(SERVERS_DIR),
                    "bundle": self_update.find_bundle(data, GITHUB_REPO),
                }
            elif res.status_code == 404:
                return {
                    "current_version": curr_v,
                    "latest_version": curr_v,
                    "has_update": False,
                    "release_notes": "You are running the latest version of Isopod.",
                    "published_at": None
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
    self_update.mark_started(SERVERS_DIR, ISOPOD_VERSION)
    # Start the periodic update check in the background
    asyncio.create_task(update_check_loop())
    asyncio.create_task(backup_schedule_loop())
    threading.Thread(target=crash_watchdog.run, args=(get_docker_client,), daemon=True, name="crash-watchdog").start()

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
            curr_v = get_current_version()
            return {
                "current_version": curr_v,
                "latest_version": curr_v,
                "has_update": False,
                "release_notes": "Could not connect to update service."
            }
    
    return cached_update_info

async def update_in_place():
    """Install the latest release's bundle, then restart into it."""
    global cached_update_info

    info = await get_latest_release()
    bundle = info.get("bundle") if info else None
    if not info or not info.get("has_update"):
        raise HTTPException(status_code=409, detail="There's no update to install.")
    if not bundle or self_update.image_rev() is None:
        raise HTTPException(status_code=409, detail="This install can't update itself. Run the update commands on the machine hosting Isopod.")
    try:
        await asyncio.to_thread(self_update.install, bundle, SERVERS_DIR)
    except self_update.UpdateError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        print(f"Self-update failed: {e}")
        raise HTTPException(status_code=500, detail="The update couldn't be installed. Isopod wasn't changed.")

    cached_update_info = None

    async def restart():
        await asyncio.sleep(1)
        await asyncio.to_thread(self_update.stop_docker_daemon)
        os._exit(0)

    asyncio.create_task(restart())
    return {
        "status": "initiated",
        "message": f"Installed {bundle['tag']}. Isopod is restarting.",
        "version": bundle["tag"],
    }

@app.post("/api/system/update")
async def perform_update():
    """
    Attempts to update the launcher by pulling the latest code/images 
    and rebuilding/restarting the container via the mounted Docker socket.
    """
    global cached_update_info

    compose_file = self_update_compose_file()
    if compose_file is None:
        return await update_in_place()

    cached_update_info = None  # Immediately clear cached update info

    async def trigger_restart():
        await asyncio.sleep(2)

        has_build = False
        try:
            with open(compose_file, "r", encoding="utf-8") as cf:
                content = cf.read()
                if "build:" in content or "build :" in content:
                    has_build = True
        except Exception:
            pass

        try:
            if os.path.exists(".git"):
                print("Git repository detected. Pulling latest code...")
                try:
                    subprocess.run(["git", "pull"], check=False, timeout=30)
                except Exception as ge:
                    print(f"Git pull warning: {ge}")

            if has_build:
                cmd = ["docker", "compose", "-f", compose_file, "up", "-d", "--build"]
            else:
                cmd = ["docker", "compose", "-f", compose_file, "up", "-d", "--pull", "always"]

            print(f"Executing update sequence: {' '.join(cmd)}")
            subprocess.Popen(cmd, start_new_session=True)
        except Exception as e:
            print(f"Self-update trigger failed: {e}")

    asyncio.create_task(trigger_restart())
    
    return {
        "status": "initiated",
        "message": "Update sequence initiated. The container will rebuild and restart."
    }

@app.get("/api/system/logs/export")
def export_system_logs():
    """
    Exports application diagnostics and system logs for troubleshooting.
    """
    settings = get_settings()
    client = get_docker_client()
    docker_status = "Available" if client else "Unavailable"
    
    instances = []
    if os.path.exists(SERVERS_DIR):
        for item in os.listdir(SERVERS_DIR):
            item_path = os.path.join(SERVERS_DIR, item)
            if os.path.isdir(item_path) and os.path.exists(os.path.join(item_path, "docker-compose.yml")):
                instances.append(item)

    report_lines = [
        "==================================================",
        "              ISOPOD APPLICATION LOGS              ",
        "==================================================",
        f"Export Timestamp : {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}",
        f"Isopod Version   : {ISOPOD_VERSION}",
        f"Docker Client    : {docker_status}",
        f"Docker Socket    : {settings.get('dockerSocket', '/var/run/docker.sock')}",
        f"Managed Instances: {len(instances)} ({', '.join(instances) if instances else 'None'})",
        "",
        "--- [Application Settings] ---",
        json.dumps(settings, indent=2),
        "",
        "--- [System Environment] ---",
        f"Operating System : {os.name}",
        f"Working Dir      : {os.getcwd()}",
        f"Servers Dir      : {SERVERS_DIR}",
        "",
        "--- [Diagnostics Summary] ---",
        f"Update Cache     : {json.dumps(cached_update_info) if cached_update_info else 'Not populated'}",
        "==================================================",
        "End of Diagnostics Log",
        "=================================================="
    ]
    log_content = "\n".join(report_lines)
    return Response(
        content=log_content,
        media_type="text/plain",
        headers={"Content-Disposition": "attachment; filename=isopod_application_logs.txt"}
    )

# Mount the compiled frontend to be served statically


# Ensure '/app/frontend/dist' exists or gracefully ignore if not fully built locally
dist_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(dist_path):
    app.mount("/", StaticFiles(directory=dist_path, html=True), name="frontend")
else:
    # Docker container path
    app.mount("/", StaticFiles(directory="/app/frontend/dist", html=True), name="frontend")

