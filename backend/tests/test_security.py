"""Cross-origin protection (#144).

Run from the repo root: python -m unittest discover backend/tests
"""
import unittest

from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend import security

EVIL = "http://evil.example"


def make_app(allowed=()):
    app = FastAPI()

    @app.get("/api/thing")
    def read_thing():
        return {"ok": True}

    @app.post("/api/thing")
    def write_thing():
        return {"ok": True}

    @app.websocket("/api/ws")
    async def ws(websocket: WebSocket):
        await websocket.accept()
        await websocket.send_text("hi")
        await websocket.close()

    app.add_middleware(security.OriginGuardMiddleware, allowed_origins=allowed)
    return app


class ParseOriginsTests(unittest.TestCase):
    def test_splits_trims_and_normalizes(self):
        self.assertEqual(
            security.parse_origins(" http://localhost:5173/ ,HTTPS://Example.com,, http://localhost:5173"),
            ["http://localhost:5173", "https://example.com"],
        )

    def test_empty_means_no_extra_origins(self):
        self.assertEqual(security.parse_origins(None), [])
        self.assertEqual(security.parse_origins(""), [])


class IsOriginAllowedTests(unittest.TestCase):
    def test_same_origin(self):
        self.assertTrue(security.is_origin_allowed("http://192.168.1.5:8000", "192.168.1.5:8000", []))
        self.assertTrue(security.is_origin_allowed("http://isopod.lan", "isopod.lan:80", []))
        self.assertTrue(security.is_origin_allowed("https://isopod.lan:443", "isopod.lan", []))

    def test_foreign_origin(self):
        self.assertFalse(security.is_origin_allowed(EVIL, "192.168.1.5:8000", []))
        self.assertFalse(security.is_origin_allowed("http://192.168.1.5:9000", "192.168.1.5:8000", []))
        self.assertFalse(security.is_origin_allowed("null", "192.168.1.5:8000", []))
        self.assertFalse(security.is_origin_allowed("http://192.168.1.5:8000", None, []))

    def test_listed_origin(self):
        self.assertTrue(security.is_origin_allowed("http://localhost:5173/", "192.168.1.5:8000", ["http://localhost:5173"]))


class MiddlewareTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(make_app(["http://localhost:5173"]), base_url="http://isopod.lan:8000")

    def test_foreign_post_is_rejected(self):
        res = self.client.post("/api/thing", headers={"Origin": EVIL})
        self.assertEqual(res.status_code, 403)

    def test_foreign_get_passes_through(self):
        # Reads are protected by CORS: the browser won't hand the response to the foreign page.
        self.assertEqual(self.client.get("/api/thing", headers={"Origin": EVIL}).status_code, 200)

    def test_same_origin_and_listed_origin_posts_pass(self):
        self.assertEqual(self.client.post("/api/thing", headers={"Origin": "http://isopod.lan:8000"}).status_code, 200)
        self.assertEqual(self.client.post("/api/thing", headers={"Origin": "http://localhost:5173"}).status_code, 200)

    def test_post_without_origin_passes(self):
        self.assertEqual(self.client.post("/api/thing").status_code, 200)

    def test_foreign_websocket_is_rejected(self):
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect("/api/ws", headers={"Origin": EVIL}):
                pass

    def test_same_origin_websocket_connects(self):
        with self.client.websocket_connect("ws://isopod.lan:8000/api/ws", headers={"Origin": "http://isopod.lan:8000"}) as ws:
            self.assertEqual(ws.receive_text(), "hi")


class MainAppTests(unittest.TestCase):
    def test_main_app_has_no_wildcard_cors(self):
        from backend import main
        client = TestClient(main.app)
        res = client.options("/api/settings", headers={"Origin": EVIL, "Access-Control-Request-Method": "POST"})
        self.assertNotEqual(res.headers.get("access-control-allow-origin"), "*")
        self.assertNotEqual(res.headers.get("access-control-allow-origin"), EVIL)
        self.assertEqual(client.post("/api/settings", json={}, headers={"Origin": EVIL}).status_code, 403)


if __name__ == "__main__":
    unittest.main()
