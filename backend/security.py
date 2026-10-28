"""Cross-origin protection for the dashboard and API (#144).

The frontend is served by the backend itself, so the browser only needs same-origin access.
Extra origins (the Vite dev server, a custom reverse proxy) are allowed through
ISOPOD_CORS_ORIGINS, a comma-separated list such as "http://localhost:5173".

CORS alone doesn't stop a foreign page from sending a "simple" POST or opening a WebSocket,
so OriginGuardMiddleware also rejects state-changing requests and WebSocket upgrades whose
Origin header names another site.
"""
import os
from typing import Iterable, List, Optional
from urllib.parse import urlsplit

from starlette.responses import JSONResponse

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def parse_origins(value: Optional[str]) -> List[str]:
    """Split the env var into normalized origins ("scheme://host[:port]", no trailing slash)."""
    origins = []
    for raw in (value or "").split(","):
        origin = raw.strip().rstrip("/").lower()
        if origin and origin not in origins:
            origins.append(origin)
    return origins


def allowed_origins_from_env() -> List[str]:
    return parse_origins(os.getenv("ISOPOD_CORS_ORIGINS"))


def _header(scope, name: bytes) -> Optional[str]:
    for key, value in scope.get("headers") or []:
        if key == name:
            return value.decode("latin-1")
    return None


def is_origin_allowed(origin: str, host: Optional[str], allowed: Iterable[str]) -> bool:
    """Same-origin (the Origin's host:port matches the Host header) or listed in `allowed`."""
    origin = origin.strip().rstrip("/").lower()
    if origin in allowed:
        return True
    if not host:
        return False
    parts = urlsplit(origin)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return False
    default_port = "443" if parts.scheme == "https" else "80"
    host = host.strip().lower()
    # "example.com" and "example.com:80" are the same origin for http
    return parts.netloc in (host, f"{host}:{default_port}") or f"{parts.netloc}:{default_port}" == host


class OriginGuardMiddleware:
    """Pure ASGI middleware so it covers WebSocket upgrades as well as HTTP requests."""

    def __init__(self, app, allowed_origins: Iterable[str] = ()):
        self.app = app
        self.allowed = set(parse_origins(",".join(allowed_origins)))

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            needs_check = scope["type"] == "websocket" or scope.get("method", "GET").upper() not in SAFE_METHODS
            origin = _header(scope, b"origin")
            # Browsers always send Origin on cross-site POSTs and WebSocket upgrades. A missing
            # Origin means a non-browser client (curl, scripts), which CSRF can't come from.
            if needs_check and origin is not None and not is_origin_allowed(origin, _header(scope, b"host"), self.allowed):
                if scope["type"] == "websocket":
                    await send({"type": "websocket.close", "code": 1008})
                    return
                response = JSONResponse(status_code=403, content={"detail": "Cross-origin request blocked"})
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
