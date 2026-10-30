"""Bedrock add-ons: behavior and resource packs installed from .mcpack and .mcaddon files.

Bedrock Dedicated Server loads packs from data/behavior_packs/<folder>/ and
data/resource_packs/<folder>/, and turns them on per world in
data/worlds/<level name>/world_behavior_packs.json and world_resource_packs.json,
which list each pack's uuid and version from its manifest.json.

A .mcpack holds one pack. A .mcaddon holds several, as folders or as nested .mcpack files,
usually a behavior pack and the resource pack it depends on. Both halves are installed.
"""
import io
import json
import os
import re
import shutil
import stat
import tempfile
import uuid as uuidlib
import zipfile
from typing import Dict, List, Optional, Tuple

ADDON_EXTENSIONS = (".mcpack", ".mcaddon")
# The Resource Packs tab takes single packs only; a .mcaddon belongs in the Add-ons tab
RESOURCE_PACK_EXTENSIONS = (".mcpack",)

# Pack kind -> (folder under data/, world file that turns packs on)
PACK_DIRS = {
    "behavior": ("behavior_packs", "world_behavior_packs.json"),
    "resource": ("resource_packs", "world_resource_packs.json"),
}

# manifest.json module types -> pack kind
MODULE_KINDS = {"data": "behavior", "script": "behavior", "javascript": "behavior", "resources": "resource"}
NOT_ADDON_MODULES = {"skin_pack": "a skin pack", "world_template": "a world template"}

DEFAULT_LEVEL_NAME = "Bedrock level"

# Limits on what an upload may unpack to, so a zip bomb can't fill the disk
MAX_ENTRIES = 20000
MAX_UNPACKED_BYTES = 1024 * 1024 * 1024
MAX_NESTED_BYTES = 256 * 1024 * 1024

# Packs BDS ships in behavior_packs/ and resource_packs/. They're hidden unless a world turns one on.
BUILTIN_PACK_RE = re.compile(r"^(vanilla|chemistry|experimental|editor|server_)", re.IGNORECASE)

FORMATTING_CODE_RE = re.compile(r"§.")


class AddonError(ValueError):
    """An upload or change that can't be done. The message is shown to the user."""


# ---------- manifest.json ----------

def _strip_json_comments(text: str) -> str:
    """Remove // and /* */ comments, which Bedrock allows in its JSON files, outside of strings."""
    out = []
    i, n = 0, len(text)
    in_string = False
    while i < n:
        c = text[i]
        if in_string:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 1
            elif c == '"':
                in_string = False
        elif c == '"':
            in_string = True
            out.append(c)
        elif text.startswith("//", i):
            end = text.find("\n", i)
            i = n if end == -1 else end
            continue
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            i = n if end == -1 else end + 2
            continue
        else:
            out.append(c)
        i += 1
    return "".join(out)


def load_bedrock_json(raw: bytes):
    """Parse a Bedrock JSON file: UTF-8, maybe with a BOM, maybe with comments."""
    text = raw.decode("utf-8-sig")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return json.loads(_strip_json_comments(text))


def _parse_version(value) -> Optional[list]:
    """[major, minor, patch] from a manifest version, which is a list or (format 3) a "1.2.3" string."""
    if isinstance(value, list) and len(value) == 3 and all(isinstance(x, int) and not isinstance(x, bool) and x >= 0 for x in value):
        return list(value)
    if isinstance(value, str):
        m = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)(?:[-+].*)?", value.strip())
        if m:
            return [int(g) for g in m.groups()]
    return None


def version_text(version) -> str:
    return ".".join(str(x) for x in version) if isinstance(version, list) else str(version)


def clean_name(name: str) -> str:
    """A pack name without Minecraft's § color and formatting codes."""
    return FORMATTING_CODE_RE.sub("", name).strip()


def parse_manifest(raw: bytes) -> dict:
    """The parts of a pack's manifest.json Isopod uses. Raises AddonError if it isn't a valid pack."""
    try:
        data = load_bedrock_json(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise AddonError("Its manifest.json isn't valid JSON.")
    if not isinstance(data, dict) or not isinstance(data.get("header"), dict):
        raise AddonError("Its manifest.json has no header.")
    header = data["header"]

    try:
        pack_id = str(uuidlib.UUID(str(header.get("uuid", ""))))
    except ValueError:
        raise AddonError("Its manifest.json has no valid pack uuid.")
    version = _parse_version(header.get("version"))
    if version is None:
        raise AddonError("Its manifest.json has no valid version.")

    modules = data.get("modules")
    if not isinstance(modules, list) or not modules:
        raise AddonError("Its manifest.json lists no modules.")
    types = {str(m.get("type", "")).lower() for m in modules if isinstance(m, dict)}
    for module_type, what in NOT_ADDON_MODULES.items():
        if module_type in types:
            raise AddonError(f"It's {what}, not an add-on. Only behavior and resource packs can be installed.")
    kinds = {MODULE_KINDS[t] for t in types if t in MODULE_KINDS}
    if not kinds:
        raise AddonError("Its manifest.json has no behavior or resource pack module.")
    kind = "behavior" if "behavior" in kinds else "resource"

    depends_on, beta_apis = [], []
    for dep in data.get("dependencies") or []:
        if not isinstance(dep, dict):
            continue
        if dep.get("uuid"):
            try:
                depends_on.append(str(uuidlib.UUID(str(dep["uuid"]))))
            except ValueError:
                pass
        module_name = str(dep.get("module_name", ""))
        if module_name.startswith("@minecraft/") and "beta" in str(dep.get("version", "")).lower():
            beta_apis.append(module_name)

    name = header.get("name")
    description = header.get("description")
    return {
        "uuid": pack_id,
        "version": version,
        "kind": kind,
        "name": clean_name(name) if isinstance(name, str) else "",
        "description": clean_name(description) if isinstance(description, str) else "",
        "depends_on": depends_on,
        "beta_apis": beta_apis,
    }


def _lang_value(pack_dir: str, key: str) -> Optional[str]:
    """key's text in the pack's texts/en_US.lang, for packs whose manifest names are translation keys."""
    path = os.path.join(pack_dir, "texts", "en_US.lang")
    try:
        with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
            for line in f:
                k, sep, v = line.partition("=")
                if sep and k.strip() == key:
                    return clean_name(v.split("\t#")[0].split("##")[0])
    except OSError:
        pass
    return None


def resolve_names(manifest: dict, pack_dir: str, fallback: str) -> None:
    """Replace translation keys like pack.name in manifest's name and description with their text."""
    for field in ("name", "description"):
        value = manifest.get(field) or ""
        if value and " " not in value and "." in value:
            manifest[field] = _lang_value(pack_dir, value) or value
    if not manifest.get("name"):
        manifest["name"] = fallback


# ---------- unpacking uploads ----------

def _safe_member_path(name: str) -> str:
    """name as a relative path with / separators. Raises AddonError if it could escape the folder."""
    path = name.replace("\\", "/")
    parts = [p for p in path.split("/") if p not in ("", ".")]
    if path.startswith("/") or (parts and ":" in parts[0]) or ".." in parts:
        raise AddonError(f"It contains an unsafe path ({name}), so it wasn't installed.")
    return "/".join(parts)


def _is_symlink(info: zipfile.ZipInfo) -> bool:
    return stat.S_ISLNK(info.external_attr >> 16)


class _Budget:
    """Counts entries and bytes across an upload and its nested archives."""

    def __init__(self):
        self.entries = 0
        self.bytes = 0

    def add(self, info: zipfile.ZipInfo) -> None:
        self.entries += 1
        self.bytes += info.file_size
        if self.entries > MAX_ENTRIES:
            raise AddonError(f"It has more than {MAX_ENTRIES} files, so it wasn't installed.")
        if self.bytes > MAX_UNPACKED_BYTES:
            raise AddonError(f"It unpacks to more than {MAX_UNPACKED_BYTES // (1024 * 1024)} MB, so it wasn't installed.")


def _open_zip(source, label: str) -> zipfile.ZipFile:
    try:
        return zipfile.ZipFile(source)
    except (zipfile.BadZipFile, OSError):
        raise AddonError(f"{label} isn't a valid .mcpack or .mcaddon file (they're zip archives).")


def _collect_packs(zf: zipfile.ZipFile, budget: _Budget, nested: bool) -> List[Tuple[zipfile.ZipFile, str, List[Tuple[zipfile.ZipInfo, str]]]]:
    """Each pack in zf as (zip, root, [(member, path inside the pack)]). Nested .mcpack files are opened once."""
    members = []
    for info in zf.infolist():
        budget.add(info)
        if _is_symlink(info):
            raise AddonError(f"It contains a symbolic link ({info.filename}), so it wasn't installed.")
        if info.flag_bits & 0x1:
            raise AddonError("It's encrypted. Marketplace content can't be installed on a server.")
        path = _safe_member_path(info.filename)
        if path and not info.is_dir():
            members.append((info, path))

    manifest_roots = sorted(
        {p.rsplit("/", 1)[0] if "/" in p else "" for _, p in members if p.rsplit("/", 1)[-1].lower() == "manifest.json"},
        key=len,
    )
    # A manifest inside another pack's folder belongs to that pack (e.g. a copy in a subfolder)
    roots: List[str] = []
    for root in manifest_roots:
        if not any(r == "" or root.startswith(r + "/") for r in roots):
            roots.append(root)

    packs = []
    for root in roots:
        prefix = root + "/" if root else ""
        files = [(info, path[len(prefix):]) for info, path in members if path.startswith(prefix)]
        packs.append((zf, root, files))

    # .mcaddon files often hold each pack as its own .mcpack
    if not nested:
        claimed = [r + "/" if r else "" for r in roots]
        for info, path in members:
            if not path.lower().endswith((".mcpack", ".zip")):
                continue
            if any(path.startswith(c) for c in claimed):
                continue
            if info.file_size > MAX_NESTED_BYTES:
                raise AddonError(f"{path} is too large to unpack.")
            inner = _open_zip(io.BytesIO(zf.read(info)), path)
            packs.extend(_collect_packs(inner, budget, nested=True))
    return packs


def _extract(zf: zipfile.ZipFile, files: List[Tuple[zipfile.ZipInfo, str]], dest: str) -> None:
    for info, rel in files:
        target = os.path.join(dest, *rel.split("/"))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with zf.open(info) as src, open(target, "wb") as out:
            shutil.copyfileobj(src, out)


def unpack_addon(archive_path: str, work_dir: str, label: str = "The file") -> List[dict]:
    """Unpack every pack in an .mcpack or .mcaddon into work_dir and read its manifest.

    Returns one dict per pack: the parsed manifest plus "path", the unpacked folder.
    Raises AddonError, before installing anything, if the archive or any pack in it is bad.
    """
    budget = _Budget()
    with _open_zip(archive_path, label) as zf:
        packs = _collect_packs(zf, budget, nested=False)
        if not packs:
            raise AddonError("No behavior or resource pack was found in it (no manifest.json).")
        result = []
        for i, (pack_zip, root, files) in enumerate(packs):
            manifest_member = next(info for info, rel in files if rel.lower() == "manifest.json")
            fallback = root.rsplit("/", 1)[-1] if root else os.path.splitext(os.path.basename(label))[0]
            try:
                manifest = parse_manifest(pack_zip.read(manifest_member))
            except AddonError as e:
                where = f"The pack in {root}/" if root else "The pack"
                raise AddonError(f"{where} can't be installed. {e}")
            dest = os.path.join(work_dir, str(i))
            _extract(pack_zip, files, dest)
            resolve_names(manifest, dest, fallback)
            manifest["path"] = dest
            result.append(manifest)

    seen = set()
    for pack in result:
        if pack["uuid"] in seen:
            raise AddonError(f"It contains the pack {pack['name']} twice.")
        seen.add(pack["uuid"])
    return result


# ---------- the world and installed packs ----------

def level_name(data_dir: str, env: Optional[dict] = None) -> str:
    """The world BDS loads: level-name in server.properties, else LEVEL_NAME, else BDS's default."""
    name = None
    try:
        with open(os.path.join(data_dir, "server.properties"), "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                key, sep, value = line.partition("=")
                if sep and key.strip() == "level-name":
                    name = value.strip()
    except OSError:
        pass
    name = name or (env or {}).get("LEVEL_NAME") or DEFAULT_LEVEL_NAME
    if name in (".", "..") or "/" in name or "\\" in name:
        raise AddonError("The world name in server.properties isn't a valid folder name.")
    return name


def _world_file(data_dir: str, level: str, kind: str) -> str:
    return os.path.join(data_dir, "worlds", level, PACK_DIRS[kind][1])


def read_world_packs(data_dir: str, level: str, kind: str) -> List[dict]:
    path = _world_file(data_dir, level, kind)
    if not os.path.isfile(path):
        return []
    try:
        with open(path, "rb") as f:
            raw = f.read()
        data = load_bedrock_json(raw) if raw.strip() else []
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise AddonError(f"{os.path.basename(path)} in the world folder isn't valid JSON. Fix or delete it in the Files tab.")
    if not isinstance(data, list):
        raise AddonError(f"{os.path.basename(path)} in the world folder should be a list of packs.")
    return [p for p in data if isinstance(p, dict)]


def write_world_packs(data_dir: str, level: str, kind: str, packs: List[dict]) -> None:
    path = _world_file(data_dir, level, kind)
    # BDS creates the world in this folder on its first start if it doesn't exist yet
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(packs, f, indent=2)


def _same_pack(entry: dict, pack_id: str) -> bool:
    return str(entry.get("pack_id", "")).lower() == pack_id.lower()


def set_pack_enabled(data_dir: str, level: str, kind: str, pack_id: str, version: list, enabled: bool) -> None:
    packs = read_world_packs(data_dir, level, kind)
    kept = [p for p in packs if not _same_pack(p, pack_id)]
    if enabled:
        # Keep the pack's place in the load order when it's already on
        index = next((i for i, p in enumerate(packs) if _same_pack(p, pack_id)), len(kept))
        kept.insert(min(index, len(kept)), {"pack_id": pack_id, "version": version})
    if kept != packs:
        write_world_packs(data_dir, level, kind, kept)


def _scan_packs(data_dir: str) -> List[dict]:
    """Every pack folder in behavior_packs/ and resource_packs/, with its manifest (or the error reading it)."""
    found = []
    for kind, (folder, _) in PACK_DIRS.items():
        base = os.path.join(data_dir, folder)
        if not os.path.isdir(base):
            continue
        for entry in sorted(os.scandir(base), key=lambda e: e.name.lower()):
            manifest_path = os.path.join(entry.path, "manifest.json")
            if not entry.is_dir() or not os.path.isfile(manifest_path):
                continue
            pack = {"folder": entry.name, "path": entry.path, "kind": kind}
            try:
                with open(manifest_path, "rb") as f:
                    pack.update(parse_manifest(f.read()))
                pack["kind"] = kind
                resolve_names(pack, entry.path, entry.name)
            except (AddonError, OSError) as e:
                pack.update({"uuid": None, "name": entry.name, "error": str(e)})
            found.append(pack)
    return found


def list_addons(data_dir: str, env: Optional[dict] = None) -> dict:
    """The add-ons installed on the server and whether the world has each one turned on."""
    level = level_name(data_dir, env)
    active = {kind: read_world_packs(data_dir, level, kind) for kind in PACK_DIRS}
    scanned = _scan_packs(data_dir)
    installed_ids = {p["uuid"] for p in scanned if p.get("uuid")}

    addons = []
    for pack in scanned:
        enabled = bool(pack.get("uuid")) and any(_same_pack(e, pack["uuid"]) for e in active[pack["kind"]])
        if BUILTIN_PACK_RE.match(pack["folder"]) and not enabled:
            continue
        addons.append({
            "uuid": pack.get("uuid"),
            "name": pack.get("name") or pack["folder"],
            "description": pack.get("description", ""),
            "version": version_text(pack["version"]) if pack.get("version") else "",
            "type": pack["kind"],
            "folder": pack["folder"],
            "enabled": enabled,
            "beta_apis": pack.get("beta_apis", []),
            "missing_dependencies": [d for d in pack.get("depends_on", []) if d not in installed_ids],
            "error": pack.get("error"),
        })
    return {"world": level, "addons": addons}


def _folder_name(name: str, pack_id: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_-]+", "_", name).strip("_")[:40] or "pack"
    return f"{slug}_{pack_id[:8]}"


def install_addon(data_dir: str, archive_path: str, filename: str, env: Optional[dict] = None,
                  kind: Optional[str] = None) -> List[dict]:
    """Install every pack in an uploaded .mcpack or .mcaddon and turn it on for the world.

    With kind="resource" (the Resource Packs tab), only a .mcpack of resource packs is accepted.
    A pack that's already installed (same uuid) is replaced. Returns the installed packs.
    """
    if kind == "resource":
        if not filename.lower().endswith(RESOURCE_PACK_EXTENSIONS):
            raise AddonError("Only .mcpack files can be installed here. Install a .mcaddon from the Add-ons tab.")
    elif kind is not None:
        raise AddonError("Unknown pack type.")
    elif not filename.lower().endswith(ADDON_EXTENSIONS):
        raise AddonError("Only .mcpack and .mcaddon files can be installed.")
    level = level_name(data_dir, env)
    # Check the world files before touching anything, so a broken one doesn't leave packs half-installed
    for world_kind in PACK_DIRS:
        read_world_packs(data_dir, level, world_kind)

    existing = _scan_packs(data_dir)
    installed = []
    with tempfile.TemporaryDirectory(dir=data_dir if os.path.isdir(data_dir) else None) as work:
        packs = unpack_addon(archive_path, work, filename)
        if kind and any(pack["kind"] != kind for pack in packs):
            raise AddonError("It's a behavior pack, not a resource pack. Install it from the Add-ons tab.")
        for pack in packs:
            base = os.path.join(data_dir, PACK_DIRS[pack["kind"]][0])
            os.makedirs(base, exist_ok=True)
            for old in existing:
                if old.get("uuid") == pack["uuid"] and old["kind"] == pack["kind"]:
                    shutil.rmtree(old["path"])
            dest = os.path.join(base, _folder_name(pack["name"], pack["uuid"]))
            if os.path.exists(dest):
                shutil.rmtree(dest)
            shutil.move(pack["path"], dest)
            set_pack_enabled(data_dir, level, pack["kind"], pack["uuid"], pack["version"], True)
            installed.append({
                "uuid": pack["uuid"],
                "name": pack["name"],
                "version": version_text(pack["version"]),
                "type": pack["kind"],
                "folder": os.path.basename(dest),
                "beta_apis": pack["beta_apis"],
            })
    return installed


def _find_pack(data_dir: str, pack_id: str) -> dict:
    for pack in _scan_packs(data_dir):
        if pack.get("uuid") and pack["uuid"].lower() == pack_id.lower():
            return pack
    raise AddonError("That add-on isn't installed.")


def toggle_addon(data_dir: str, pack_id: str, enabled: bool, env: Optional[dict] = None) -> dict:
    """Turn an installed pack on or off for the world. Its files stay either way."""
    pack = _find_pack(data_dir, pack_id)
    set_pack_enabled(data_dir, level_name(data_dir, env), pack["kind"], pack["uuid"], pack["version"], enabled)
    return pack


def remove_addon(data_dir: str, pack_id: str, env: Optional[dict] = None) -> dict:
    """Turn a pack off for the world and delete its folder."""
    pack = _find_pack(data_dir, pack_id)
    set_pack_enabled(data_dir, level_name(data_dir, env), pack["kind"], pack["uuid"], pack["version"], False)
    base = os.path.realpath(os.path.join(data_dir, PACK_DIRS[pack["kind"]][0]))
    path = os.path.realpath(pack["path"])
    if os.path.dirname(path) != base:
        raise AddonError("That add-on's folder is outside the packs folder, so it wasn't removed.")
    shutil.rmtree(path)
    return pack
