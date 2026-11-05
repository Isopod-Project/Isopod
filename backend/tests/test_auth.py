"""Dashboard login (#143).

Run from the repo root: python -m unittest discover backend/tests
"""
import json
import os
import tempfile
import unittest

from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketDenialResponse

from backend import auth

ADMIN = {"username": "admin", "password": "correct horse"}


def make_app(store):
    app = FastAPI()
    app.include_router(auth.create_router(store))

    @app.get("/api/health")
    def health():
        return {"ok": True}

    @app.get("/api/instances")
    def instances():
        return []

    @app.websocket("/api/console")
    async def console(websocket: WebSocket):
        await websocket.accept()
        await websocket.send_text("hi")
        await websocket.close()

    @app.get("/")
    def index():
        return {"page": "dashboard"}

    app.add_middleware(auth.AuthMiddleware, store=store)
    return app


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, ".isopod_auth.json")
        self.store = auth.AuthStore(self.path)
        self.client = TestClient(make_app(self.store))

    def tearDown(self):
        self.tmp.cleanup()

    def setup_admin(self):
        res = self.client.post("/api/auth/setup", json=ADMIN)
        self.assertEqual(res.status_code, 200)
        return res

    def test_first_run_reports_setup_required(self):
        self.assertEqual(
            self.client.get("/api/auth/status").json(),
            {"setup_required": True, "authenticated": False, "username": None},
        )

    def test_api_needs_login_even_before_setup(self):
        self.assertEqual(self.client.get("/api/instances").status_code, 401)

    def test_public_routes_and_frontend_stay_open(self):
        self.assertEqual(self.client.get("/api/health").status_code, 200)
        self.assertEqual(self.client.get("/").status_code, 200)

    def test_setup_stores_hashed_password_and_logs_in(self):
        res = self.setup_admin()
        cookie = res.headers["set-cookie"].lower()
        self.assertIn("httponly", cookie)
        self.assertIn("samesite=strict", cookie)
        with open(self.path, encoding="utf-8") as f:
            stored = json.load(f)
        self.assertTrue(stored["password_hash"].startswith("$argon2"))
        self.assertNotIn(ADMIN["password"], json.dumps(stored))
        self.assertEqual(self.client.get("/api/instances").status_code, 200)

    def test_setup_only_works_once(self):
        self.setup_admin()
        res = TestClient(make_app(self.store)).post("/api/auth/setup", json={"username": "evil", "password": "12345678"})
        self.assertEqual(res.status_code, 409)

    def test_setup_rejects_short_password(self):
        res = self.client.post("/api/auth/setup", json={"username": "admin", "password": "short"})
        self.assertEqual(res.status_code, 400)
        self.assertFalse(os.path.exists(self.path))

    def test_login_and_logout(self):
        self.setup_admin()
        fresh = TestClient(make_app(self.store))
        self.assertEqual(fresh.get("/api/instances").status_code, 401)
        self.assertEqual(fresh.post("/api/auth/login", json={"username": "ADMIN", "password": ADMIN["password"]}).status_code, 200)
        self.assertEqual(fresh.get("/api/instances").status_code, 200)
        token = fresh.cookies.get(auth.SESSION_COOKIE)
        self.assertEqual(fresh.post("/api/auth/logout").status_code, 200)
        self.assertEqual(fresh.get("/api/instances").status_code, 401)
        # The old token is revoked server-side, not just cleared from the browser
        self.assertIsNone(self.store.username_for(token))

    def test_wrong_password_is_rejected_and_rate_limited(self):
        self.setup_admin()
        fresh = TestClient(make_app(self.store))
        for _ in range(auth.MAX_FAILED_LOGINS):
            self.assertEqual(fresh.post("/api/auth/login", json={"username": "admin", "password": "nope"}).status_code, 401)
        self.assertEqual(fresh.post("/api/auth/login", json=ADMIN).status_code, 429)

    def test_websocket_needs_login(self):
        with self.assertRaises(WebSocketDenialResponse) as ctx:
            with self.client.websocket_connect("/api/console"):
                pass
        self.assertEqual(ctx.exception.status_code, 401)
        self.setup_admin()
        with self.client.websocket_connect("/api/console") as ws:
            self.assertEqual(ws.receive_text(), "hi")

    def test_change_password_ends_other_sessions(self):
        self.setup_admin()
        other = TestClient(make_app(self.store))
        other.post("/api/auth/login", json=ADMIN)
        res = self.client.post("/api/auth/password", json={"current_password": ADMIN["password"], "new_password": "battery staple"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.client.get("/api/instances").status_code, 200)
        self.assertEqual(other.get("/api/instances").status_code, 401)
        self.assertEqual(other.post("/api/auth/login", json={"username": "admin", "password": "battery staple"}).status_code, 200)

    def test_unreadable_credentials_fail_closed(self):
        with open(self.path, "w", encoding="utf-8") as f:
            f.write("{not json")
        self.assertEqual(self.client.get("/api/instances").status_code, 401)
        self.assertEqual(self.client.get("/api/auth/status").status_code, 503)
        self.assertEqual(self.client.post("/api/auth/setup", json=ADMIN).status_code, 503)


if __name__ == "__main__":
    unittest.main()
