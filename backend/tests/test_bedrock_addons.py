"""Bedrock add-ons: manifest parsing, unpacking .mcpack/.mcaddon uploads, and world activation.

Run from the repo root: python -m unittest discover backend/tests
The endpoint tests need the backend's requirements installed; the rest only need the stdlib.
"""
import io
import json
import os
import stat
import tempfile
import unittest
import zipfile
from unittest import mock

import yaml

from backend import bedrock_addons as addons

BP_UUID = "11111111-1111-4111-8111-111111111111"
RP_UUID = "22222222-2222-4222-8222-222222222222"


def manifest(pack_id=BP_UUID, module="data", name="Test Pack", version=(1, 2, 3), **extra) -> bytes:
    data = {
        "format_version": 2,
        "header": {"name": name, "description": "A pack", "uuid": pack_id, "version": list(version), "min_engine_version": [1, 20, 0]},
        "modules": [{"type": module, "uuid": "33333333-3333-4333-8333-333333333333", "version": [1, 0, 0]}],
    }
    data.update(extra)
    return json.dumps(data).encode()


def zip_bytes(files: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in files.items():
            if isinstance(content, zipfile.ZipInfo):
                zf.writestr(content, b"x")
            else:
                zf.writestr(name, content)
    return buf.getvalue()


class ManifestTests(unittest.TestCase):
    def test_behavior_pack(self):
        m = addons.parse_manifest(manifest())
        self.assertEqual((m["uuid"], m["version"], m["kind"], m["name"]), (BP_UUID, [1, 2, 3], "behavior", "Test Pack"))

    def test_script_only_pack_is_a_behavior_pack(self):
        self.assertEqual(addons.parse_manifest(manifest(module="script"))["kind"], "behavior")

    def test_resource_pack(self):
        self.assertEqual(addons.parse_manifest(manifest(RP_UUID, module="resources"))["kind"], "resource")

    def test_comments_bom_and_formatting_codes(self):
        raw = b"\xef\xbb\xbf" + b'{\n// comment\n"header": {"name": "\xc2\xa7aGreen // not a comment", "uuid": "' + BP_UUID.encode() + \
            b'", /* block */ "version": "2.0.1"},\n"modules": [{"type": "data"}]}'
        m = addons.parse_manifest(raw)
        self.assertEqual(m["name"], "Green // not a comment")
        self.assertEqual(m["version"], [2, 0, 1])

    def test_beta_apis_and_dependencies(self):
        m = addons.parse_manifest(manifest(dependencies=[
            {"module_name": "@minecraft/server", "version": "1.15.0-beta"},
            {"module_name": "@minecraft/server-ui", "version": "1.2.0"},
            {"uuid": RP_UUID, "version": [1, 0, 0]},
        ]))
        self.assertEqual(m["beta_apis"], ["@minecraft/server"])
        self.assertEqual(m["depends_on"], [RP_UUID])

    def test_invalid_manifests_are_rejected(self):
        bad = [
            b"not json",
            json.dumps({"modules": [{"type": "data"}]}).encode(),
            manifest(pack_id="not-a-uuid"),
            manifest(version=(1, 2)),
            json.dumps({"header": {"uuid": BP_UUID, "version": [1, 0, 0]}, "modules": []}).encode(),
            manifest(module="skin_pack"),
            manifest(module="world_template"),
            manifest(module="something_else"),
        ]
        for raw in bad:
            with self.assertRaises(addons.AddonError, msg=raw):
                addons.parse_manifest(raw)


class UnpackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def archive(self, files: dict) -> str:
        path = os.path.join(self.dir, "upload.zip")
        with open(path, "wb") as f:
            f.write(zip_bytes(files))
        return path

    def unpack(self, files: dict):
        work = os.path.join(self.dir, "work")
        os.makedirs(work, exist_ok=True)
        return addons.unpack_addon(self.archive(files), work, "pack.mcpack")

    def test_mcpack_with_manifest_at_the_root(self):
        packs = self.unpack({"manifest.json": manifest(), "entities/cow.json": b"{}"})
        self.assertEqual(len(packs), 1)
        self.assertTrue(os.path.isfile(os.path.join(packs[0]["path"], "entities", "cow.json")))

    def test_mcpack_with_one_top_folder(self):
        packs = self.unpack({"My Pack/manifest.json": manifest(), "My Pack/pack_icon.png": b"png"})
        self.assertTrue(os.path.isfile(os.path.join(packs[0]["path"], "pack_icon.png")))

    def test_mcaddon_with_folders(self):
        packs = self.unpack({"BP/manifest.json": manifest(), "RP/manifest.json": manifest(RP_UUID, module="resources")})
        self.assertEqual(sorted(p["kind"] for p in packs), ["behavior", "resource"])

    def test_mcaddon_with_nested_mcpacks(self):
        packs = self.unpack({
            "bp.mcpack": zip_bytes({"manifest.json": manifest()}),
            "rp.mcpack": zip_bytes({"manifest.json": manifest(RP_UUID, module="resources")}),
        })
        self.assertEqual(sorted(p["uuid"] for p in packs), [BP_UUID, RP_UUID])

    def test_translated_name_comes_from_the_lang_file(self):
        packs = self.unpack({"manifest.json": manifest(name="pack.name"), "texts/en_US.lang": b"pack.name=Real Name\npack.description=Desc"})
        self.assertEqual(packs[0]["name"], "Real Name")

    def test_path_traversal_is_rejected(self):
        for name in ["../evil.txt", "/etc/passwd", "C:/evil.txt", "pack/../../evil.txt", "..\\evil.txt"]:
            with self.assertRaises(addons.AddonError, msg=name) as ctx:
                self.unpack({"manifest.json": manifest(), name: b"x"})
            self.assertIn("unsafe path", str(ctx.exception))
        self.assertFalse(os.path.exists(os.path.join(self.dir, "evil.txt")))

    def test_symlinks_are_rejected(self):
        link = zipfile.ZipInfo("link")
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        with self.assertRaises(addons.AddonError):
            self.unpack({"manifest.json": manifest(), "link": link})

    def test_not_a_zip(self):
        path = os.path.join(self.dir, "bad.mcpack")
        with open(path, "wb") as f:
            f.write(b"definitely not a zip")
        with self.assertRaises(addons.AddonError) as ctx:
            addons.unpack_addon(path, self.dir, "bad.mcpack")
        self.assertIn("isn't a valid", str(ctx.exception))

    def test_no_manifest(self):
        with self.assertRaises(addons.AddonError) as ctx:
            self.unpack({"readme.txt": b"hi"})
        self.assertIn("No behavior or resource pack", str(ctx.exception))

    def test_bad_manifest_names_the_pack(self):
        with self.assertRaises(addons.AddonError) as ctx:
            self.unpack({"BP/manifest.json": manifest(), "RP/manifest.json": b"{"})
        self.assertIn("RP/", str(ctx.exception))

    def test_too_large_is_rejected(self):
        with mock.patch.object(addons, "MAX_UNPACKED_BYTES", 10):
            with self.assertRaises(addons.AddonError):
                self.unpack({"manifest.json": manifest()})

    def test_too_many_files_is_rejected(self):
        with mock.patch.object(addons, "MAX_ENTRIES", 2):
            with self.assertRaises(addons.AddonError):
                self.unpack({"manifest.json": manifest(), "a": b"", "b": b""})

    def test_same_pack_twice_is_rejected(self):
        with self.assertRaises(addons.AddonError):
            self.unpack({"A/manifest.json": manifest(), "B/manifest.json": manifest()})


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = os.path.join(self.tmp.name, "data")
        os.makedirs(self.data)

    def tearDown(self):
        self.tmp.cleanup()

    def upload(self, files: dict, filename="addon.mcaddon", kind=None):
        path = os.path.join(self.tmp.name, "upload")
        with open(path, "wb") as f:
            f.write(zip_bytes(files))
        return addons.install_addon(self.data, path, filename, kind=kind)

    def world_packs(self, kind, level="Bedrock level"):
        return addons.read_world_packs(self.data, level, kind)

    def test_mcaddon_installs_both_halves_and_activates_them(self):
        installed = self.upload({"BP/manifest.json": manifest(), "RP/manifest.json": manifest(RP_UUID, module="resources", name="Test RP")})
        self.assertEqual(len(installed), 2)
        self.assertTrue(os.path.isfile(os.path.join(self.data, "behavior_packs", f"Test_Pack_{BP_UUID[:8]}", "manifest.json")))
        self.assertTrue(os.path.isfile(os.path.join(self.data, "resource_packs", f"Test_RP_{RP_UUID[:8]}", "manifest.json")))
        self.assertEqual(self.world_packs("behavior"), [{"pack_id": BP_UUID, "version": [1, 2, 3]}])
        self.assertEqual(self.world_packs("resource"), [{"pack_id": RP_UUID, "version": [1, 2, 3]}])

    def test_world_comes_from_server_properties(self):
        with open(os.path.join(self.data, "server.properties"), "w") as f:
            f.write("server-name=x\nlevel-name=My World\n")
        self.upload({"manifest.json": manifest()}, "pack.mcpack")
        self.assertEqual(len(self.world_packs("behavior", "My World")), 1)

    def test_reinstall_replaces_the_old_version(self):
        self.upload({"manifest.json": manifest(name="Old")}, "pack.mcpack")
        self.upload({"manifest.json": manifest(name="New", version=(2, 0, 0))}, "pack.mcpack")
        self.assertEqual(os.listdir(os.path.join(self.data, "behavior_packs")), [f"New_{BP_UUID[:8]}"])
        self.assertEqual(self.world_packs("behavior"), [{"pack_id": BP_UUID, "version": [2, 0, 0]}])

    def test_other_world_packs_are_kept(self):
        other = {"pack_id": "44444444-4444-4444-8444-444444444444", "version": [1, 0, 0]}
        addons.write_world_packs(self.data, "Bedrock level", "behavior", [other])
        self.upload({"manifest.json": manifest()}, "pack.mcpack")
        self.assertEqual(self.world_packs("behavior")[0], other)

    def test_bad_upload_changes_nothing(self):
        with self.assertRaises(addons.AddonError):
            self.upload({"BP/manifest.json": manifest(), "RP/manifest.json": b"{"})
        self.assertFalse(os.path.exists(os.path.join(self.data, "behavior_packs")))
        self.assertEqual(self.world_packs("behavior"), [])
        self.assertEqual(os.listdir(self.data), [])

    def test_wrong_extension(self):
        with self.assertRaises(addons.AddonError):
            self.upload({"manifest.json": manifest()}, "pack.zip")

    def test_list_toggle_and_remove(self):
        self.upload({"manifest.json": manifest(dependencies=[{"uuid": RP_UUID, "version": [1, 0, 0]}, {"module_name": "@minecraft/server", "version": "1.9.0-beta"}])}, "pack.mcpack")
        # A pack BDS ships is hidden
        os.makedirs(os.path.join(self.data, "behavior_packs", "vanilla_1.20"))
        with open(os.path.join(self.data, "behavior_packs", "vanilla_1.20", "manifest.json"), "wb") as f:
            f.write(manifest("55555555-5555-4555-8555-555555555555"))

        listing = addons.list_addons(self.data)
        self.assertEqual(listing["world"], "Bedrock level")
        self.assertEqual(len(listing["addons"]), 1)
        addon = listing["addons"][0]
        self.assertEqual((addon["name"], addon["version"], addon["type"], addon["enabled"]), ("Test Pack", "1.2.3", "behavior", True))
        self.assertEqual(addon["missing_dependencies"], [RP_UUID])
        self.assertEqual(addon["beta_apis"], ["@minecraft/server"])

        addons.toggle_addon(self.data, BP_UUID, False)
        self.assertEqual(self.world_packs("behavior"), [])
        self.assertFalse(addons.list_addons(self.data)["addons"][0]["enabled"])
        addons.toggle_addon(self.data, BP_UUID, True)
        self.assertEqual(len(self.world_packs("behavior")), 1)

        addons.remove_addon(self.data, BP_UUID)
        self.assertEqual(self.world_packs("behavior"), [])
        self.assertEqual(addons.list_addons(self.data)["addons"], [])

    def test_resource_pack_install_and_remove(self):
        installed = self.upload({"manifest.json": manifest(RP_UUID, module="resources", name="Textures")}, "textures.mcpack", kind="resource")
        self.assertEqual([p["type"] for p in installed], ["resource"])
        folder = os.path.join(self.data, "resource_packs", f"Textures_{RP_UUID[:8]}")
        self.assertTrue(os.path.isfile(os.path.join(folder, "manifest.json")))
        self.assertEqual(self.world_packs("resource"), [{"pack_id": RP_UUID, "version": [1, 2, 3]}])
        self.assertEqual([(a["name"], a["type"], a["enabled"]) for a in addons.list_addons(self.data)["addons"]], [("Textures", "resource", True)])

        addons.remove_addon(self.data, RP_UUID)
        self.assertFalse(os.path.exists(folder))
        self.assertEqual(self.world_packs("resource"), [])
        self.assertEqual(addons.list_addons(self.data)["addons"], [])

    def test_resource_pack_upload_refuses_behavior_packs(self):
        with self.assertRaisesRegex(addons.AddonError, "Add-ons tab"):
            self.upload({"manifest.json": manifest()}, "pack.mcpack", kind="resource")
        # A .mcaddon whose resource half would be fine is still refused as a whole
        with self.assertRaisesRegex(addons.AddonError, "Add-ons tab"):
            self.upload({"BP/manifest.json": manifest(), "RP/manifest.json": manifest(RP_UUID, module="resources")}, "both.mcpack", kind="resource")
        self.assertEqual(os.listdir(self.data), [])

    def test_resource_pack_upload_refuses_mcaddon(self):
        with self.assertRaisesRegex(addons.AddonError, "Add-ons tab"):
            self.upload({"manifest.json": manifest(RP_UUID, module="resources")}, "pack.mcaddon", kind="resource")

    def test_unknown_pack(self):
        with self.assertRaises(addons.AddonError):
            addons.toggle_addon(self.data, BP_UUID, True)

    def test_broken_world_file_is_reported(self):
        os.makedirs(os.path.join(self.data, "worlds", "Bedrock level"))
        with open(os.path.join(self.data, "worlds", "Bedrock level", "world_behavior_packs.json"), "w") as f:
            f.write("{broken")
        with self.assertRaises(addons.AddonError):
            self.upload({"manifest.json": manifest()}, "pack.mcpack")
        self.assertFalse(os.path.exists(os.path.join(self.data, "behavior_packs")))


class EndpointTests(unittest.TestCase):
    """The /addons endpoints, which need the backend's requirements."""

    @classmethod
    def setUpClass(cls):
        try:
            from fastapi.testclient import TestClient
            from backend import main
        except Exception as e:  # pragma: no cover - depends on the environment
            raise unittest.SkipTest(f"backend requirements not installed: {e}")
        cls.main = main
        cls.client = TestClient(main.app)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = self.tmp.name
        os.makedirs(os.path.join(self.path, "data"))
        self.set_type("BEDROCK")
        patches = [
            mock.patch.object(self.main, "get_instance_path", return_value=self.path),
            mock.patch.object(self.main, "take_pre_update_snapshot", return_value=None),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def tearDown(self):
        self.tmp.cleanup()

    def set_type(self, server_type):
        with open(os.path.join(self.path, "docker-compose.yml"), "w") as f:
            yaml.dump({"services": {"mc": {"environment": [f"TYPE={server_type}"]}}}, f)

    def post_file(self, name, content):
        return self.client.post("/api/instances/pocket/addons/upload", files={"file": (name, content)})

    def test_upload_list_toggle_delete(self):
        res = self.post_file("pack.mcpack", zip_bytes({"manifest.json": manifest()}))
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["installed"][0]["uuid"], BP_UUID)

        listing = self.client.get("/api/instances/pocket/addons").json()
        self.assertEqual([a["enabled"] for a in listing["addons"]], [True])

        res = self.client.post("/api/instances/pocket/addons/toggle", json={"uuid": BP_UUID, "enabled": False})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertFalse(self.client.get("/api/instances/pocket/addons").json()["addons"][0]["enabled"])

        res = self.client.post("/api/instances/pocket/addons/delete", json={"uuid": BP_UUID})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(self.client.get("/api/instances/pocket/addons").json()["addons"], [])

    def test_bad_archive_is_a_clear_400(self):
        res = self.post_file("evil.mcpack", zip_bytes({"manifest.json": manifest(), "../evil": b"x"}))
        self.assertEqual(res.status_code, 400)
        self.assertIn("evil.mcpack wasn't installed", res.json()["detail"])
        self.assertIn("unsafe path", res.json()["detail"])

    def test_resource_pack_upload(self):
        res = self.client.post("/api/instances/pocket/addons/upload", data={"type": "resource"},
                               files={"file": ("rp.mcpack", zip_bytes({"manifest.json": manifest(RP_UUID, module="resources")}))})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual([a["type"] for a in self.client.get("/api/instances/pocket/addons").json()["addons"]], ["resource"])

        res = self.client.post("/api/instances/pocket/addons/upload", data={"type": "resource"},
                               files={"file": ("bp.mcpack", zip_bytes({"manifest.json": manifest()}))})
        self.assertEqual(res.status_code, 400)
        self.assertIn("not a resource pack", res.json()["detail"])

        res = self.client.post("/api/instances/pocket/addons/upload", data={"type": "resource"}, files={"file": ("both.mcaddon", b"x")})
        self.assertEqual(res.status_code, 400)

    def test_wrong_extension_is_a_400(self):
        self.assertEqual(self.post_file("mod.jar", b"x").status_code, 400)

    def test_java_servers_have_no_addons(self):
        self.set_type("PAPER")
        self.assertEqual(self.client.get("/api/instances/pocket/addons").status_code, 400)


if __name__ == "__main__":
    unittest.main()
