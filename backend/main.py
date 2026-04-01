import os
import subprocess
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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
    result = subprocess.run(["docker", "compose", "up", "-d"], cwd=path, capture_output=True, text=True)
    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=result.stderr)
    return {"message": "Started instance"}

@app.post("/api/instances/{instance_id}/stop")
def stop_instance(instance_id: str):
    path = get_instance_path(instance_id)
    result = subprocess.run(["docker", "compose", "down"], cwd=path, capture_output=True, text=True)
    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=result.stderr)
    return {"message": "Stopped instance"}

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
