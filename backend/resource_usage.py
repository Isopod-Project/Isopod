"""Live CPU and RAM usage for running instances, read from Docker container stats.

CPU percentages are normalised to the whole host (100% means every core is busy), so a
server's share and the overall total use the same scale. RAM usage excludes reclaimable
page cache, matching what `docker stats` reports.
"""
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional

COMPOSE_PROJECT_LABEL = "com.docker.compose.project"

MEMORY_UNITS = {"": 1, "B": 1, "K": 1024, "M": 1024 ** 2, "G": 1024 ** 3, "T": 1024 ** 4}


def parse_memory(value: Optional[str]) -> Optional[int]:
    """Convert a MEMORY setting such as "2G" or "512M" into bytes."""
    if not value:
        return None
    m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*([BKMGT]?)B?\s*", str(value).upper())
    if not m:
        return None
    return int(float(m.group(1)) * MEMORY_UNITS[m.group(2)])


def memory_used(stats: dict) -> int:
    """Container memory in use, minus reclaimable cache (cgroup v1 and v2)."""
    mem = stats.get("memory_stats") or {}
    usage = mem.get("usage") or 0
    detail = mem.get("stats") or {}
    for key in ("inactive_file", "total_inactive_file"):
        if key in detail:
            return max(usage - detail[key], 0)
    return max(usage - detail.get("cache", 0), 0)


def cpu_percent(stats: dict) -> float:
    """CPU use between the two samples in a stats snapshot, as a share of the whole host."""
    cpu = stats.get("cpu_stats") or {}
    pre = stats.get("precpu_stats") or {}
    cpu_delta = (cpu.get("cpu_usage") or {}).get("total_usage", 0) - (pre.get("cpu_usage") or {}).get("total_usage", 0)
    system_delta = cpu.get("system_cpu_usage", 0) - pre.get("system_cpu_usage", 0)
    if cpu_delta <= 0 or system_delta <= 0:
        return 0.0
    return cpu_delta / system_delta * 100.0


def _container_stats(container) -> Optional[dict]:
    try:
        stats = container.stats(stream=False)
    except Exception as e:
        print(f"Error reading stats for {container.name}: {e}")
        return None
    return {"cpu_percent": cpu_percent(stats), "memory_used": memory_used(stats)}


def collect(client, instance_ids: List[str], allocated: Dict[str, Optional[int]]) -> dict:
    """Usage for every running instance plus host totals.

    `allocated` maps instance id to its configured MEMORY in bytes (None when unknown).
    """
    project_to_instance = {}
    for instance_id in instance_ids:
        sanitized = "".join(c for c in instance_id if c.isalnum() or c in ("-", "_")).lower()
        project_to_instance.setdefault(instance_id, instance_id)
        project_to_instance[sanitized] = instance_id

    containers = [
        c for c in client.containers.list(filters={"label": COMPOSE_PROJECT_LABEL})
        if c.labels.get(COMPOSE_PROJECT_LABEL) in project_to_instance
    ]

    # `stats(stream=False)` blocks for about a second per container while Docker takes two
    # samples, so read them in parallel.
    with ThreadPoolExecutor(max_workers=max(len(containers), 1)) as pool:
        results = list(pool.map(_container_stats, containers))

    instances: Dict[str, dict] = {}
    for container, result in zip(containers, results):
        if result is None:
            continue
        instance_id = project_to_instance[container.labels[COMPOSE_PROJECT_LABEL]]
        entry = instances.setdefault(instance_id, {
            "cpu_percent": 0.0,
            "memory_used": 0,
            "memory_allocated": allocated.get(instance_id),
        })
        entry["cpu_percent"] += result["cpu_percent"]
        entry["memory_used"] += result["memory_used"]

    try:
        info = client.info()
    except Exception:
        info = {}

    return {
        "instances": {k: {**v, "cpu_percent": round(v["cpu_percent"], 1)} for k, v in instances.items()},
        "total": {
            "cpu_percent": round(sum(v["cpu_percent"] for v in instances.values()), 1),
            "memory_used": sum(v["memory_used"] for v in instances.values()),
            "memory_allocated": sum(v["memory_allocated"] or 0 for v in instances.values()),
            "host_memory": info.get("MemTotal"),
            "host_cpus": info.get("NCPU"),
        },
    }
