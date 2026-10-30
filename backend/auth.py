"""Dashboard login (#143).

One admin account, created on first run through the dashboard. The password is stored as an
argon2 hash and sessions as SHA-256 hashes of random tokens, in .isopod_auth.json under
SERVERS_DIR. Every /api route and WebSocket needs a session cookie except the few in
PUBLIC_PATHS. Deleting the file puts Isopod back into first-run setup.
"""
import hashlib
import json
import os
import re
import secrets
import threading
import time
from typing import Dict, List, Optional

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from . import security

SESSION_COOKIE = "isopod_session"
SESSION_TTL = 30 * 24 * 3600
MIN_PASSWORD_LENGTH = 8
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,32}$")

# Failed logins allowed per client address within the window before it gets 429s
MAX_FAILED_LOGINS = 10
FAILED_LOGIN_WINDOW = 15 * 60

PUBLIC_PATHS = {"/api/health", "/api/auth/status", "/api/auth/login", "/api/auth/setup", "/api/auth/logout"}

_hasher = PasswordHasher()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


UNREADABLE = "Isopod's login file is unreadable. Check the logs."


class AuthStoreError(HTTPException):
    """The credentials file exists but can't be read. Fail closed rather than re-open setup."""

    def __init__(self, reason: str):
        print(f"Auth: {reason}")
        super().__init__(status_code=503, detail=UNREADABLE)


class AuthStore:
    def __init__(self, path: str):
        self.path = path
        self._lock = threading.Lock()
        self._failed: Dict[str, List[float]] = {}

    def _load(self) -> Optional[dict]:
        if not os.path.exists(self.path):
            return None
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not data.get("username") or not data.get("password_hash"):
                raise ValueError("missing credentials")
            data.setdefault("sessions", {})
            return data
        except (OSError, ValueError, AttributeError) as e:
            raise AuthStoreError(f"Can't read {self.path}: {e}") from e

    def _save(self, data: dict) -> None:
        os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
        tmp = self.path + ".tmp"
        # Owner-only: the file holds the password hash and live session hashes
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, self.path)

    def is_setup(self) -> bool:
        with self._lock:
            return self._load() is not None

    def setup(self, username: str, password: str) -> str:
        """Create the admin account and return a session token. Fails once an admin exists."""
        with self._lock:
            if self._load() is not None:
                raise HTTPException(status_code=409, detail="Isopod is already set up.")
            data = {"username": username, "password_hash": _hasher.hash(password), "sessions": {}}
            token = self._new_session(data)
            self._save(data)
            return token

    def login(self, username: str, password: str, client: str) -> str:
        with self._lock:
            now = time.time()
            recent = [t for t in self._failed.get(client, []) if now - t < FAILED_LOGIN_WINDOW]
            self._failed[client] = recent
            if len(recent) >= MAX_FAILED_LOGINS:
                raise HTTPException(status_code=429, detail="Too many failed logins. Try again in a few minutes.")
            data = self._load()
            if data is None:
                raise HTTPException(status_code=409, detail="Isopod isn't set up yet.")
            ok = secrets.compare_digest(username.lower(), data["username"].lower())
            try:
                # Verify even on a wrong username so both cases take the same time
                _hasher.verify(data["password_hash"], password)
            except (VerificationError, InvalidHashError):
                ok = False
            if not ok:
                recent.append(now)
                raise HTTPException(status_code=401, detail="Wrong username or password.")
            self._failed.pop(client, None)
            if _hasher.check_needs_rehash(data["password_hash"]):
                data["password_hash"] = _hasher.hash(password)
            token = self._new_session(data)
            self._save(data)
            return token

    def change_password(self, token: str, current: str, new: str) -> str:
        """Set a new password, end every session, and return a fresh one for the caller."""
        with self._lock:
            data = self._load()
            if data is None or not self._session_valid(data, token):
                raise HTTPException(status_code=401, detail="Not logged in.")
            try:
                _hasher.verify(data["password_hash"], current)
            except (VerificationError, InvalidHashError):
                raise HTTPException(status_code=400, detail="Current password is wrong.")
            data["password_hash"] = _hasher.hash(new)
            data["sessions"] = {}
            new_token = self._new_session(data)
            self._save(data)
            return new_token

    def logout(self, token: str) -> None:
        with self._lock:
            data = self._load()
            if data and data["sessions"].pop(_token_hash(token), None) is not None:
                self._save(data)

    def username_for(self, token: Optional[str]) -> Optional[str]:
        if not token:
            return None
        with self._lock:
            data = self._load()
            if data is None or not self._session_valid(data, token):
                return None
            return data["username"]

    @staticmethod
    def _session_valid(data: dict, token: str) -> bool:
        expires = data["sessions"].get(_token_hash(token))
        return expires is not None and expires > time.time()

    @staticmethod
    def _new_session(data: dict) -> str:
        now = time.time()
        data["sessions"] = {h: exp for h, exp in data["sessions"].items() if exp > now}
        token = secrets.token_urlsafe(32)
        data["sessions"][_token_hash(token)] = now + SESSION_TTL
        return token


def _cookie(scope) -> Optional[str]:
    raw = security.header(scope, b"cookie")
    if not raw:
        return None
    for part in raw.split(";"):
        name, _, value = part.strip().partition("=")
        if name == SESSION_COOKIE:
            return value
    return None


class AuthMiddleware:
    """Returns 401 for /api requests and WebSockets without a valid session."""

    def __init__(self, app, store: AuthStore):
        self.app = app
        self.store = store

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            path = scope.get("path", "")
            is_api = path == "/api" or path.startswith("/api/")
            preflight = scope["type"] == "http" and scope.get("method") == "OPTIONS"
            if is_api and path not in PUBLIC_PATHS and not preflight:
                try:
                    user = self.store.username_for(_cookie(scope))
                except AuthStoreError:
                    await security.deny(scope, receive, send, 503, UNREADABLE)
                    return
                if user is None:
                    await security.deny(scope, receive, send, 401, "Not logged in.")
                    return
                scope.setdefault("state", {})["user"] = user
        await self.app(scope, receive, send)


class Credentials(BaseModel):
    username: str
    password: str


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


def _validate_new_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")


def _set_session_cookie(request: Request, response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_TTL,
        path="/",
        httponly=True,
        samesite="strict",
        secure=request.url.scheme == "https",
    )


def create_router(store: AuthStore) -> APIRouter:
    router = APIRouter(prefix="/api/auth")

    @router.get("/status")
    def status(request: Request):
        setup_done = store.is_setup()
        user = store.username_for(request.cookies.get(SESSION_COOKIE)) if setup_done else None
        return {"setup_required": not setup_done, "authenticated": user is not None, "username": user}

    @router.post("/setup")
    def setup(creds: Credentials, request: Request, response: Response):
        username = creds.username.strip()
        if not USERNAME_RE.match(username):
            raise HTTPException(status_code=400, detail="Username can use letters, numbers, '.', '_' and '-' (up to 32).")
        _validate_new_password(creds.password)
        _set_session_cookie(request, response, store.setup(username, creds.password))
        return {"username": username}

    @router.post("/login")
    def login(creds: Credentials, request: Request, response: Response):
        client = request.client.host if request.client else "unknown"
        token = store.login(creds.username.strip(), creds.password, client)
        _set_session_cookie(request, response, token)
        return {"username": store.username_for(token)}

    @router.post("/logout")
    def logout(request: Request, response: Response):
        token = request.cookies.get(SESSION_COOKIE)
        if token:
            store.logout(token)
        response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="strict")
        return {"ok": True}

    @router.post("/password")
    def change_password(change: PasswordChange, request: Request, response: Response):
        _validate_new_password(change.new_password)
        token = store.change_password(request.cookies.get(SESSION_COOKIE) or "", change.current_password, change.new_password)
        _set_session_cookie(request, response, token)
        return {"ok": True}

    return router
