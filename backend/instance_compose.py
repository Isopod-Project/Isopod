import os
import re


def uses_host_docker() -> bool:
    return os.getenv("ISOPOD_DOCKER_MODE") == "host"


def project_name(instance_id: str) -> str:
    slug = re.sub(r"[^a-z0-9_-]", "", instance_id.lower()).lstrip("-_")
    return f"isopod-instance-{slug}" if uses_host_docker() else slug


def project_names(instance_id: str) -> tuple[str, ...]:
    name = project_name(instance_id)
    if uses_host_docker() or name == instance_id:
        return (name,)
    return (name, instance_id)


def command(instance_path: str, *args: str) -> list[str]:
    cmd = ["docker", "compose"]
    if uses_host_docker():
        cmd += ["--project-name", project_name(os.path.basename(instance_path)), "-f", "docker-compose.yml"]
    return cmd + list(args)
